import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'shared')
// XAP_TEST_BUILD=1 (perf runs of the packaged app, docs/18): a production bundle that keeps the e2e hooks
// (window.__xap_test__) and honours XAP_USER_DATA. Off in every normal build.
const testBuild = JSON.stringify(process.env.XAP_TEST_BUILD === '1')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    // the backend URL of a packaged build: XAP_API_URL at build time (at run time the environment wins)
    define: { __XAP_API_URL__: JSON.stringify(process.env.XAP_API_URL ?? ''), __XAP_TEST_BUILD__: testBuild },
    build: {
      // the engine workspace package ships TS/ESM source: bundle it into main instead of require()-ing it
      externalizeDeps: { exclude: ['@xap/engine'] },
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // Sandboxed preload: bundle everything into one CJS file.
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload/index.ts') } },
    },
  },
  renderer: {
    root: __dirname,
    resolve: {
      alias: { '@': resolve(__dirname, 'src'), '@shared': shared },
    },
    plugins: [react(), tailwindcss()],
    define: { __XAP_TEST_BUILD__: testBuild },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'index.html') } },
    },
  },
})
