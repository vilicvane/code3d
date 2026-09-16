/** Shared cancellation requires isolation for both the App document and its Workers. */
export const appIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Every App asset name carries a content hash, so a URL never changes meaning. */
const assetHeaders = {
  'Cache-Control': 'public, max-age=31536000, immutable',
};

/**
 * Cloudflare maps the TypeScript extensions to `video/mp2t`, which is not a
 * compressible content type; declaration and navigation sources are plain text.
 */
const declarationHeaders = {
  'Content-Type': 'text/plain; charset=utf-8',
};

/** Cloudflare maps `.cjs` to `application/node`, which it does not compress. */
const commonJsHeaders = {
  'Content-Type': 'text/javascript; charset=utf-8',
};

type HeaderRule = readonly [pattern: string, headers: Record<string, string>];

function headerRules(rules: readonly HeaderRule[]): string {
  return rules
    .map(
      ([pattern, headers]) =>
        `${pattern}\n${Object.entries(headers)
          .map(([name, value]) => `  ${name}: ${value}`)
          .join('\n')}\n`,
    )
    .join('\n');
}

/** Cloudflare `_headers` rules for the App mounted at `prefix` (`''` or `/app`). */
export function appHeaderRules(prefix: string): string {
  return headerRules([
    [`${prefix}/*`, appIsolationHeaders],
    [`${prefix}/assets/*`, assetHeaders],
    [`${prefix}/assets/*.ts`, declarationHeaders],
    [`${prefix}/assets/*.mts`, declarationHeaders],
    [`${prefix}/assets/*.cts`, declarationHeaders],
    [`${prefix}/assets/*.cjs`, commonJsHeaders],
  ]);
}
