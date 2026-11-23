/**
 * Dev-only hooks for automated end-to-end runs (window.__xap_test__). Compiled out of production builds:
 * `import.meta.env.DEV` and `__XAP_TEST_BUILD__` are build-time constants, so the body below is dead code in
 * `pnpm build`. An `XAP_TEST_BUILD=1` build keeps it, to time the packaged app (docs/18).
 */
export function registerTestHook(name: string, value: unknown): void {
  if (!import.meta.env.DEV && !(typeof __XAP_TEST_BUILD__ === 'boolean' && __XAP_TEST_BUILD__)) return
  const w = window as unknown as { __xap_test__?: Record<string, unknown> }
  w.__xap_test__ ??= {}
  w.__xap_test__[name] = value
}
