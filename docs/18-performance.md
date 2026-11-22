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
- **On a cold backend almost all the time is the first call per sheet:** 26 s for the balance sheet (loading the models) and **95 s for the notes** (embedding 1,843 concepts on one CPU core). Parallel batches can't help there. Saving those embeddings once would be the bigger gain (Vashu's, next steps point 1).

## The installed app (packaged build, 2026-11-22, `perf/packaged-timing`)

All earlier numbers come from the dev build. This is the app as a CA gets it: the production bundle in `release/win-unpacked` (the same files the installer copies), DGPL workbook, laptop backend, no AI. Dev was run right after on the same machine and the same saved project.

| Action | Dev build | **Installed app** |
|---|---|---|
| Reload the window → start screen | 1.5 s | **0.66 s** |
| Open a statement (54×) | 101 ms average, 274 ms longest | **9 ms**, 37 ms longest |
| Click a line (21×) | 114 ms, 188 ms longest | **18 ms**, 27 ms longest |
| Switch Excel sheet (12×, Notes included) | 229 ms, 387 ms longest | **48 ms**, 71 ms longest |
| Double-click a problem (6×) | 11 ms | **4 ms** |
| JS memory (heap) at the end | 132 MB | **49 MB** |
| Open the workbook (`.xls`, converted by the backend) | — | 5.2 s |
| Auto-tag, 256 lines (backend just started) | — | 137 s |

What this means:
- **Clicking around is instant in the installed app.** It is 5–10× faster than dev, and no action reached 100 ms (the point where people start to notice a delay).
- **The only waits a CA still sees are on the backend:** Auto-tag and, less so, opening the workbook.
- **Memory:** all of the app's processes together use about 750–870 MB in both builds, the largest about 360 MB. That was the "750 MB" seen before: the whole app, not the spreadsheet. The JS data, Univer's included, is under 50 MB after Auto-tag and every sheet shown, so Univer doesn't keep data it no longer needs. The rest is Chromium's own (GPU, drawing, code).

How to run it again:
1. Build: `XAP_TEST_BUILD=1 XAP_API_URL=http://127.0.0.1:<port> pnpm --filter ui build`, then `pnpm --filter ui exec electron-builder --win --dir`. `XAP_TEST_BUILD=1` keeps the e2e hooks and `XAP_USER_DATA`; a normal build has neither.
2. Start the app: `XAP_USER_DATA=<temp dir> "ui/release/win-unpacked/XBRL Autopilot.exe" --remote-debugging-port=<port>`.
3. Time it: `node ui/e2e/indas-perf.mjs <port> <screenshotDir> <workbook> 150 [saved.axbrl]`.

## What to optimise next

Re-ordered after the measurements above.

1. **Auto-tag: the biggest wait left (137 s on a just-started backend, 22–34 s on a warm one).** All of it is backend time.
   - **Parallel batches:** done, behind a setting (section above). Next: on by default once it has run on the hosted backend with AI on.
   - **Concept embeddings saved to disk, lighter models (ONNX / quantized): not ours. Left to Vashu** (Sarthak, 2026-11-22). For him: `rank_scope` already keeps the embeddings in memory (`_scope_matrix`, `lru_cache`), so only the first Auto-tag after a backend start pays for them (95 s for the notes, 26 s for the balance sheet).
2. **Faster first open.**
   - **Compress responses:** done (gzip, `perf/backend-gzip`): the knowledge base download goes from 4.3 MB to 356 KB.
   - **Keep the knowledge base on disk:** the app needs a way to know when the server's copy changed. `/health`'s `version` is fixed (`"0.1.0"`), so it can't tell.
     - **Server: Vashu's.** It would send an `ETag` (a hash of the file) on `/authority` and answer `304 Not Modified` when the app's copy is current.
     - **App: done** (`perf/kb-disk-cache`).
       - **Where:** `<userData>/cache/indas-authority.json`, holding the copy, its `ETag` and the server it came from.
       - **Each session** asks with `If-None-Match`. On a `304` it uses the copy; on a `200` it replaces it.
       - **Until the server sends an ETag:** nothing is kept and the app downloads every session, as before.
       - **Never used:** a copy from another server (`XAP_API_URL` changed), or a damaged file.
       - **Code:** `CachedKnowledgeBase` (`ui/electron/main/services/cached-knowledge-base.ts`) over two ports, `ConditionalGetClient` (`BackendClient.getIfChanged`) and `CachedAnswerStore` (`JsonFileCache`).
       - **Checked live** behind a test proxy that adds a content ETag:
         - session 1: `200`, 4.3 MB saved; session 2: `304`, copy used;
         - same results with and without the copy: 55 statements, identical Difference checks.
3. **Keep it fast.** Run `ui/e2e/indas-perf.mjs` on the packaged build in CI with a 150 ms limit per action. A change that makes any action slower then fails before it ships.
4. **Future improvement: draw only the rows on screen** in long lists (XBRL Form, taxonomy tree up to 1,843 concepts, Problems). Not needed now: the longest action in the installed app is 71 ms. Take it up when a bigger filing goes over 100 ms, and keep "scroll to the fact" working.
5. **Skipped: Univer memory.** Nothing to fix: the JS data, Univer's included, is under 50 MB; the rest is Chromium's own.
6. **Fewer round trips to the remote server** (a whole sheet per request, progress streamed back): Vashu's review first.
