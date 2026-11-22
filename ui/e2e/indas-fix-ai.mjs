// Ind AS Fix with AI in the dev app (Sarthak, 2026-11-22), on the SYNTHETIC filing with a MOCK LLM: New project →
// the filled standard template → every line tagged from tests/fixtures/synthetic_indas/filing.json (no Difference) →
// Trade receivables retagged non-current (a Difference on Total current financial assets) → Problems: ✦ Fix all
// with AI → the left AI chat opens with the proposal as cards (each with the app's own dry run) → what went to the AI:
// line items, amounts and the KB calculation, no company name or CIN → Accept the right card: the tag comes back and
// the Difference is gone → Reject the other: its line is untouched → AI consent off: the request is refused with the
// reason in the chat.
// Usage (from the repo root):
//   uv run python -m tests.fixtures.synthetic_indas.build_workbook
//   terminal 1: GROQ_API_BASE=http://127.0.0.1:8766 uv run uvicorn api.app:app --host 127.0.0.1 --port 7861
//   terminal 2 (ui/): XAP_API_URL=http://127.0.0.1:7861 XAP_USER_DATA="$TEMP/xap-e2e-$RANDOM" env -u ELECTRON_RUN_AS_NODE \
//                     ./node_modules/.bin/electron-vite dev -- --remote-debugging-port=9350
//   node ui/e2e/indas-fix-ai.mjs 9350 <screenshotDir> [mockPort=8766]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { newProject } from './indas-new-project.mjs'
import { firstProblemId, lineId, startMockGroqFix } from './mock-groq-fix.mjs'

const [port, outDir, mockPort = '8766'] = process.argv.slice(2)
const fixtureDir = resolve('tests/fixtures/synthetic_indas')
const filing = JSON.parse(readFileSync(join(fixtureDir, 'filing.json'), 'utf8'))
const workbook = join(fixtureDir, 'synthetic_indas_template.xlsx')
mkdirSync(outDir, { recursive: true })

// the mock's proposal: Trade receivables back to current (right), and untag Cash (wrong, to be rejected)
const mock = await startMockGroqFix(Number(mockPort), (prompt) => ({
  explanation: 'Trade receivables are shown under current financial assets but tagged as non-current, so Total current financial assets is short by their amount.',
  changes: [
    { problem_id: firstProblemId(prompt), line_id: lineId(prompt, 'Trade receivables'), concept: 'ind-as:TradeReceivablesCurrent', period_role: null, reason: 'The line sits under Current assets > Financial assets.' },
    { problem_id: firstProblemId(prompt), line_id: lineId(prompt, 'Cash and cash equivalents'), concept: null, period_role: null, reason: 'A deliberately wrong proposal the test rejects.' },
  ],
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

await send('Runtime.enable')
await send('Page.enable')
await send('Page.reload')
await sleep(2000)
await waitFor(`!!window.__xap_test__?.indas && !!${q('[data-testid="welcome-new-project"]')}`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'backend ready', 180000)
await ev(`window.xap.settings.update({ aiConsent: true })`)

// 1. the synthetic filing, every line tagged as the fixture says: no Difference
const company = filing.company.NameOfCompany
const cin = filing.company.CorporateIdentityNumber
check(await newProject(ev, waitFor, 'welcome-new-project', { company, cin, start: filing.meta.startDate, end: filing.meta.endDate, level: 'Actual' }), 'New project opens the editor')
await ev(`${S}.upload(${J(workbook)})`)
await waitFor(`${S}.busy === null && ${S}.transform !== null`, 'transform', 120000)
const SHEET_OF = { balanceSheet: 'CANONICAL_BS', profitLoss: 'CANONICAL_PL', cashFlow: 'CANONICAL_CF', noteLines: 'CANONICAL_FINANCIAL_NOTES' }
for (const r of await ev(`${S}.rows.map(r => ({ id: r.id, statement: r.statement, label: r.label }))`)) {
  const line = filing.sheets[SHEET_OF[r.statement]].find((l) => l.label === r.label && l.concept)
  if (!line) continue
  await ev(`${S}.setConcept(${J(r.id)}, ${J(line.concept)})`)
  if (line.periodRole === 'start') await ev(`${S}.setPeriodRole(${J(r.id)}, 'start')`)
}
await ev(`${UI}.setBottomTab('problems'), true`)
await waitFor(`Object.keys(${S}.checks).length === 4 && Object.values(${S}.checks).every(c => c.differences.length === 0)`, 'no Difference', 30000)
check((await ev(diffProblems)) === 0, 'tagged as the fixture says: no Difference in Problems')
check(!(await ev(`!!${q('[data-testid="fix-all-ai"]')}`)), 'no Fix with AI offered while every total adds up')

// 2. one wrong tag: a Difference on Total current financial assets
const tr = await ev(`${S}.rows.find(r => r.statement === 'balanceSheet' && r.label === 'Trade receivables')`)
const cash = await ev(`${S}.rows.find(r => r.statement === 'balanceSheet' && r.label === 'Cash and cash equivalents')`)
await ev(`${S}.setConcept(${J(tr.id)}, 'ind-as:TradeReceivablesNoncurrent')`)
await waitFor(`${diffProblems} > 0`, 'a Difference problem', 15000)
const problemTexts = await ev(`${qa('[data-testid="problem"][data-source="difference"]')}.map(p => p.textContent)`)
check(problemTexts.some((t) => t.includes('Total current financial assets')), 'the wrong tag shows as a Difference', problemTexts.join(' | '))
check(await ev(`!!${q('[data-testid="fix-all-ai"]')} && !!${q('[data-testid="problem"][data-source="difference"] [data-testid="fix-ai"]')}`), '✦ Fix all with AI and a per-problem ✦ are offered')
check(!(await ev(`!!${q('[data-testid="problem"][data-source="readiness"] [data-testid="fix-ai"]')}`)), 'readiness (company / signatory) problems get no Fix with AI')
await shot('01-problems.png')

// 3. Fix all with AI → the left AI chat with the proposal as cards
await ev(`${q('[data-testid="fix-all-ai"]')}.click(), true`)
await waitFor(`${UI}.activity === 'ai' && ${UI}.sidebarOpen`, 'AI chat opens', 5000).then(() => check(true, 'the AI chat opens on the left'), () => check(false, 'the AI chat opens on the left'))
await waitFor(`${q('[data-testid="fix-session"]')}?.dataset.status === 'ready' || ${q('[data-testid="fix-session"]')}?.dataset.status === 'failed'`, 'proposal', 60000)
check((await ev(`${q('[data-testid="fix-session"]')}.dataset.status`)) === 'ready', 'the AI answered', await ev(`${q('[data-testid="fix-error"]')}?.textContent ?? ''`))
const cards = await ev(`${qa('[data-testid="fix-card"]')}.map(c => ({ row: c.dataset.row, concept: c.dataset.concept, state: c.dataset.state, better: c.querySelector('[data-testid="fix-effect"]').dataset.better, effect: c.querySelector('[data-testid="fix-effect"]').textContent }))`)
check(cards.length === 2, 'one card per proposed change', J(cards))
const right = cards.find((c) => c.row === tr.id)
const wrong = cards.find((c) => c.row === cash.id)
check(right?.concept === 'ind-as:TradeReceivablesCurrent' && right.better === 'true', 'the right change: the dry run says it fixes the total', right?.effect)
check(wrong?.concept === '' && wrong.better === 'false', 'the wrong change: the dry run says it does not help', wrong?.effect)
check((await ev(`${S}.rows.find(r => r.id === ${J(tr.id)}).concept`)) === 'ind-as:TradeReceivablesNoncurrent', 'nothing is applied before Accept')
await shot('02-cards.png')

// what went to the AI
const sent = J(mock.requests.at(-1) ?? {})
check(mock.requests.length >= 1, 'the backend asked the (mock) LLM')
check(!sent.includes(company) && !sent.includes(cin), 'no company name or CIN went to the AI')
check(sent.includes('Trade receivables') && sent.includes('400000') && sent.includes('calculation: ind-as:CurrentFinancialAssets'), 'line items, amounts and the KB calculation went to the AI')

// 4. Accept the right card: the tag comes back, the Difference check re-runs, the problem is gone
await ev(`${q(`[data-testid="fix-card"][data-row="${tr.id}"] [data-testid="fix-accept"]`)}.click(), true`)
check((await ev(`${S}.rows.find(r => r.id === ${J(tr.id)}).concept`)) === 'ind-as:TradeReceivablesCurrent', 'Accept applies that change')
const cleared = await waitFor(`${diffProblems} === 0`, 'Difference gone', 15000).catch(() => false)
check(!!cleared, 'the Difference check re-ran: no Difference left')
check((await ev(`${q(`[data-testid="fix-card"][data-row="${tr.id}"]`)}.dataset.state`)) === 'accepted', 'the card shows Accepted')

// 5. Reject the other: its line keeps its tag
await ev(`${q(`[data-testid="fix-card"][data-row="${cash.id}"] [data-testid="fix-reject"]`)}.click(), true`)
check((await ev(`${S}.rows.find(r => r.id === ${J(cash.id)}).concept`)) === 'ind-as:CashAndCashEquivalents', 'Reject leaves the line as it was')
check((await ev(`${q(`[data-testid="fix-card"][data-row="${cash.id}"]`)}.dataset.state`)) === 'rejected', 'the card shows Rejected')
await shot('03-accepted.png')

// 6. AI consent off: refused with the reason, nothing sent
const before = mock.requests.length
await ev(`window.xap.settings.update({ aiConsent: false })`)
await ev(`${S}.setConcept(${J(tr.id)}, 'ind-as:TradeReceivablesNoncurrent')`)
await waitFor(`${diffProblems} > 0`, 'a Difference again', 15000)
await ev(`${q('[data-testid="fix-all-ai"]')}.click(), true`)
await waitFor(`${qa('[data-testid="fix-session"]')}.at(-1)?.dataset.status === 'failed'`, 'refused', 15000).catch(() => {})
check(/allow AI in Settings/.test((await ev(`${qa('[data-testid="fix-error"]')}.at(-1)?.textContent`)) ?? ''), 'without AI consent the chat says to allow AI in Settings')
check(mock.requests.length === before, 'nothing went to the AI without consent')
await shot('04-no-consent.png')

await ev(`${S}.close()`)
check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
mock.close()
ws.close()
process.exit(failures.length ? 1 : 0)
