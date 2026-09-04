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
- Executable examples: `../app/examples/website/`.
- Example metadata and source contexts: `../app/render-samples/catalog.ts`.
- Generated model images: `src/assets/models/`. Regenerate after changing
  examples, source contexts, or the renderer; CI regenerates them on every build.
- Site identity and URL helpers: `src/lib/site.ts`.

Example code is bundled into App's managed examples, loaded by Astro's
content collection, and executed by the image renderer. Keep snippets and
gallery content connected to these source files.

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
