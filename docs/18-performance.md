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

## Faster Auto-tag: parallel batches (2026-11-22, `perf/autotag-parallel`)

Auto-tag sends a sheet's lines to the backend in batches of 20. **Settings → Auto-tag → "Faster Auto-tag (3–4 batches at once)"** sends up to 4 at a time (`RECOMMEND_PARALLEL`). **Off by default** until it has been tried on the hosted backend with AI on.
- **Off:** one batch at a time, exactly as before.
- **On:** the sheet's first batch goes alone, then 4 at a time.
  - **Why the first goes alone:** on its first call for a sheet, the backend embeds the sheet's concepts and keeps them in memory. If 4 first calls arrived together, each would embed them (1,843 concepts for the notes).
  - **Unchanged:** suggestions come back in line order, the progress bar counts lines done, and Cancel starts no new batch. The batches already running finish first, then Auto-tag stops as before.
  - **Code:** `IndasPipelineService.recommend` over `runLimited` (`ui/electron/main/util/run-limited.ts`, a small concurrency limit); the setting is `AppSettings.parallelAutoTag`.
  - **Groq:** with AI on, more batches at once means more rate limits (429). The backend then switches to the next model, so a few AI picks can differ.

Measured on DGPL (`ui/e2e/indas-perf.mjs`, dev build, laptop backend, no AI, 256 lines; `XAP_PERF_PARALLEL=1` switches it on):

| Auto-tag | Off | On |
|---|---|---|
| Backend already warm (the hosted server after its first Auto-tag) | 34 s | **22 s** |
| Backend just started (cold) | 161 s | 162 s |

- **Same result:** the tags were the same in both modes, 256 of 256 lines with the same suggestion lists.
- **The gain is 1.5×, not 3–4×:** most sheets have only 1–3 batches, and the first goes alone.
- **On a cold backend almost all the time is the first call per sheet:** 26 s for the balance sheet (loading the models) and **95 s for the notes** (embedding 1,843 concepts on one CPU core). Parallel batches can't help there. Saving those embeddings once (next steps, point 1) is the bigger gain.

## What to optimise next

Ordered by expected gain. Points 1–3 come from numbers measured on 2026-11-22; 4–6 are estimates to measure first.

1. **Faster Auto-tag (the biggest remaining wait: 31–209 s without AI, 173 s with it).**
   - **Parallel batches:** done, behind a setting (section above): 34 s → 22 s on a warm backend. Next: switch it on by default once it has run on the hosted backend with AI on.
   - **Cache the concepts' embeddings on disk (now the biggest item):** `rank_scope` caches them only in memory (`_scope_matrix`, `lru_cache`), so after each backend start the first Auto-tag pays 95 s for the notes and 26 s for the balance sheet. Compute them once (at `make rebuild`) and save them. Backend: ask Vashu first.
   - **Lighter models:** convert the embedding model and the reranker to ONNX or a quantized form. Usually 2–4× faster at nearly the same quality.
2. **Less memory on the CA's laptop.** During testing the machine had about 375 MB of free memory left, and everything slows down when memory runs out.
   - **Python backend (~1.1 GB):** moving it to the hosted server frees that on the laptop. Done; it takes effect once the server is up.
   - **Univer spreadsheet view:** the renderer reaches about 750 MB after tagging. Check whether it keeps data it no longer needs.
3. **Measure the installed app.** All numbers above come from the dev build, which is several times slower. Time the packaged build to see what CAs actually feel; some items below may then be unnecessary.
4. **Draw only what's on screen ("virtualize").** Long lists draw every row: the XBRL Form (notes statements), the taxonomy tree (up to 1,843 concepts) and Problems. Probably most of the remaining 0.64 s on the Notes sheet.
5. **Faster first open.** The app downloads the whole knowledge base (`/authority`) on first open.
   - **Compress responses:** switch on gzip on the server (`GZipMiddleware`, one line).
   - **Cache it on disk:** download again only when the server's version changes.
6. **Fewer round trips to the remote server.** Send a whole sheet in one request and stream the progress back, instead of many small requests.
7. **Keep it fast.** Run `ui/e2e/indas-perf.mjs` in CI, so a change that makes any action slower than its limit fails before it ships.

**Suggested first step:** 1 (parallel Auto-tag batches): one service file, and it should cut Auto-tag time several-fold.
