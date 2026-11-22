// An Ind AS filing in the editor (docs/17, ADR-0017), dev app, real sidecar (+ real Groq for the AI pick):
// start screen → New project (real dialog, synthetic company) → open a client workbook (/indas/transform, local) →
// Auto-tag (scoped /indas/recommend for every sheet; nothing tagged until accepted) → Accept suggestions on each
// statement from the Filing Explorer → cell ↔ fact → company / auditor / signatories (synthetic) → Save → close →
// reopen from Saved projects → Generate XML: the XML or the MCA problems in Problems.
// AI consent is switched on for the run: only line-item names and headings go to Groq (no amounts, no company data).
// Usage: node e2e/indas-pipeline.mjs <port> <screenshotDir> <workbook.xls|xlsx>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newProject } from './indas-new-project.mjs'
const [port, outDir, workbook] = process.argv.slice(2)
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
const J = JSON.stringify
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const short = (q) => (q || '').split(':')[1] || '—'

await send('Runtime.enable')
await send('Page.enable')
await send('Page.reload')
await sleep(2000)
await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="activity-new-project"]')`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'sidecar ready', 180000)
await ev(`window.xap.settings.update({ aiConsent: true }).then(() => true)`)

// 1. New project from the activity bar (synthetic company: the client's name and CIN never go anywhere)
const company = 'Synthetic Pipeline Private Limited'
check(await newProject(ev, waitFor, 'activity-new-project', { company, cin: 'U72200KA2010PTC654321', start: '2025-04-01', end: '2026-03-31', level: 'Lakhs' }), 'New project opens the editor')
await waitFor(`document.querySelectorAll('[data-testid="explorer-elr"]').length > 3`, 'Filing Explorer', 60000)

// 2. Open the client's financial statements: converted into the canonical sheets, shown in the Excel pane
await ev(`${S}.upload(${J(workbook)})`)
await waitFor(`${S}.busy === null`, 'transform', 240000)
if (!(await ev(`${S}.transform !== null`))) throw new Error('transform failed: ' + (await ev(`document.body.innerText.slice(0, 400)`)))
const sizes = await ev(`Object.fromEntries(Object.entries(${S}.transform.sheets).map(([k, v]) => [k, v.length]))`)
check(sizes.CANONICAL_BS > 0 && sizes.CANONICAL_PL > 0, 'workbook converted into canonical sheets', J(sizes))
await waitFor(`!!document.querySelector('[data-testid="univer-host"] canvas')`, 'Excel grid', 30000)
await shot('01-financials.png')

// 3. Auto-tag: suggestions for every sheet, nothing tagged
const t0 = Date.now()
check(await click('auto-tag'), 'Auto-tag button')
await waitFor(`${S}.busy === null`, 'auto-tag', 1800000)
const got = await ev(`${S}.rows.filter(r => r.suggestions.length).length + '/' + ${S}.rows.length`)
const ai = await ev(`${S}.rows.filter(r => r.suggestions[0]?.pickedBy === 'ai').length`)
check(Number(got.split('/')[0]) > 0, 'suggestions from each sheet’s scope', `${got} lines, ${ai} AI picks, ${Math.round((Date.now() - t0) / 1000)} s`)
check(await ev(`${S}.rows.every(r => !r.concept) && ${S}.ppe.every(r => !r.member)`), 'nothing tagged until accepted')

// 4. Accept the suggestions statement by statement (Filing Explorer → Form toolbar)
for (const uri of await ev(`[...document.querySelectorAll('[data-testid="explorer-elr"]')].map(e => e.dataset.elr).filter(u => /CANONICAL_(BS|PL|CF|SOCIE|PPE_SCHEDULE)#/.test(u))`)) {
  await ev(`[...document.querySelectorAll('[data-testid="explorer-elr"]')].find(e => e.dataset.elr === ${J(uri)}).click()`)
  await sleep(300)
  await click('indas-accept-top')
}
const bs = await ev(`${S}.rows.filter(r => r.statement === 'balanceSheet').slice(0, 8).map(r => [r.label, r.concept])`)
console.log('   BS', J(bs.map(([l, q]) => `${String(l).slice(0, 28)} → ${short(q)}`)))
check(await ev(`${S}.rows.some(r => r.concept)`), 'accepted suggestions tag the lines')
await sleep(1000)
await ev(`[...document.querySelectorAll('[data-testid="explorer-elr"]')][0].click()`)
await shot('02-tagged.png')

// cell ↔ fact on a tagged balance-sheet line
const first = await ev(`${S}.rows.find(r => r.statement === 'balanceSheet' && r.concept)`)
if (first) {
  await ev(`${S}.selectCell({ workbook: 'canonical', sheet: 'CANONICAL_BS', ref: 'B${Number(first.id.split(':')[1]) + 2}' })`)
  check((await ev(`${S}.focus?.concept`)) === first.concept, 'Excel → Form: the cell’s fact is focused', short(first.concept))
}

// 5. Company & auditor (synthetic values), signatories
await ev(`${S}.setMastersOpen(true)`)
await waitFor(`${S}.fields !== null`, 'master fields', 60000)
const synthetic = {
  PermanentAccountNumberOfEntity: 'AAACS1234A', AddressOfRegisteredOfficeOfCompany: '1 Test Street, Bengaluru', TypeOfIndustry: 'Commercial and Industrial',
  DateOfBoardMeetingWhenFinalAccountsWereApproved: '2026-05-20', ContentOfReport: 'Financial Statements', DescriptionOfPresentationCurrency: 'INR',
  WhetherCompanyIsMaintainingBooksOfAccountAndOtherRelevantBooksAndPapersInElectronicForm: 'true',
}
for (const [q] of await ev(`${S}.fields.company.map(f => [f.qname])`)) { const v = synthetic[q.split(':')[1]]; if (v) await ev(`${S}.setCompany(${J(q)}, ${J(v)})`) }
for (const [q, type] of await ev(`${S}.fields.auditor.map(f => [f.qname, f.type])`)) await ev(`${S}.setAuditor(${J(q)}, ${J(/boolean/i.test(type) ? 'false' : 'Unmodified opinion.')})`)
await ev(`${S}.updateSignatory(0, { din: '01234567', name: 'Asha Test', designation: 'Director' })`)
await ev(`${S}.updateSignatory(1, { din: '07654321', name: 'Ravi Test', designation: 'Director' })`)
await shot('03-masters.png')
await ev(`${S}.setMastersOpen(false)`)

// 6. Save → close → reopen from Saved projects
await ev(`${S}.save()`)
const savedPath = await ev(`${S}.savedPath`)
check(/Synthetic Pipeline Private Limited_FY 2025-26( \(\d+\))?\.axbrl$/.test(savedPath), 'saved in the projects folder as <Company>_<FY>.axbrl', savedPath)
const taggedBefore = await ev(`${S}.rows.filter(r => r.concept).length + ${S}.socie.filter(r => r.concept).length + ${S}.ppe.filter(r => r.member).length`)
await ev(`${S}.close()`)
await ev(`window.__xap_test__.project.getState().refreshLists()`)
await waitFor(`document.querySelector('[data-testid="welcome-saved-projects"]')?.innerText.includes(${J(company)})`, 'listed in Saved projects', 15000)
await ev(`[...document.querySelectorAll('[data-testid="welcome-saved-projects"] button')].find(b => b.title === ${J(savedPath)}).click()`)
await waitFor(`${S}.open && ${S}.busy === null && ${S}.transform !== null`, 'reopened', 30000)
const taggedAfter = await ev(`${S}.rows.filter(r => r.concept).length + ${S}.socie.filter(r => r.concept).length + ${S}.ppe.filter(r => r.member).length`)
check(taggedAfter === taggedBefore, 'reopening restores every tag', `${taggedAfter}/${taggedBefore}`)

// 7. Generate XML: the XML (XML tab) or the MCA problems (Problems panel)
await waitFor(`!!document.querySelector('[data-testid="indas-generate"]:not([disabled])')`, 'Generate enabled', 30000)
await click('indas-generate')
await waitFor(`${S}.result !== null && ${S}.busy === null`, 'generate', 180000)
const result = await ev(`${S}.result`)
if (result.ok) check(true, 'XML generated into the projects folder', result.path)
else {
  console.log('  MCA problems:', result.errors.length, J(result.errors.slice(0, 8), null, 1))
  check((await ev(`document.querySelectorAll('[data-testid="problem"][data-source="mca"]').length`)) === result.errors.length, 'the MCA problems are listed in Problems')
}
await sleep(500)
await shot('04-generate-result.png')
await ev(`${S}.close()`)

check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
ws.close()
process.exit(failures.length ? 1 : 0)
