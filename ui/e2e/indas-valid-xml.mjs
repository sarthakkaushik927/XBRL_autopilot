// A valid Ind AS XML end to end in the dev app (docs/17), on the SYNTHETIC filing (no client data, no AI):
// start screen → Start Ind AS filing → upload the filled standard template → every line, the PPE class and a note
// text tagged as tests/fixtures/synthetic_indas/filing.json says (through window.__xap_test__.indas) → the
// Difference bar is clean on each statement → company / auditor / signatories → Generate: the XML is saved with
// 0 MCA problems → Arelle checks the saved XML against the official Ind AS 2017 taxonomy (tests/xbrl_conformance.py).
// Usage (from the repo root, dev app running with --remote-debugging-port):
//   uv run python -m tests.fixtures.synthetic_indas.build_workbook
//   node ui/e2e/indas-valid-xml.mjs <port> <screenshotDir>
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const [port, outDir] = process.argv.slice(2)
const fixtureDir = resolve('tests/fixtures/synthetic_indas')
const filing = JSON.parse(readFileSync(join(fixtureDir, 'filing.json'), 'utf8'))
const workbook = join(fixtureDir, 'synthetic_indas_template.xlsx')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 240; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page' && t.url.startsWith('http'))) break } catch {} await sleep(500) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) || m.params.exceptionDetails.text)
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description }
const waitFor = async (expr, label, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(500) } throw new Error('timeout: ' + label) }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64')); console.log('  screenshot', name) }
const click = (testId) => ev(`(document.querySelector('[data-testid="${testId}"]')?.click(), !!document.querySelector('[data-testid="${testId}"]'))`)
const S = 'window.__xap_test__.indas.getState()'
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const J = JSON.stringify

await send('Runtime.enable')
await send('Page.enable')
await send('Page.reload')
await sleep(2000)
await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="welcome-indas-start"]')`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'sidecar ready', 180000)

// 1. Upload the filled standard template: read exactly, no guessing
check(await click('welcome-indas-start'), 'Start Ind AS filing opens the pipeline')
await waitFor(`!!document.querySelector('[data-testid="indas-pipeline"]')`, 'pipeline screen')
await ev(`${S}.setMeta(${J(filing.meta)})`)
await ev(`${S}.upload(${J(workbook)})`)
await waitFor(`${S}.busy === null`, 'transform', 120000)
check(await ev(`${S}.transform?.source`) === 'standard_template', 'the workbook is read as the standard template')

// 2. Tag every line as the fixture says (statement + line item → concept, opening balances marked "start")
const SHEET_OF = { balanceSheet: 'CANONICAL_BS', profitLoss: 'CANONICAL_PL', cashFlow: 'CANONICAL_CF', noteLines: 'CANONICAL_FINANCIAL_NOTES' }
const rows = await ev(`${S}.rows.map(r => ({ id: r.id, statement: r.statement, label: r.label }))`)
let tagged = 0
for (const r of rows) {
  const line = filing.sheets[SHEET_OF[r.statement]].find((l) => l.label === r.label && l.concept)
  if (!line) continue
  await ev(`${S}.setConcept(${J(r.id)}, ${J(line.concept)})`)
  if (line.periodRole === 'start') await ev(`${S}.setPeriodRole(${J(r.id)}, 'start')`)
  tagged++
}
const expected = Object.values(SHEET_OF).reduce((n, s) => n + filing.sheets[s].filter((l) => l.concept).length, 0)
check(tagged === expected, 'every line with an amount is tagged', `${tagged}/${expected}`)
for (const p of await ev(`${S}.ppe.map(r => ({ id: r.id, assetClass: r.assetClass }))`)) {
  const cls = filing.sheets.CANONICAL_PPE_SCHEDULE.find((c) => c.assetClass === p.assetClass)
  if (cls) await ev(`${S}.setMember(${J(p.id)}, ${J(cls.member)})`)
}
check(await ev(`${S}.ppe.every(r => r.member)`), 'the PPE class is tagged with its member')
for (const t of filing.texts) {
  await ev(`${S}.addTextBlock()`)
  await ev(`(() => { const s = ${S}; const last = s.texts[s.texts.length - 1]; s.updateTextBlock(last.id, ${J(t)}); return true })()`)
}

// the Difference bar (/indas/check) is clean on each statement
await ev(`${S}.setStep('tagging')`)
for (const tab of ['balanceSheet', 'profitLoss', 'cashFlow', 'noteLines']) {
  await ev(`${S}.setTab('${tab}')`)
  await waitFor(`${S}.check !== null`, `difference ${tab}`, 30000)
  const diff = await ev(`${S}.check`)
  check(diff.differences.length === 0, `${tab}: no Difference`, diff.differences.length ? J(diff.differences.slice(0, 3)) : '')
  await shot(`01-tagging-${tab}.png`)
}

// 3. Company & auditor (synthetic), signatories
await ev(`${S}.setStep('masters')`)
await waitFor(`${S}.fields !== null`, 'master fields', 60000)
for (const [q] of await ev(`${S}.fields.company.map(f => [f.qname])`)) {
  const v = filing.company[q.split(':')[1]]
  if (v) await ev(`${S}.setCompany(${J(q)}, ${J(v)})`)
}
for (const [q, type] of await ev(`${S}.fields.auditor.map(f => [f.qname, f.type])`)) await ev(`${S}.setAuditor(${J(q)}, ${J(/boolean/i.test(type) ? 'false' : 'Unmodified opinion.')})`)
for (const [i, s] of filing.signatories.entries()) await ev(`${S}.updateSignatory(${i}, ${J(s)})`)
await shot('02-masters.png')

// 4. Generate: the XML, with 0 MCA problems
await ev(`${S}.setStep('generate')`)
await sleep(300)
await click('indas-generate')
await waitFor(`${S}.result !== null`, 'generate', 180000)
const result = await ev(`${S}.result`)
check(result.ok === true, 'Generate saves the XML with 0 MCA problems', result.ok ? result.path : J(result.errors.slice(0, 8)))
await sleep(300)
await shot('03-generate-result.png')

// 5. A real XBRL processor on the saved file
if (result.ok) {
  try {
    const out = execFileSync('uv', ['run', '--offline', 'python', '-m', 'tests.xbrl_conformance', result.path], { encoding: 'utf8', timeout: 900000 })
    check(true, 'Arelle: the XML is valid against the Ind AS 2017 taxonomy', out.trim().split('\n').pop())
  } catch (e) {
    check(false, 'Arelle: the XML is valid against the Ind AS 2017 taxonomy', String(e.stdout || e.message).slice(0, 1500))
  }
}

check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
ws.close()
process.exit(failures.length ? 1 : 0)
