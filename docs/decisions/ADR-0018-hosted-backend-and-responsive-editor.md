# ADR-0018 · The backend is hosted separately; the editor stays responsive
- **Status:** accepted (2026-11-22, Vashu's PR #15 review; Sarthak). Branch `integrate/vashu-main`.
- **Context:**
  - The app spawned the Python sidecar itself (`SidecarManager`: free port, token, `uv run` / PyInstaller exe, restarts, kill on quit). Vashu: the backend will be hosted separately (CI/CD deploys it on merge to `http://13.127.205.133:7860`). The app should only connect to a URL from the environment. Local development: terminal 1 `make dev-server`, terminal 2 `pnpm dev`.
  - "The app hangs a lot." Measured on the DGPL workbook (`ui/e2e/indas-perf.mjs`, a CPU profile per sheet):
    - Showing the 179-row notes sheet took **219 s**; cash flow 2.3 s; P&L 1.0 s. Almost all of it was in Univer's `sortRules` / `getObjectsByOrder`.
    - The grid drew one highlight shape per tagged / suggested cell (179 rows × 3 cells = 537 shapes), and Univer re-sorts every shape on each add. The whole overlay was also redrawn on every click.
    - Most Ind AS components read the whole store (`useIndas()`), so a selection or progress change re-rendered the whole window, every Form row included.
    - During Auto-tag the backend's `/health` stopped answering: `rank_scope` (embeddings + reranker) ran on uvicorn's event loop.
- **Decision:**
  1. **`BackendClient`** (`ui/electron/main/infra/backend-client.ts`, Electron-free, `fetch` injected) replaces `SidecarManager`:
     - **URL:** `XAP_API_URL` from the process environment, then the dev `.env`, then the value baked in at build time (`electron.vite.config.ts` `define`). The default is `http://127.0.0.1:7860`, where `make dev-server` serves.
     - **Token:** `XAP_API_TOKEN`, optional; sent as a Bearer token when the backend requires one.
     - **Health:** checked every 15 s while connected, every 3 s while not. A slow `/health` from a connected backend means it is busy, not gone. Only a refused connection marks it unreachable.
     - **Unchanged:** the services' ports (`SidecarClient`, `SidecarFileClient`), so no service changed. "Restart AI engine" became **Reconnect**.
     - **Builds:** `make build-ui` bakes in `XAP_API_URL` (default: the hosted server). The installer no longer bundles the sidecar.
  2. **Grid overlay:** cells are merged into the fewest rectangles before drawing (`compactRanges`, `shared/workbook.ts`). The tag colours and the selected line are separate layers, so a click redraws only the selection.
  3. **Renderer:** narrow `useShallow` selectors. Form rows are memoised and read no store. A statement renders in the background (`useDeferredValue`) behind a thin progress line.
  4. **Backend:** the scoped ranking and the rerank run in `asyncio.to_thread`, so the other routes keep answering during Auto-tag.
  5. **Loading feedback:** see the review's points 2–4.
     - **Busy overlay:** long work (Auto-tag, converting, Generate, opening) shows a modal `BusyOverlay` over the editor: the step and a progress bar over every request of the run. Menu commands that change the filing wait until it is done.
     - **Cancel / Continue:** Auto-tag's overlay has Cancel. Main aborts the remaining batches (`IndasController.cancelRecommend`, an `AbortSignal` checked between batches of 20). The lines done keep their tags. "Continue auto-tag (N left)" asks only for lines without suggestions (`autoTagTodo` / `autoTagRemaining`).
     - **Background calls:** every IPC call is tracked (`useActivity`), and a thin line above the status bar shows while one runs longer than 300 ms.
     - **Panes:** a pane waiting for data shows `Loading`.
- **Result (same project, dev build):**
  - Notes sheet: 219 s → 0.64 s; cash flow 2.3 s → 0.30 s.
  - Every timed action (open a statement, click a line, switch a sheet, open a problem) finishes in under 0.45 s; average 16–240 ms.
- **Consequences:**
  - The app needs a running backend: locally `make dev-server`, else the hosted one.
  - The `.env` Groq key and model now live with the backend. The app's Settings no longer pass them on.
  - The PyInstaller sidecar spec stays for building a server bundle; it is no longer shipped in the installer.
