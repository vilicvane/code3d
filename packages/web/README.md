# Website

Astro serves the custom homepage and examples. Starlight serves `/docs/`.
App is built separately by Vite and copied into `dist/www/app/`.

From the repository root:

```bash
npm install
npm run build:packages
npm run build --workspace @code3d/app
npm run render:web-images
npm run dev --workspace @code3d/web
```

The image renderer uses Playwright Chromium. Install it with
`npx playwright-core install chromium`, or set
`CODE3D_CHROME_CDP_ENDPOINT=http://localhost:9222` to use an existing debugging
browser. The renderer closes its own pages and leaves that browser running.

## Content

- User documentation: `src/content/docs/docs/` (the inner directory is the
  `/docs/` URL prefix).
- Executable examples: `../app/examples/`. The shared catalog stores paths
  relative to this directory, including both website examples and existing
  App examples; do not copy a model just to add it to the gallery.
- Example metadata and source contexts: `../app/render-samples/catalog.ts`.
  `sourceContextSets` supplies the tabs, highlighted source tokens, and image
  names for the homepage and interactive example pages. The final context is
  selected initially. Each token must identify one occurrence in its source.
- Generated model images: `src/assets/models/`. Regenerate after changing
  examples, source contexts, or the renderer; CI regenerates them on every build.
- Site identity and URL helpers: `src/lib/site.ts`.
- Website and docs font loading: `src/components/Fonts.astro`. Font faces are
  declared in the initial HTML and the main Latin subsets are preloaded;
  optional font display prevents late font swaps from shifting page content.
- Shared App and website icons: root `assets/brand/`. `mark.svg` is the
  side-by-side mark used in headers and the social image; `favicon.svg` brings
  the diamonds closer together for small sizes. Both builds publish these assets.
- License text: the root `LICENSE`, served unchanged at `/license.txt` and
  included in the App build. Packages using Code3D's interim license copy it
  during `npm pack`. `@code3d/solver` ships its own `LICENSE.LGPL-2.1` under
  LGPL-2.1-or-later; see the [solver README](../solver/README.md).

Example code is bundled into App's managed examples, loaded by Astro's
content collection, and executed by the image renderer. Keep snippets and
gallery content connected to these source files.
App and the image renderer share `../app/src/model/source-decorations.ts` so
relation, bound, operation, and origin markers appear consistently in both.

## Build and verify

```bash
npm run build --workspace @code3d/web
npm run preview --workspace @code3d/web
```

The build checks Astro templates and TypeScript, generates the static site and
Pagefind index, includes App, and validates internal links, anchors, and
asset references. Preview the production build when testing search; Pagefind
indexes the build output.

Set `CODE3D_SITE_URL` to the public site URL for production, for example
`https://example.com/` or `https://example.com/code3d/`. It sets canonical URLs,
sitemap origin, and the optional deployment base path. Use the same value for
build and preview. Without it, local builds omit origin-specific metadata.

Astro's checker uses the website's TypeScript 6 compiler for its whole process.
This isolates the JavaScript compiler API required by Volar from the repository's
native TypeScript 7 compiler.

## Cloudflare deployment

The website, docs, and App are one Workers Static Assets deployment, configured
by the root `wrangler.jsonc`. No server-side Worker or Astro adapter is needed.
The production site URL is `https://www.code3d.org/`.

For a local deployment, use Node.js 24 and run from the repository root:

```bash
npm ci
export CODE3D_SITE_URL=https://www.code3d.org/
npm run build
npm run deploy
```

This uses the checked-in model images. To regenerate them, run
`npm run render:web-images` after building App, then rebuild the website.

GitHub Actions regenerates model images and builds the complete artifact before
deploying. Automatic deployment from `main` is enabled by setting the repository
variable `CLOUDFLARE_ACCOUNT_ID` and secret `CLOUDFLARE_API_TOKEN` (an account-scoped
Workers deployment token). Without the account variable, CI only builds and
uploads the artifact. Local Wrangler OAuth credentials are never copied to CI.

`www.code3d.org` is declared as a Worker Custom Domain in `wrangler.jsonc`.
Cloudflare manages its DNS record and certificate; do not add a competing CNAME.
The `workers.dev` address also remains available for deployment verification.
Keep normal static routing and 404 handling: App's file navigation uses URL
hashes, not a site-wide SPA fallback.

Finish building before starting `npx wrangler dev` to preview the production
artifact. Rebuilding Astro while this preview runs can leave Wrangler's local
asset index pointing at the intermediate empty output directory; reload its
configuration after the build if necessary. For source changes, use Astro dev.
