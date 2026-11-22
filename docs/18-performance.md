# 18 · Performance: what was fixed, and what to optimise next

Started 2026-11-22 from Vashu's PR #15 review ("the application hangs a lot"). The technical record is [ADR-0018](decisions/ADR-0018-hosted-backend-and-responsive-editor.md); this doc explains it in plain words and keeps the list of next steps.

## What was fixed (2026-11-22)

Measured on the DGPL workbook, dev build (`ui/e2e/indas-perf.mjs`, CPU profiles per sheet):

| Action | Before | After |
|---|---|---|
| Show the Financial notes sheet | **219 s** | **0.64 s** |
| Show the Cash flow sheet | 2.3 s | 0.30 s |
| Show the P&L sheet | 1.0 s | 0.29 s |
| Click a line (average of 21) | not timed* | 99 ms |
| Open a statement (average of 54) | not timed* | 90 ms |
| Double-click a problem | not timed* | 16 ms |

\* The old build froze for 3–15 s at a time while switching sheets, so these weren't timed.

The three causes, in plain words:

1. **The Excel sheet drew its colours the slow way.** The tag colours are boxes drawn on top of the cells, one box per cell: 537 on the Notes sheet. Univer re-sorts every box each time one is added, so 537 boxes took hundreds of thousands of sort steps.
   - **Neighbouring cells:** neighbouring cells of the same colour now share one box (`compactRanges`), so the Notes sheet needs 2–3 boxes.
   - **A click:** moves only the blue "selected" box instead of redrawing everything.
2. **Every click redrew the whole window.** Every panel listened to all of the app's data, so any change redrew everything, every Form row included. Now each panel listens only to what it shows (`useShallow` selectors), and unchanged Form rows are skipped (`memo`).
3. **The backend couldn't answer during Auto-tag.** The heavy AI matching (embeddings + reranker) ran on the same lane that answers requests, so even `/health` went unanswered. It now runs on a side lane (`asyncio.to_thread`).

Slow work also shows a progress card with Cancel, so a long Auto-tag doesn't feel like a hang.

## What to optimise next

Ordered by expected gain. Points 1–3 come from numbers measured on 2026-11-22; 4–6 are estimates to measure first.

1. **Faster Auto-tag (the biggest remaining wait: 31–209 s without AI, 173 s with it).**
   - **Parallel batches:** lines go in batches of 20, one batch at a time. Sending 3–4 batches at once should divide the time by about 3–4; the limit is Groq's rate limit, and we already switch models on a 429. The change is in `IndasPipelineService.recommend`.
   - **Lighter models:** convert the embedding model and the reranker to ONNX or a quantized form. Usually 2–4× faster at nearly the same quality.
   - **Cache the concepts' embeddings:** the taxonomy never changes, so compute them once and save them. Check first whether `rank_scope` already caches.
2. **Less memory on the CA's laptop.** During testing the machine had about 375 MB of free memory left, and everything slows down when memory runs out.
   - **Python backend (~1.1 GB):** moving it to the hosted server frees that on the laptop. Done; it takes effect once the server is up.
   - **Univer spreadsheet view:** the renderer reaches about 750 MB after tagging. Check whether it keeps data it no longer needs.
3. **Measure the installed app.** All numbers above come from the dev build, which is several times slower. Time the packaged build to see what CAs actually feel; some items below may then be unnecessary.
4. **Draw only what's on screen ("virtualize").** Long lists draw every row: the XBRL Form (notes statements), the taxonomy tree (up to 1,843 concepts) and Problems. Probably most of the remaining 0.64 s on the Notes sheet.
5. **Faster first open.** The app downloads the whole knowledge base (`/authority`) on first open.
   - ✅ **Compress responses (2026-11-22):** gzip on the server (`GZipMiddleware` in `api/app.py`, responses ≥ 1 KB, streamed chat left as is). `/indas/authority` goes from **4.3 MB to 356 KB** (12× smaller). The app's `fetch` asks for gzip and unpacks it by itself, so no app change was needed. Test: `tests/test_gzip.py`.
   - **Cache it on disk:** download again only when the server's version changes.
6. **Fewer round trips to the remote server.** Send a whole sheet in one request and stream the progress back, instead of many small requests.
7. **Keep it fast.** Run `ui/e2e/indas-perf.mjs` in CI, so a change that makes any action slower than its limit fails before it ships.

**Suggested first step:** 1 (parallel Auto-tag batches): one service file, and it should cut Auto-tag time several-fold.
