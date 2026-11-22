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
   - the app's own **dry run**: ✓ green when the change alone makes things better ("2 → 0 totals off"), ! amber when it doesn't.
3. **Accept** / **Reject** each card, or **Accept all**. Accept retags the line and the Difference check runs again at once. If the line was retagged after the AI answered, the card turns stale and is never applied.
4. Needs **AI consent** in Settings; without it the chat says so and nothing is sent.

## What goes to the AI
- **Sent:** line items, headings, amounts (CY / PY), current tags, the taxonomy's calculation around each total.
- **Never sent:** company name, CIN, PAN, DINs.

## Safety rails
- **Backend:**
  - only known lines and allowed concepts survive;
  - an opening balance only for a balance (instant) concept;
  - a part is never retagged as its own total (share capital → total equity) unless the line itself is a "Total …" line.
- **App dry run:**
  - every change is tried alone with the live Difference check before it is shown;
  - removing a total's last tagged part counts as not helping, because the total is still checked.

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
- MCA-check problems (after Generate XML) have no AI fix.
- A total missing from the sheet can't be fixed by retagging. The Difference check doesn't derive intermediate totals.
- gpt-oss-120b sometimes returns malformed tool calls; they are retried once.

## Code map
| Part | Where |
|---|---|
| Route | `POST /api/v1/indas/fix` (`api/v1/routes/indas_router.py`, schema `FixRequest`) |
| AI service | `src/services/indas_fix.py` (prompt, KB calculation, parts, guard rails) |
| Dry run | `ui/electron/main/services/indas-fix-dry-run.ts` (+ `checkedTotals` in `indas-difference-check.ts`) |
| Main | `IndasPipelineService.proposeFix`, IPC `indas:fix` |
| Renderer | `features/indas/fix.ts`, `stores/indas-fix.ts`, `features/indas/IndasFixMessages.tsx` (in `AiChatPanel`), buttons in `IndasProblemsPanel.tsx` |
| Tests | `tests/test_indas_fix.py`, `ui/test/indas-fix.test.ts`, `ui/test/indas-fix.renderer.test.ts`, `ui/e2e/indas-fix-ai.mjs`, `ui/e2e/indas-fix-ai-live.mjs` |
