// Issue #20 (Vashu, 2026-11-22) in the dev app, on the SYNTHETIC filing with a MOCK LLM:
//  1. editing a tagged cell keeps the green highlights and the new amount reaches the line and the XBRL Form;
//  2. auto-save writes the project file by itself (Settings: every 1 minute here; 5 minutes by default);
//  3. after accepting AI fixes the MCA checks run again by themselves (Problems refreshes without Generate);
//  4. the dry run scores the whole filing: Generate's own checks agree with what the cards promised;
//  7. Stop on a running Fix with AI: nothing is changed, the late answer is not shown.
// Usage (from the repo root), as ui/e2e/indas-fix-ai.mjs:
//   terminal 1: GROQ_API_BASE=http://127.0.0.1:8766 uv run uvicorn api.app:app --host 127.0.0.1 --port 7861
//   terminal 2 (ui/): XAP_API_URL=http://127.0.0.1:7861 XAP_USER_DATA="$TEMP/xap-e2e-$RANDOM" env -u ELECTRON_RUN_AS_NODE \
//                     ./node_modules/.bin/electron-vite dev -- --remote-debugging-port=9350
//   node ui/e2e/issue-20.mjs 9350 <screenshotDir> [mockPort=8766]
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { newProject } from './indas-new-project.mjs'
import { firstProblemId, lineId, startMockGroqFix } from './mock-groq-fix.mjs'

const [port, outDir, mockPort = '8766'] = process.argv.slice(2)
const fixtureDir = resolve('tests/fixtures/synthetic_indas')
const filing = JSON.parse(readFileSync(join(fixtureDir, 'filing.json'), 'utf8'))
const workbook = join(fixtureDir, 'synthetic_indas_template.xlsx')
mkdirSync(outDir, { recursive: true })

const mock = await startMockGroqFix(Number(mockPort), (prompt) => ({
  explanation: 'Trade receivables are tagged non-current.',
  changes: [{ problem_id: firstProblemId(prompt), line_id: lineId(prompt, 'Trade receivables'), concept: 'ind-as:TradeReceivablesCurrent', period_role: null, reason: 'Current assets > Financial assets.' }],
}))

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
const waitFor = async (expr, label, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(400) } throw new Error('timeout: ' + label) }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64')); console.log('  screenshot', name) }
const S = 'window.__xap_test__.indas.getState()'
const UI = 'window.__xap_test__.ui.getState()'
const J = JSON.stringify
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const q = (sel) => `document.querySelector(${J(sel)})`
const qa = (sel) => `[...document.querySelectorAll(${J(sel)})]`
const diffProblems = `${qa('[data-testid="problem"][data-source="difference"]')}.length`
const RULES = ['DUPLICATE_FACT_CONFLICT', 'CALCULATION_MISMATCH', 'BS_OUT_OF_BALANCE', 'NEGATIVE_VALUE_NOT_PERMITTED']
const ruleErrors = `(${S}.result && !${S}.result.ok ? ${S}.result.errors : []).filter(e => ${J(RULES)}.includes(e.type)).map(e => e.type + ' ' + (e.concept ?? ''))`
const sessionStatus = `${qa('[data-testid="fix-session"]')}.at(-1)?.dataset.status`

await send('Runtime.enable')
await send('Page.enable')
await send('Page.reload')
await sleep(2000)
await waitFor(`!!window.__xap_test__?.indas && !!${q('[data-testid="welcome-new-project"]')}`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'backend ready', 180000)
await ev(`window.xap.settings.update({ aiConsent: true, autosaveSeconds: 300 })`)
check((await ev(`window.xap.settings.get().then(s => s.autosaveSeconds)`)) === 300, 'auto-save every 5 minutes by default')

// the synthetic filing, every line tagged as the fixture says
check(await newProject(ev, waitFor, 'welcome-new-project', { company: filing.company.NameOfCompany, cin: filing.company.CorporateIdentityNumber, start: filing.meta.startDate, end: filing.meta.endDate, level: 'Actual' }), 'New project opens the editor')
await ev(`${S}.upload(${J(workbook)})`)
await waitFor(`${S}.busy === null && ${S}.transform !== null`, 'transform', 120000)
const SHEET_OF = { balanceSheet: 'CANONICAL_BS', profitLoss: 'CANONICAL_PL', cashFlow: 'CANONICAL_CF', noteLines: 'CANONICAL_FINANCIAL_NOTES' }
for (const r of await ev(`${S}.rows.map(r => ({ id: r.id, statement: r.statement, label: r.label }))`)) {
  const line = filing.sheets[SHEET_OF[r.statement]].find((l) => l.label === r.label && l.concept)
  if (!line) continue
  await ev(`${S}.setConcept(${J(r.id)}, ${J(line.concept)})`)
  if (line.periodRole === 'start') await ev(`${S}.setPeriodRole(${J(r.id)}, 'start')`)
}
await ev(`${S}.save()`)
await waitFor(`Object.keys(${S}.checks).length === 4 && Object.values(${S}.checks).every(c => c.differences.length === 0)`, 'no Difference', 30000)

// ---- 1. edit a tagged cell: the line, its fact and the green highlights follow
const tr = await ev(`${S}.rows.find(r => r.statement === 'balanceSheet' && r.label === 'Trade receivables')`)
const cells = await ev(`(() => { const t = ${S}.transform; const cols = Object.keys(t.sheets.CANONICAL_BS[0]); const i = Number(${J(tr.id)}.split(':')[1]); const L = (c) => String.fromCharCode(65 + cols.indexOf(c)) + (i + 2); return { py: L('Previous_Year_Amount') } })()`)
await ev(`${S}.revealRow(${J(tr.id)}, 'py'), true`)
await sleep(1500)
await shot('i20-01-before-edit.png')
await ev(`window.__xap_test__.univer.getActiveWorkbook().getSheetByName('CANONICAL_BS').getRange(${J(cells.py)}).setValue(155000), true`)
await waitFor(`${S}.rows.find(r => r.id === ${J(tr.id)}).py === 155000`, 'edited PY reaches the line', 10000).then(() => check(true, 'the edited PY reaches the line'), () => check(false, 'the edited PY reaches the line', String(cells.py)))
check((await ev(`${S}.rows.find(r => r.id === ${J(tr.id)}).concept`)) === tr.concept, 'the line keeps its tag', tr.concept)
await waitFor(`${S}.checks.balanceSheet?.facts[${J(tr.concept)}]?.py === '155000'`, 'fact follows', 10000).then(() => check(true, 'the XBRL Form fact shows the new PY'), () => check(false, 'the XBRL Form fact shows the new PY'))
check((await ev(`${S}.dirty`)) === true, 'the edit marks the project unsaved')
await sleep(800)
await shot('i20-02-after-edit.png') // the green highlights must still be there
await ev(`window.__xap_test__.univer.getActiveWorkbook().getSheetByName('CANONICAL_BS').getRange(${J(cells.py)}).setValue(${tr.py}), true`)
await waitFor(`${S}.rows.find(r => r.id === ${J(tr.id)}).py === ${tr.py}`, 'edit back', 10000)

// ---- 2. auto-save: the file is written by itself, the status bar says so
const path = await ev(`${S}.savedPath`)
const before = statSync(path).mtimeMs
await ev(`window.xap.settings.update({ autosaveSeconds: 60 })`)
await waitFor(`${S}.dirty === false`, 'auto-save', 90000).then(() => check(true, 'auto-save wrote the project (1 minute)'), () => check(false, 'auto-save wrote the project (1 minute)'))
check(statSync(path).mtimeMs > before, 'the project file changed on disk')
check(/^Auto-saved \d/.test((await ev(`${q('[data-testid="save-state"]')}?.textContent`)) ?? ''), 'the status bar says Auto-saved <time>', await ev(`${q('[data-testid="save-state"]')}?.textContent`))
await ev(`window.xap.settings.update({ autosaveSeconds: 300 })`)

// ---- 3 + 4. a wrong tag → Generate → Fix with AI → Accept → the MCA checks re-run by themselves and agree
await ev(`${UI}.setBottomTab('problems'), true`)
await ev(`${S}.setConcept(${J(tr.id)}, 'ind-as:TradeReceivablesNoncurrent')`)
await waitFor(`${diffProblems} > 0`, 'a Difference', 15000)
await ev(`${S}.generate()`)
await waitFor(`${S}.busy === null && ${S}.result !== null`, 'generate', 60000)
const rulesBefore = await ev(ruleErrors)
console.log('  Generate before the fix:', rulesBefore)
check(rulesBefore.some((e) => e.startsWith('CALCULATION_MISMATCH')), 'Generate reports the total that does not add up')
await ev(`${UI}.setBottomTab('problems'), true`)
await ev(`${q('[data-testid="fix-all-ai"]')}.click(), true`)
await waitFor(`${sessionStatus} === 'ready' || ${sessionStatus} === 'failed'`, 'proposal', 60000)
const effect = await ev(`${q('[data-testid="fix-effect"]')}?.textContent`)
check(/^✓/.test(effect ?? ''), 'the card says the change helps on the whole filing', effect)
const resultBefore = await ev(`JSON.stringify(${S}.result)`)
await ev(`${q('[data-testid="fix-accept"]')}.click(), true`)
await waitFor(`JSON.stringify(${S}.result) !== ${J(resultBefore)}`, 're-validation', 30000).then(() => check(true, 'the MCA checks ran again by themselves after Accept'), () => check(false, 'the MCA checks ran again by themselves after Accept'))
const rulesAfter = await ev(ruleErrors)
console.log('  MCA checks after the fix:', rulesAfter)
check(rulesAfter.length < rulesBefore.length && !rulesAfter.some((e) => e.includes('CurrentFinancialAssets')), 'fewer statement errors after the accepted fix, none on the fixed total', `${rulesBefore.length} → ${rulesAfter.length}`)
check(/MCA checks re-run/.test(await ev('document.body.innerText')), 'a toast says the checks ran again')
await shot('i20-03-revalidated.png')

// ---- 7. Stop: a slow answer is stopped; nothing changes and the late answer is not shown
await ev(`${S}.setConcept(${J(tr.id)}, 'ind-as:TradeReceivablesNoncurrent')`)
await waitFor(`${diffProblems} > 0`, 'a Difference again', 15000)
mock.setDelay(8000)
await ev(`${q('[data-testid="fix-all-ai"]')}.click(), true`)
await waitFor(`!!${q('[data-testid="fix-stop"]')}`, 'Stop button', 10000)
await shot('i20-04-asking.png')
await ev(`${q('[data-testid="fix-stop"]')}.click(), true`)
await waitFor(`${sessionStatus} === 'stopped'`, 'stopped', 5000).then(() => check(true, 'Stop ends the request: the chat says Stopped'), () => check(false, 'Stop ends the request'))
await sleep(9000)
check((await ev(sessionStatus)) === 'stopped' && (await ev(`${qa('[data-testid="fix-session"]')}.at(-1).querySelectorAll('[data-testid="fix-card"]').length`)) === 0, 'the late answer is not shown')
check((await ev(`${S}.rows.find(r => r.id === ${J(tr.id)}).concept`)) === 'ind-as:TradeReceivablesNoncurrent', 'nothing was changed')
mock.setDelay(0)
await shot('i20-05-stopped.png')

await ev(`${S}.close()`)
check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
mock.close()
ws.close()
process.exit(failures.length ? 1 : 0)
