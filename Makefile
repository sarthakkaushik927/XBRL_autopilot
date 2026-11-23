# ============= Frontend ==================
dev-frontend:
	pnpm --filter ui dev

start-frontend:
	pnpm --filter ui preview

test-frontend:
	pnpm --filter ui exec vitest run



# ============= Backend ===================
# The backend is hosted separately: the app connects to XAP_API_URL (default http://127.0.0.1:7860).
# Local development: terminal 1 `make dev-server`, terminal 2 `pnpm dev` (or `make app`).
dev-server:
	uv run uvicorn api.app:app --host 127.0.0.1 --port 7860 --reload

dev-backend:
	uv run uvicorn api.app:app --host 0.0.0.0 --port 7860 --reload

start-backend:
	uv run uvicorn api.app:app --host 0.0.0.0 --port 7860

test-backend:
	uv run pytest $(ARGS)

# ========== Docker =======================
docker-build:
	docker build -t xbrl-autopilot-backend .

docker-run:
	docker run -p 7860:7860 --env-file .env xbrl-autopilot-backend




# ================ Rebuilding Knowlege Base VectorDb with the latest taxonomies from the data folder ======================
rebuild-knowledge-base:
	uv run python -m src.pipeline.rebuild_knowledge_base_pipeline $(ARGS)



# ================= Common ================
install:
	pnpm install --frozen-lockfile

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache build dist sidecar-dist ui/out ui/release


# ============= Bundling The App =============
# The hosted backend a packaged app connects to; override with XAP_API_URL=...
XAP_API_URL ?= http://13.127.205.133:7860

# common cammand run before start bunding for any os/destros
build-ui:
	@echo "==> Building Electron + React UI bundles (backend: $(XAP_API_URL))..."
	XAP_API_URL=$(XAP_API_URL) pnpm --filter ui build

build-app-linux: build-ui
	@echo "==> Packaging Linux Debian package (.deb) & AppImage..."
	pnpm --filter ui exec electron-builder --linux
	@mkdir -p dist
	@cp -f ui/release/*.deb dist/ 2>/dev/null || true
	@cp -f ui/release/*.AppImage dist/ 2>/dev/null || true
	@echo "==> Linux artifacts ready in dist/:"
	@ls -lh dist/*.deb dist/*.AppImage 2>/dev/null || true

build-app-windows: build-ui
	@echo "==> Packaging Windows installer (.exe)..."
	pnpm --filter ui exec electron-builder --win
	@mkdir -p dist
	@cp -f ui/release/*Setup*.exe dist/ 2>/dev/null || cp -f ui/release/*.exe dist/ 2>/dev/null || true
	@echo "==> Windows artifact ready in dist/:"
	@ls -lh dist/*.exe 2>/dev/null || true


