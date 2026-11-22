
# --- Launch Desktop Application ---
app:
	pnpm --filter ui dev


# ============= Backend ===================
# The backend is hosted separately: the app connects to XAP_API_URL (default http://127.0.0.1:7860), it never starts it.
# Local development: terminal 1 `make dev-server`, terminal 2 `pnpm dev` (or `make app`).
dev-server:
	uv run uvicorn api.app:app --host 127.0.0.1 --port 7860 --reload

dev-backend:
	uv run uvicorn api.app:app --host 0.0.0.0 --port 7860 --reload

start-backend:
	uv run uvicorn api.app:app --host 0.0.0.0 --port 7860

test-backend:
	uv run pytest $0

rebuild-knowlege-base:
	uv run python -m src.pipeline.rebuild_knowledge_base_pipeline $(ARGS)



# ================= Common ================
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache build dist sidecar-dist ui/out ui/release

# --- Packaging & Distribution (Phase 11b / docs/10-packaging-release.md) ---

build-sidecar:
	@echo "==> Building Python sidecar bundle (PyInstaller)..."
	uv run pyinstaller sidecar.spec --distpath sidecar-dist --workpath build/pyinstaller --noconfirm

# The hosted backend a packaged app connects to (Vashu's CI/CD deploys it on merge); override with XAP_API_URL=...
XAP_API_URL ?= http://13.127.205.133:7860

build-ui:
	@echo "==> Assembling deterministic engine authorities..."
	node engine/scripts/assemble-authority.mjs
	@echo "==> Building Electron + React UI bundles (backend: $(XAP_API_URL))..."
	XAP_API_URL=$(XAP_API_URL) pnpm --filter ui build

build-win: build-ui
	@echo "==> Packaging Windows installer..."
	pnpm --filter ui exec electron-builder --win
	@mkdir -p dist
	@cp -f ui/release/*Setup*.exe dist/ 2>/dev/null || cp -f ui/release/*.exe dist/ 2>/dev/null || true
	@echo "==> Windows artifact ready in dist/:"
	@ls -lh dist/*.exe

build-linux: build-ui
	@echo "==> Packaging Linux AppImage & Debian package..."
	pnpm --filter ui exec electron-builder --linux
	@mkdir -p dist
	@cp -f ui/release/*.AppImage dist/ 2>/dev/null || true
	@cp -f ui/release/*.deb dist/ 2>/dev/null || true
	@echo "==> Linux artifacts ready in dist/:"
	@ls -lh dist/*.AppImage dist/*.deb

build_app: build-ui
	@echo "==> Packaging shareable applications for Windows and Linux..."
	pnpm --filter ui exec electron-builder --win --linux
	@mkdir -p dist
	@rm -f dist/*
	@cp -f ui/release/*Setup*.exe dist/ 2>/dev/null || cp -f ui/release/*.exe dist/ 2>/dev/null || true
	@cp -f ui/release/*.AppImage dist/ 2>/dev/null || true
	@cp -f ui/release/*.deb dist/ 2>/dev/null || true
	@echo ""
	@echo "=========================================================="
	@echo "  XBRL Autopilot - Shareable Application Build Complete!  "
	@echo "=========================================================="
	@echo "Artifacts placed in dist/:"
	@ls -lh dist/
	@echo "=========================================================="

build-app: build_app

# Catch-all rule so make does not error on extra goal arguments
%:
	@:
