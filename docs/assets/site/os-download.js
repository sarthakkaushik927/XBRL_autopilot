/**
 * Points the page's main download buttons at the build for the visitor's system.
 * The HTML ships the Windows build, so the page works without script; this only swaps it.
 *
 * @typedef {'windows' | 'linux' | 'mac' | 'mobile' | 'other'} Os
 * @typedef {{ label: string, file: string, size: string }} Build
 * @typedef {{ version: string, base: string, builds: Record<string, Build>, fallback: { label: string, href: string } }} Releases
 */

/** Reads the system from what the browser reports. Pure: pass any navigator-like object. @returns {Os} */
export function detectOs(nav) {
  const p = `${nav?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(p)) return 'mobile';
  if (/win/.test(p)) return 'windows';
  if (/mac/.test(p)) return 'mac';
  if (/linux|x11|cros/.test(p)) return 'linux';
  return 'other';
}

/** The build to offer for a system, or null when there is none (macOS, phones). @returns {Build | null} */
export const buildFor = (os, releases) => releases.builds[os] ?? null;

/** What a main download button shows and where it goes. */
export function downloadAction(os, releases) {
  const build = buildFor(os, releases);
  return build
    ? { label: build.label, href: releases.base + build.file, build }
    : { label: releases.fallback.label, href: releases.fallback.href, build: null };
}

/**
 * Rewrites every `[data-download="main"]` (label in its first text node, so a trailing arrow icon stays)
 * and marks the matching card in the download section with `data-yours`.
 */
export function applyDownload(root, os, releases) {
  const action = downloadAction(os, releases);
  for (const a of root.querySelectorAll('[data-download="main"]')) {
    a.href = action.href;
    const text = [...a.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (text) text.textContent = action.label;
  }
  for (const card of root.querySelectorAll('[data-build]')) {
    card.toggleAttribute('data-yours', card.dataset.build === os);
  }
  for (const el of root.querySelectorAll('[data-download="size"]')) {
    el.textContent = action.build ? `Version ${releases.version}, free, ${action.build.size}.` : `Version ${releases.version}, free, for Windows and Linux.`;
  }
  return action;
}
