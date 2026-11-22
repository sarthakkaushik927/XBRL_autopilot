// A valid Ind AS XML end to end in the dev app's editor (docs/17, ADR-0017), on the SYNTHETIC filing (no client data,
// no AI): start screen → New project (the real dialog) → saved as <Company>_<FY>.axbrl, the Filing Explorer shows it →
// open the filled standard template (canonical sheets in the Excel pane) → every line, the PPE class and a note text
// tagged as tests/fixtures/synthetic_indas/filing.json says → cell ↔ fact linkage both ways → the Difference footer is
// green on each statement → company / auditor (company name, CIN, period prefilled from the settings) / signatories →
// Generate XML: saved with 0 MCA problems, shown in the XML tab → save, close, reopen from Saved projects → Arelle
// checks the saved XML against the official Ind AS 2017 taxonomy (tests/xbrl_conformance.py).
// Usage (from the repo root, dev app running with --remote-debugging-port):
//   uv run python -m tests.fixtures.synthetic_indas.build_workbook
//   node ui/e2e/indas-valid-xml.mjs <port> <screenshotDir>
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { newProject } from './indas-new-project.mjs'
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
const formRow = (concept) => `document.querySelector('[data-testid="form-row"][data-concept=${J(concept).replace(/"/g, '\\"')}]')`

await send('Runtime.enable')
await send('Page.enable')
await send('Page.reload')
await sleep(2000)
await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="welcome-new-project"]')`, 'start screen', 120000)
check(!(await ev(`!!document.querySelector('[data-testid="welcome-indas-start"]')`)), 'the start screen has no step-wizard entry any more')
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'sidecar ready', 180000)
await shot('00-start.png')

// 1. New project (the real dialog): saved straight away in the projects folder, the editor opens on it
const company = filing.company.NameOfCompany
check(
  await newProject(ev, waitFor, 'welcome-new-project', { company, cin: filing.company.CorporateIdentityNumber, start: filing.meta.startDate, end: filing.meta.endDate, level: 'Actual' }),
  'New project opens the editor with the company in the Filing Explorer',
)
const createdPath = await ev(`${S}.savedPath`)
check(/Synthetic Test Private Limited_FY 2025-26( \(\d+\))?\.axbrl$/.test(createdPath ?? ''), 'the project is saved as <Company>_<FY>.axbrl in the projects folder', createdPath)
check((await ev(`document.querySelector('[data-testid="filing-taxonomy"]')?.textContent`)) === 'Ind AS 2017', 'the status bar shows Ind AS 2017')
check(await ev(`!!document.querySelector('[data-testid="indas-upload-empty"]')`), 'the Excel pane offers Open financial statements…')
await waitFor(`document.querySelectorAll('[data-testid="explorer-elr"]').length > 3`, 'Filing Explorer statements', 60000)
await shot('01-new-project.png')

// 2. Open the filled standard template: read exactly; the canonical sheets show in the Excel pane
await ev(`${S}.upload(${J(workbook)})`)
await waitFor(`${S}.busy === null`, 'transform', 120000)
check(await ev(`${S}.transform?.source`) === 'standard_template', 'the workbook is read as the standard template')
await waitFor(`!!document.querySelector('[data-testid="univer-host"] canvas')`, 'Excel grid', 30000)

// 3. Tag every line as the fixture says (statement + line item → concept, opening balances marked "start")
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
check((await ev(`document.querySelector('[data-testid="save-state"]')?.textContent`)) === 'Unsaved changes', 'the status bar shows unsaved changes')

// 4. Cell ↔ fact: a cell of the first balance-sheet line selects it and shows its fact; its chip shows the cell
const first = await ev(`${S}.rows.find(r => r.statement === 'balanceSheet' && r.concept)`)
const gridRow = Number(first.id.split(':')[1]) + 2
await ev(`document.querySelector('[data-testid="explorer-elr"]').click()`)
await ev(`${S}.selectCell({ workbook: 'canonical', sheet: 'CANONICAL_BS', ref: 'E${gridRow}' })`)
check((await ev(`document.querySelector('[data-testid="indas-inspector"]')?.dataset.row`)) === first.id, 'Excel → inspector: the clicked cell selects its line')
const highlighted = await waitFor(`${formRow(first.concept)}?.className.includes('bg-accent')`, 'fact highlighted', 15000).catch(() => false)
check(!!highlighted, 'Excel → Form: the selected cell’s fact is highlighted')
await ev(`${formRow(first.concept)}.querySelector('[data-testid="source-chip"]').click(), true`)
check((await ev(`${S}.reveal?.cell.ref`)) === `E${gridRow}`, 'Form → Excel: the chip reveals its cell', await ev(`${S}.reveal?.cell.ref`))
await shot('02-linkage.png')

// the Difference footer (computed in the app) is green on each statement
await waitFor(`Object.keys(${S}.checks).length === 4`, 'difference checks', 30000)
for (const st of Object.keys(SHEET_OF)) {
  const diff = await ev(`${S}.checks[${J(st)}]`)
  check(diff.differences.length === 0, `${st}: no Difference`, diff.differences.length ? J(diff.differences.slice(0, 3)) : '')
}
for (const uri of await ev(`[...document.querySelectorAll('[data-testid="explorer-elr"]')].map(e => e.dataset.elr).filter(u => /CANONICAL_(BS|PL|CF)#/.test(u))`)) {
  await ev(`[...document.querySelectorAll('[data-testid="explorer-elr"]')].find(e => e.dataset.elr === ${J(uri)}).click()`)
  await waitFor(`!!document.querySelector('[data-testid="form-difference"]')`, `footer ${uri}`, 15000)
  check((await ev(`document.querySelector('[data-testid="form-difference"]').dataset.balanced`)) === 'true', `${uri}: the Difference footer is green`)
}
await ev(`document.querySelector('[data-testid="explorer-elr"]').click()`)
await shot('03-tagged.png')

// 5. Company & auditor: company name, CIN and period come from the settings (not typed again)
await ev(`${S}.setMastersOpen(true)`)
await waitFor(`${S}.fields !== null`, 'master fields', 60000)
const prefilled = await ev(`Object.fromEntries(Object.entries(${S}.company).map(([k, v]) => [k.split(':')[1], v]))`)
check(
  prefilled.NameOfCompany === company && prefilled.CorporateIdentityNumber === filing.company.CorporateIdentityNumber && prefilled.DateOfEndOfReportingPeriod === filing.meta.endDate,
  'the masters are prefilled from the filing settings',
  J(prefilled),
)
for (const [q] of await ev(`${S}.fields.company.map(f => [f.qname])`)) {
  const local = q.split(':')[1]
  const v = filing.company[local]
  if (v && !prefilled[local]) await ev(`${S}.setCompany(${J(q)}, ${J(v)})`)
}
for (const [q, type] of await ev(`${S}.fields.auditor.map(f => [f.qname, f.type])`)) await ev(`${S}.setAuditor(${J(q)}, ${J(/boolean/i.test(type) ? 'false' : 'Unmodified opinion.')})`)
for (const [i, s] of filing.signatories.entries()) await ev(`${S}.updateSignatory(${i}, ${J(s)})`)
await shot('04-masters.png')
await ev(`${S}.setMastersOpen(false)`)

// 6. Generate XML (Form toolbar): 0 MCA problems, the XML tab shows it
await click('indas-generate')
await waitFor(`${S}.result !== null && ${S}.busy === null`, 'generate', 180000)
const result = await ev(`${S}.result`)
check(result.ok === true, 'Generate saves the XML with 0 MCA problems', result.ok ? result.path : J(result.errors.slice(0, 8)))
if (result.ok) {
  const shown = await waitFor(`!!document.querySelector('[data-testid="xml-status"]')`, 'XML tab', 30000).catch(() => false)
  check(!!shown, 'the XML tab shows the generated instance')
}
await ev(`window.__xap_test__.ui.getState().setBottomTab('problems'), true`)
await sleep(500)
await shot('05-generated.png')

// 7. Save, close, reopen from Saved projects: every tag comes back
const taggedBefore = await ev(`${S}.rows.filter(r => r.concept).length + ${S}.ppe.filter(r => r.member).length`)
await ev(`${S}.save()`)
check(await ev(`!${S}.dirty`), 'saved')
await ev(`${S}.close()`)
await ev(`window.__xap_test__.project.getState().refreshLists()`)
await waitFor(`document.querySelector('[data-testid="welcome-saved-projects"]')?.innerText.includes(${J(company)})`, 'listed in Saved projects', 15000)
await ev(`[...document.querySelectorAll('[data-testid="welcome-saved-projects"] button')].find(b => b.title === ${J(createdPath)}).click()`)
await waitFor(`${S}.open && ${S}.busy === null && ${S}.transform !== null`, 'reopened', 30000)
const taggedAfter = await ev(`${S}.rows.filter(r => r.concept).length + ${S}.ppe.filter(r => r.member).length`)
check(taggedAfter === taggedBefore, 'reopening restores every tag', `${taggedAfter}/${taggedBefore}`)
check((await ev(`document.querySelector('[data-testid="explorer-company"]')?.textContent`)) === company, 'the reopened project shows its settings')
await ev(`${S}.close()`)

// 8. A real XBRL processor on the saved file
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
