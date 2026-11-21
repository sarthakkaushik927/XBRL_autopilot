// Vashu's Ind AS pipeline screen (docs/17, docs/15 §5), dev app, real sidecar (+ real Groq for the AI pick):
// start screen → Start Ind AS filing → upload a workbook (/indas/transform, local) → every tagging tab:
// Suggest tags (scoped /indas/recommend, AI pick) → Accept top → company / auditor / signatories (synthetic values)
// → Save → leave → reopen from Saved projects → Generate (/indas/generateXML): the XML or the MCA problems.
// AI consent is switched on for the run: only line-item names and headings go to Groq (no amounts, no company data).
// Usage: node e2e/indas-pipeline.mjs <port> <screenshotDir> <workbook.xls|xlsx>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const short = (q) => (q || '').split(':')[1] || '—'

await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="welcome-indas-start"]')`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'sidecar ready', 180000)
await ev(`window.xap.settings.update({ aiConsent: true }).then(() => true)`)
await shot('01-start-screen.png')

// 1. Financial statements
check(await click('welcome-indas-start'), 'Start Ind AS filing opens the pipeline')
await waitFor(`!!document.querySelector('[data-testid="indas-pipeline"]')`, 'pipeline screen')
await ev(`${S}.upload(${JSON.stringify(workbook)})`)
await waitFor(`${S}.busy === null`, 'transform', 240000)
if (!(await ev(`${S}.transform !== null`))) throw new Error('transform failed: ' + (await ev(`document.body.innerText.slice(0, 400)`)))
const sizes = await ev(`Object.fromEntries(Object.entries(${S}.transform.sheets).map(([k, v]) => [k, v.length]))`)
check(sizes.CANONICAL_BS > 0 && sizes.CANONICAL_PL > 0, 'workbook converted into canonical sheets', JSON.stringify(sizes))
await shot('02-financials.png')

// 2. Tagging: every tab
await ev(`${S}.setStep('tagging')`)
const tabs = [['balanceSheet', 'rows'], ['profitLoss', 'rows'], ['cashFlow', 'rows'], ['socie', 'socie'], ['ppe', 'ppe'], ['noteLines', 'rows']]
for (const [tab, list] of tabs) {
  await ev(`${S}.setTab('${tab}')`)
  const filter = list === 'rows' ? `.filter(r => r.statement === '${tab}')` : ''
  const total = await ev(`${S}.${list}${filter}.length`)
  if (total === 0) { console.log(`  ${tab}: no rows`); continue }
  const t0 = Date.now()
  await ev(`${S}.suggest()`)
  await waitFor(`${S}.busy === null`, `suggestions ${tab}`, 900000)
  const sugField = tab === 'ppe' ? 'memberSuggestions' : 'suggestions'
  const got = await ev(`${S}.${list}${filter}.filter(r => r.${sugField}.length > 0).length`)
  const ai = await ev(`${S}.${list}${filter}.filter(r => r.${sugField}[0]?.pickedBy === 'ai').length`)
  check(got > 0, `${tab}: suggestions from its own scope`, `${got}/${total} lines, ${ai} AI picks, ${Math.round((Date.now() - t0) / 1000)} s`)
  check(await ev(`${S}.${list}${filter}.every(r => (r.concept ?? r.member) === '' || r.concept === '')`), `${tab}: nothing tagged until accepted`)
  await ev(`${S}.acceptTop()`)
  const sample = await ev(`${S}.${list}${filter}.slice(0, 6).map(r => [r.label ?? r.description ?? r.assetClass, r.concept || r.member])`)
  console.log('  ', tab, JSON.stringify(sample.map(([l, q]) => `${String(l).slice(0, 28)} → ${short(q)}`)))
  await sleep(300)
  await shot(`03-tagging-${tab}.png`)
}
const bs = await ev(`Object.fromEntries(${S}.rows.filter(r => r.statement === 'balanceSheet').map(r => [r.label, r.concept]))`)
const expect = { 'Share capital': 'ind-as:EquityShareCapital', 'Reserves and surplus': 'ind-as:OtherEquity', 'Short-term borrowings': 'ind-as:BorrowingsCurrent', 'Long-term provisions': 'ind-as:ProvisionsNoncurrent' }
for (const [label, q] of Object.entries(expect)) if (bs[label] !== undefined) check(bs[label] === q, `BS "${label}" → ${short(q)}`, `got ${short(bs[label])}`)

// 3. Company & auditor (synthetic values, not the client's)
await ev(`${S}.setStep('masters')`)
await waitFor(`${S}.fields !== null`, 'master fields', 60000)
const fields = await ev(`${S}.fields.company.map(f => [f.qname, f.type])`)
const synthetic = {
  NameOfCompany: 'Synthetic Test Private Limited', CorporateIdentityNumber: 'U72200KA2010PTC123456', PermanentAccountNumberOfEntity: 'AAACS1234A',
  AddressOfRegisteredOfficeOfCompany: '1 Test Street, Bengaluru', TypeOfIndustry: 'Commercial and Industrial', DateOfBoardMeetingWhenFinalAccountsWereApproved: '2026-05-20',
  ContentOfReport: 'Financial Statements', DescriptionOfPresentationCurrency: 'INR', LevelOfRoundingUsedInFinancialStatements: 'Actual',
  WhetherCompanyIsMaintainingBooksOfAccountAndOtherRelevantBooksAndPapersInElectronicForm: 'true',
}
for (const [q] of fields) { const local = q.split(':')[1]; if (synthetic[local]) await ev(`${S}.setCompany(${JSON.stringify(q)}, ${JSON.stringify(synthetic[local])})`) }
for (const [q, type] of await ev(`${S}.fields.auditor.map(f => [f.qname, f.type])`)) await ev(`${S}.setAuditor(${JSON.stringify(q)}, ${JSON.stringify(/boolean/i.test(type) ? 'false' : 'Unmodified opinion.')})`)
await ev(`${S}.updateSignatory(0, { din: '01234567', name: 'Asha Test', designation: 'Director' })`)
await ev(`${S}.updateSignatory(1, { din: '07654321', name: 'Ravi Test', designation: 'Director' })`)
await shot('04-masters.png')

// Save → leave → reopen from the start screen
check(await click('indas-save'), 'Save button')
await waitFor(`${S}.savedPath !== null`, 'saved', 30000)
const savedPath = await ev(`${S}.savedPath`)
check(/Synthetic Test Private Limited_Ind AS_FY \d{4}-\d{2}\.axbrl$/.test(savedPath), 'saved to the projects folder under the company and year', savedPath)
const taggedBefore = await ev(`${S}.rows.filter(r => r.concept).length + ${S}.socie.filter(r => r.concept).length + ${S}.ppe.filter(r => r.member).length`)
await ev(`${S}.closePipeline()`)
await waitFor(`!document.querySelector('[data-testid="indas-pipeline"]')`, 'back on the start screen')
await ev(`window.__xap_test__.project.getState().refreshLists()`)
await waitFor(`document.querySelector('[data-testid="welcome-saved-projects"]')?.innerText.includes('Synthetic Test Private Limited')`, 'listed in Saved projects', 15000)
check(await ev(`document.querySelector('[data-testid="welcome-saved-projects"]').innerText.includes('Ind AS')`), 'Saved projects marks it as an Ind AS project')
await shot('05-saved-projects.png')
await ev(`[...document.querySelectorAll('[data-testid="welcome-saved-projects"] button')].find(b => b.innerText.includes('Synthetic Test Private Limited')).click()`)
await waitFor(`!!document.querySelector('[data-testid="indas-pipeline"]') && ${S}.busy === null && ${S}.transform !== null`, 'reopened', 30000)
const taggedAfter = await ev(`${S}.rows.filter(r => r.concept).length + ${S}.socie.filter(r => r.concept).length + ${S}.ppe.filter(r => r.member).length`)
check(taggedAfter === taggedBefore, 'reopening restores every tag', `${taggedAfter}/${taggedBefore}`)

// 4. Generate
await ev(`${S}.setStep('generate')`)
await sleep(300)
await click('indas-generate')
await waitFor(`${S}.result !== null`, 'generate', 180000)
const result = await ev(`${S}.result`)
if (result.ok) check(true, 'XML generated into the projects folder', result.path)
else console.log('  MCA problems:', result.errors.length, JSON.stringify(result.errors.slice(0, 8), null, 1))
check(result.ok || result.errors.length > 0, 'Generate answers with the XML or the MCA problems')
await sleep(300)
await shot('06-generate-result.png')

check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
ws.close()
process.exit(failures.length ? 1 : 0)
