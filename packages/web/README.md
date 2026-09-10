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

## Agent documentation and local prompts

[The human introduction](src/content/docs/docs/guides/agents.md) explains
collaboration features at `/docs/guides/agents/`. Agent prompts instead open
[the required Markdown entry](../../docs/agents.md) at `/docs/agents.md`.
[Detailed topics](../../docs/agents/) cover operations, modeling and recovery;
[useful modeling packages](../../docs/agents.md#useful-modeling-packages) introduce
the main authoring libraries. All packages maintain READMEs for human and agent
readers, but the website publishes only the selected modeling packages.

The [Markdown publisher](scripts/markdown-documents.mjs) serves these existing
sources through [one static endpoint](src/pages/docs/[...document].md.ts):

| Repository source                            | Published Markdown                        |
| -------------------------------------------- | ----------------------------------------- |
| `docs/agents.md` and `docs/agents/*.md`      | `/docs/agents.md` and `/docs/agents/*.md` |
| `packages/{core,materials,screws}/README.md` | `/docs/packages/<package>.md`             |
| `src/content/docs/docs/**/*.{md,mdx}`        | `/docs/<topic>.md`                        |

The publisher's `featuredPackages` list selects Core, Materials and Screws.
Additional packages are selected for their value to model authors; adding a
workspace package does not automatically add a website page or an entry in the
agent guide. Lower-level dependency READMEs stay in their packages, discoverable
through GitHub or an installed `node_modules` tree. Links to an unpublished README
resolve to its repository source rather than creating a website mirror.

Keep links relative to real repository files in agent docs and READMEs. The
publisher maps documentation links to relative Markdown URLs and source links
to readable repository files at the checkout’s current commit. Build deployment
artifacts after committing; push that commit so the source links are reachable. Website pages retain their HTML-relative links;
the publisher resolves these for Markdown too. Starlight frontmatter becomes an
ordinary heading. MDX model examples expand to actual source and App links.
Unknown MDX components fail publication until given a Markdown representation.
No second copy of technical examples or API prose is maintained.

For an App development server, set `VITE_CODE3D_DOCS_URL` in the ignored
`packages/app/.env.development.local`, for example `http://127.0.0.1:4321/docs/`,
and run the website on that reserved port. Production builds default to
`https://www.code3d.org/docs/`; set the variable at build time for another deployed
site/base. Website dev and preview ports are strict, so collisions fail instead
of changing the prompt's destination silently.

After changing the prompt, a topic or a public package, follow the full chain:
copied prompt → entry → topic → package README → source or complete example.
The website build checks published Markdown alongside HTML links and anchors.
See the [project documentation maintenance rules](../../.agents/skills/code3d-prototyping/SKILL.md#documentation).

## Content

- User documentation: `src/content/docs/docs/` (the inner directory is the
  `/docs/` URL prefix).
- Executable examples: `../app/examples/`. The shared catalog stores paths
  relative to this directory, including both website examples and existing
  App examples; do not copy a model just to add it to the gallery.
- Example metadata and source contexts: `../app/render-samples/catalog.ts`.
  `sourceContextSets` supplies the tabs, highlighted source tokens, and image
  names for the homepage and interactive example pages. The final context is
  selected initially. Each context must identify one occurrence in its source,
  with a unique token inside that context. The renderer selects the same catalog
  entry by context ID, retaining the full source context even when identical
  method calls occur elsewhere in the file.
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
