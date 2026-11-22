# 19 · Ind AS Fix with AI

> Built 2026-11-22 (Sarthak's decisions, [17](17-team-direction.md) log). Technical details: [07 · Ind AS: Fix with AI](07-ai-fix-agent.md#ind-as-fix-with-ai-2026-11-22). Progress: [STATUS](STATUS.md).

## What it does
When a total in the XBRL Form doesn't equal the sum of its tagged parts (a **Difference** in Problems), the AI proposes which **tags** to change so it adds up. It never changes figures and never applies anything itself: the accountant accepts each change.

## How to use it
1. **Problems** panel:
   - **✦ Fix with AI** on a Difference row fixes that one total;
   - **✦ Fix all with AI** at the top sends every Difference.
   - Company / DIN problems have no AI button: double-click opens the details dialog.
2. The left **AI chat** opens. The answer is one message: an explanation, then **one card per change**:
   - the line, its old tag (struck through) → its new tag (or *no tag*, or *opening balance*);
   - the reason;
   - the app's own **dry run** on the **whole filing**: ✓ green when the change makes things better ("5 → 3 problems"), ! amber when it doesn't. "Problems" = the totals that don't add up in every statement + the statement rules Generate applies (a fact reported twice with different amounts, totals across statements, the balance sheet, non-negative amounts). So a change that fixes one total but breaks another statement is amber (issue #20, point 4).
3. **Accept** / **Reject** each card, or **Accept the N that help**. Accept retags the line and the Difference check runs again at once. If the line was retagged after the AI answered, the card turns stale and is never applied.
   - **Accept the N that help** takes only the changes that help **together**: the helpful ones in order, each kept only when it still helps on top of those before it. The others stay open ("not with the other changes") for you to decide one by one.
   - **The MCA checks run again by themselves** about a second after the last Accept (the same checks as Generate XML; issue #20, point 3). A toast says "MCA checks re-run: N problem(s) (was M)" and Problems shows the fresh list. When nothing is left, the XML is saved as on Generate.
4. **Stop** while the AI is working: the request is aborted, the chat says "Stopped. Nothing was changed.", and an answer that still arrives is not shown. The general AI chat has Stop too.
5. Needs **AI consent** in Settings; without it the chat says so and nothing is sent.

## What goes to the AI
- **Sent:** line items, headings, amounts (CY / PY), current tags, the taxonomy's calculation around each total.
- **Never sent:** company name, CIN, PAN, DINs.

## Safety rails
- **Backend:**
  - only known lines and allowed concepts survive;
  - an opening balance only for a balance (instant) concept;
  - a part is never retagged as its own total (share capital → total equity) unless the line itself is a "Total …" line.
- **App dry run** (`indas-fix-dry-run.ts` + `indas-filing-rules.ts`):
  - every change is tried on the whole filing before it is shown: the Difference check of every statement (CY and PY) + Generate's statement rules, ported from `IndASValidator` (duplicates, totals across statements, balance sheet, non-negatives);
  - a CY total off in its statement counts once (Generate's own calculation check sees it too);
  - untagging a total's last tagged part counts as not helping, because that total is still checked; a part *moved* to another total leaves its old total with no tagged part, which neither the live check nor Generate compares, so neither does the dry run (it showed phantom problems before);
  - a fixed total traded for a new broken rule (e.g. a duplicate fact) is not "better";
  - Accept all applies only the changes that help together.

### Why AI fixes could add errors before (issue #20, point 4)
Vashu saw ~20 problems become ~50 after Fix with AI. Three causes, all fixed:
1. The dry run looked at **one statement's totals only**. Generate checks the whole filing: a line retagged to a concept another statement already reports with another amount is a `DUPLICATE_FACT_CONFLICT`; a total's parts can sit in another statement; MCA's non-negative concepts. Those changes still showed green.
2. **Accept all** applied every open card, amber ones included, and changes that help alone can undo each other together.
3. The MCA checks list in Problems stayed from the last Generate until it was clicked again, so the count mixed old and new results.

## Calculated totals (issue #20, point 5)
After Auto-tag, some red elements in the XBRL Form are totals the sheet has no line for (DGPL has no "Total equity" line). Their parts are tagged, so the app sums them. The Difference check, the Form, Fix with AI's dry run and Generate all use the same sums.

**The rules** (`indas-derived-totals.ts`, deterministic, no AI):
- **What counts as a total:** only what the MCA taxonomy's **calculation linkbase** (KB `calculation`) defines, never "Total" in a name.
- **Which ELRs:** only the calculation ELRs of the statement being tagged (its Form trees: BS 110000; P&L 210000 + 210000a; CF 310000 direct + 320000 indirect; the notes' ELRs). A total's parts differ between ELRs (OCI net of tax in 210000a vs before tax in 210000b; cash from operations direct vs indirect), so the app never takes the union.
- **Several ELRs for one total:** when the statement has more than one, it takes the one with the most reported parts (the first on a tie).
- **How it sums:** Σ weight × part, where the weights are ±1 (expenses and tax are −1). CY and PY are summed separately, in exact decimals.
  - **Opening balances** are left out.
  - **Units:** monetary parents and parts only. EPS, share counts and percentages are never summed.
  - **Periods:** parts must have the same period type as the total.
- **Levels:** bottom-up through every level. A derived total is a part of the next total up (share capital + other equity → equity attributable to owners → equity → equity and liabilities).
- **A total a line reports is never derived.** The line's own amount is used and compared with its parts.
- **Never stored:** a derived total isn't kept in the rows. It always follows its parts: retag or edit a part and it changes.

**Where it shows:**
- **XBRL Form:** the value, with a **Σ** chip. Its tooltip lists the parts and the ELR. The row is no longer red, and Empty mandatory → 0 skips it.
- **Difference check:**
  - a derived total counts as a part of the total above it, so that total can now be compared. The DGPL "Total equity and liabilities" is checked against derived equity + liabilities instead of liabilities alone;
  - a derived total is not compared itself: it equals its parts by construction;
  - the balance sheet balance uses derived Assets / Equity and liabilities too.
- **Fix with AI:** the dry run derives the same totals (the request carries each statement's ELRs, which never go to the AI). So a fix that works through a derived total reads ✓.
- **Generate XML:** main adds the derived totals to the statements it sends to `/generateXML`:
  - not one that a line of any statement reports;
  - a total two statements derive is filed once, from the first (balance sheet, P&L, cash flow, then notes).

## Limits of the free Groq tier
Groq's free tier allows 8,000 tokens a minute per model. Fix all is therefore asked in parts:
- CY and PY of one total are merged into one problem;
- each part covers one statement;
- the notes send only the lines around each problem.

A part that hits the limit waits as long as Groq says (within 4 minutes). A malformed answer is asked once more. Parts that still fail are named in the explanation ("7 total(s) were not checked: …"); the other parts' cards still show.

## Results (2026-11-22)
| Run | Result |
|---|---|
| e2e, synthetic filing, mock AI (`ui/e2e/indas-fix-ai.mjs`) | 24/24 checks pass |
| Live Groq, synthetic filing, 2 planted mistakes | both fixed, 5 s |
| Live Groq, DGPL after Auto-tag (`ui/e2e/indas-fix-ai-live.mjs`) | 28 Differences → 2 helpful changes accepted → 26 |

The DGPL details:
- **The 2 changes:** Other income sat on a comprehensive-income tag; fixed-deposit interest was counted in investing cash flow.
- **Most other totals:** the AI explained correctly that no tag change fixes them. The sheet has no "Total equity" / "Total liabilities" line, or the workbook's own figures don't add up.
- **7 totals unchecked:** 3 malformed answers and 3 rate-limited parts.

## Not done yet
- The dry run does not port Generate's company / signatory / PPE gates (not about tags) or the statement-root check (it uses ELR codes); Generate still runs the backend's full validator.
- MCA-check problems (after Generate XML) have no AI fix.
- A total derived in the notes that the balance sheet also derives with another amount is filed once (from the balance sheet); the notes' Form still shows its own sum.
- gpt-oss-120b sometimes returns malformed tool calls; they are retried once.

## Code map
| Part | Where |
|---|---|
| Route | `POST /api/v1/indas/fix` (`api/v1/routes/indas_router.py`, schema `FixRequest`) |
| AI service | `src/services/indas_fix.py` (prompt, KB calculation, parts, guard rails) |
| Dry run | `ui/electron/main/services/indas-fix-dry-run.ts` (+ `checkedTotals` in `indas-difference-check.ts`) |
| Calculated totals | `ui/electron/main/services/indas-derived-totals.ts` (`deriveTotals`, `deriveFiling`); tests `ui/test/indas-derived-totals.test.ts` |
| Main | `IndasPipelineService.proposeFix`, IPC `indas:fix` |
| Renderer | `features/indas/fix.ts`, `stores/indas-fix.ts`, `features/indas/IndasFixMessages.tsx` (in `AiChatPanel`), buttons in `IndasProblemsPanel.tsx` |
| Tests | `tests/test_indas_fix.py`, `ui/test/indas-fix.test.ts`, `ui/test/indas-fix.renderer.test.ts`, `ui/e2e/indas-fix-ai.mjs`, `ui/e2e/indas-fix-ai-live.mjs` |
