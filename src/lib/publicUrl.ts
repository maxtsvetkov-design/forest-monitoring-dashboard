/**
 * Prefixes a root-relative path (e.g. "/overlays/al-maha-aerial.png") into
 * one resolvable from wherever this build is actually served — `/` for a
 * local dev server or a GitHub Pages user/root page, but a subpath like
 * "/forest-monitoring-dashboard/" for a GitHub Pages *project* page (see
 * vite.config.ts's GITHUB_PAGES_BASE and .github/workflows/deploy.yml).
 *
 * Vite rewrites import/`<img src>`-style asset references for `base`
 * automatically, but these files live in `public/` and are referenced as
 * plain strings (MapLibre source URLs, CSS background-image values), which
 * Vite has no way to see and rewrite at build time — hence this helper.
 * `import.meta.env.BASE_URL` is Vite's own runtime reflection of `base`,
 * always normalised to a trailing slash.
 */
export function publicUrl(rootRelativePath: string): string {
  return `${import.meta.env.BASE_URL}${rootRelativePath.replace(/^\//, "")}`;
}
