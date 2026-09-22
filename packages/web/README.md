# Website

Astro serves the custom homepage and examples. Starlight serves `/docs/`.
App is built separately by Vite and copied into `dist/www/app/`.

`Packages` groups the featured libraries under their complete npm names. Each
package's `README.md` is its overview, and `docs/` contains detailed API and usage
pages. Starlight and the plain Markdown endpoint read these files directly;
there is no separate website copy of package reference prose. Package headings
show the current version from `package.json` unless the page has a source review
baseline, which records its own reviewed version. There is no multi-version routing.

This README covers website content and publication. Repository-wide setup and
test conventions live in the [development guide](../../.agents/docs/development.md);
system responsibilities are indexed in the [internal documentation](../../.agents/docs/README.md).

From the repository root:

```bash
npm install
npm run build:packages
npm run pack:packages
npm run build --workspace @code3d/app
npm run render:web-images
npm run dev --workspace @code3d/web
```

The image renderer uses Playwright Chromium. Install it with
`npx playwright-core install chromium`, or set
`CODE3D_CHROME_CDP_ENDPOINT=http://localhost:9222` to use an existing debugging
browser. The renderer closes its own pages and leaves that browser running.

Model images use the current commit’s packed public packages from `dist/packages`.
The renderer resolves temporary example manifests and locks against those exact
archives, then makes one separate production render build for the image batch.
Browser installation still checks integrity and extracts real tarballs. This
works before npm publication; checked-in examples and the deployable App build
keep their normal package declarations. Run `npm run pack:packages` after
rebuilding public packages. Temporary render output is removed when rendering ends.

## Agent documentation and local prompts

[The human introduction](src/content/docs/docs/guides/agents.mdx) explains
collaboration features at `/docs/guides/agents/`. Agent prompts instead open
[the required Markdown entry](../../docs/agents.md) at `/docs/agents.md`.
[Detailed topics](../../docs/agents/) cover operations, modeling and recovery;
[useful modeling packages](../../docs/agents.md#useful-modeling-packages) introduce
the main authoring libraries. All packages maintain READMEs for human and agent
readers, but the website publishes only the selected modeling packages.

The [Markdown publisher](scripts/markdown-documents.mjs) serves these existing
sources through [one static endpoint](src/pages/docs/[...document].md.ts):

| Repository source                                                  | Published Markdown                        |
| ------------------------------------------------------------------ | ----------------------------------------- |
| `docs/agents.md` and `docs/agents/*.md`                            | `/docs/agents.md` and `/docs/agents/*.md` |
| `packages/{core,gears,layout,materials,screws}/README.md`          | `/docs/packages/<package>.md`             |
| `packages/{core,gears,layout,materials,screws}/docs/**/*.{md,mdx}` | `/docs/packages/<package>/<topic>.md`     |
| `src/content/docs/docs/**/*.{md,mdx}`                              | `/docs/<topic>.md`                        |

The [shared document catalog](scripts/document-sources.mjs)'s `featuredPackages` list selects Core, Gears, Layout, Materials and Screws.
Additional packages are selected for their value to model authors; adding a
workspace package does not automatically add a website page or an entry in the
agent guide. Lower-level dependency READMEs stay in their packages, discoverable
through GitHub or an installed `node_modules` tree. Links to an unpublished README
resolve to its repository source rather than creating a website mirror.
Internal development docs under `.agents/docs/` and research under
`.agents/research/` remain repository resources too. A package README can link
to them for contributors without adding them to the modeling agent's required
workflow or website catalog.

Package HTML uses `/docs/packages/<package>/` for the README and
`/docs/packages/<package>/<topic>/` for detail pages. The [collection loader](scripts/docs-loader.ts)
loads their original Markdown/MDX files, and the [link transform](scripts/html-documents.mjs)
shares URL resolution with the Markdown publisher. Add detail pages with Starlight
`title` and `description` frontmatter; the sidebar discovers them automatically.
Core's individual API references live in `packages/core/docs/api/`, with stable
API-name URLs such as `/docs/packages/core/api/box/`. Use kebab-case filenames
for multiword names (`regularPrism` uses `regular-prism.md`), while retaining
the exact API spelling in the page title. Add each finished reference
to the matching purpose group under `API reference` in `astro.config.mjs`, and
set its frontmatter `sidebar.hidden: true` to omit a second autogenerated entry.
The Core API overview links the modeling categories to their current reference
pages or guide sections. Coverage and batch progress are tracked in GitHub
issue [#232](https://github.com/vilicvane/code3d/issues/232); unpublished pages do
not appear as placeholder sidebar links.
MDX may use shared website example components to display the actual App sources.
Package manifests are watched in development; pages with source review baselines
keep their own reviewed version.

### Source review baselines

Each fine-grained Core page in `packages/core/docs/api/` declares `sourceReview`
in its frontmatter. `packageVersion` records the package version used during
review. Each entry in `sources` has a repository-relative `path`, a SHA-256 of
its file bytes, and an optional matching Git `commit`. Start a page by listing
its source paths, then capture the baseline after checking the prose and examples:

```bash
npm run docs:sources:review --workspace @code3d/web -- packages/core/docs/api/box.md
npm run docs:sources:check --workspace @code3d/web
```

The review command requires explicit page paths. It captures current file bytes
and the current package version; running it asserts that those files and the
page have been reviewed together. It is never run automatically by a build.
The read-only check fails for missing baselines, changed or missing sources,
and malformed records. A package release or an unrelated file change alone
requires no baseline update. Fix source paths after renames and review the
page before recapturing its baseline. Web builds run this check before publishing.

Declare the implementation files that explain the page, including relevant
shared validation. Split API-specific implementation out of large modules as
pages are added; keep shared mechanisms in their own concept documentation.
This explicit list does not discover transitive dependencies or prove semantic
correctness. Changes to shared model, topology or inspection behavior still
require reviewing affected callers, documentation and examples.

HTML and Markdown display the same reviewed package version and source hashes.
New or modified files may have no matching commit; do not substitute `HEAD` as
if it contained those bytes. When the source is committed, publication can
resolve a matching commit without changing the baseline. Commit links already
recorded in a baseline continue to point at that reviewed content. A deployment
must contain the reviewed sources and publish their commits as well.

Keep links relative to real repository files in agent docs, READMEs and package docs. The
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

## Package documentation style

Featured package READMEs use a plain `# @code3d/<name>` title and a one- or
two-sentence introduction, followed by these sections in this order:

1. **Installation**: the npm command for the package and its required peers,
   such as Core, plus built-in App availability. Do not include example-only
   dependencies in this section.
2. **Example**: a short goal, TypeScript code, its image, a result or interaction
   explanation, and a `Complete example:` source link. Explain and install any
   example-only dependencies here, before the TypeScript code. Keep code before images.
3. **Usage notes**: concise units, essential conventions and modeling limits.
   Link to detailed semantics instead of expanding the reference here.
4. **Documentation**: a list of links, each followed by a short description.
5. **Source and development**: source, tests and the shared development guide,
   using the same link-list format. Keep contributor details at the end.

Write for model authors. Use short paragraphs, consistent API spelling in code
formatting, and descriptions of what the reader can do or see. Captions explain
the result or the next interaction, not how a maintainer produced the screenshot.
Keep installation in its own section and avoid repeating catalogs or commands
in several places.

Detailed reference pages introduce the purpose, show an example, then explain
parameters, behavior and relevant limits. Use tables for option catalogs and
links for deeper topics. Tutorials retain their task-oriented steps rather than
copying the reference outline. Existing `ModelExample` components show source,
image and caption in that order; their Markdown form retains executable source
and the App link. Do not copy models or technical prose into a second website
document. Preserve useful anchors and update incoming links when headings change.

Package screenshots use ordinary Markdown images pointing to the existing
`src/assets/models/` files, with descriptive alt text and a link to the executable
example. Match the code's dimensions and operations to at least one object in the
picture. A snippet may cover only part of a multi-object screenshot; it does not
need to reproduce the full scene. Preserve the colored Gears overview and select
the material call for its individual finished-part images. Prefer isolated layout examples and equal-size material samples over
unrelated assemblies. Capture materials in Render mode; select the final material
call for finished threaded parts to avoid inspection transparency. Core
interaction illustrations capture the actual App viewport with its gizmo and
tool panel, not just exported model geometry. Add missing render subjects to the
shared App catalog rather than copying models into the docs.

HTML leaves local image paths to Astro's image pipeline; plain Markdown publishes
raw repository image URLs at the source commit. The Markdown tests check overview
section order, code/image order and canonical examples; the site validator checks
rendered example order, links, anchors and assets.

## Content

- User documentation: `src/content/docs/docs/` (the inner directory is the
  `/docs/` URL prefix).
- Product comparisons: `src/content/docs/docs/comparisons/`. Keep one competitor
  per page and an overview linking to each. These cross-product guides belong to
  the website, while package API documentation stays in package READMEs and docs.
  Cite official sources beside factual claims and update the reviewed date when
  rechecking them. Distinguish libraries, their editors, and ecosystem integrations.
  Write primarily for programmers who want to model with code and agents. Compare
  the program's role, model persistence and graphical writeback, not only whether
  a language or API is supported.
  Describe actual workflows and both products' fit without unsupported absence,
  performance, or feature-parity claims. Link canonical runnable examples instead
  of maintaining comparison-only model copies. HTML, Markdown, search and sitemap
  use the existing document pipeline.
  Use a marketing voice grounded in the reader's work: lead with the concrete
  benefit of Code3D for that audience, explain the mechanism, and offer a relevant
  example to try. Keep recommendations honest and avoid generic feature checklists
  or repeatedly interrupting the value proposition with unrelated caveats.
- Executable examples: `../app/examples/`. The shared catalog stores paths
  relative to this directory, grouped by modeling topic, shared by the website and
  App; do not copy a model just to add it to the gallery.
- Example metadata and source contexts: `../app/render-samples/catalog.ts`.
  `sourceContextSets` supplies the tabs, highlighted source tokens, and image
  names for the homepage and interactive example pages. The final context is
  selected initially. Each context must identify one occurrence in its source,
  with a unique token inside that context. The renderer selects the same catalog
  entry by context ID. Optional `view` metadata fixes camera direction and up
  for thin parts or assemblies whose working details need a particular angle.
  The renderer retains the full source context even when identical
  method calls occur elsewhere in the file.
  Optional `mode: 'render'` selects surface rendering for material comparisons;
  other samples keep the modeling view. App UI captures such as
  `core-relate-tools.png` are taken separately from the actual App: open
  `constraints/relate.ts`, select `rotate(0, 0, 25)` and capture the viewport pane
  with its rotation gizmo and parameter panel visible. Update that capture when
  its example or UI changes; the geometry-only renderer does not replace it.
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
App and the image renderer use the same package resolution, compiler inspection
and viewport scene publication, including public inspectors and annotations. Spatial editing
controls remain in `../app/src/model/source-decorations.ts`.

## Build and verify

Comparison pages keep concise H1s and sidebar labels, while native frontmatter
`head` title overrides and `description` explain the searcher's concrete reason
to choose Code3D. Cover each product's alternative/comparison intent on its
existing page; do not create near-duplicate keyword landing pages. The current
positioning targets programmers looking for interactive code CAD, reusable model
interfaces, and AI-assisted authoring. This selection is based on qualitative
search-result review, not measured keyword volume or a ranking guarantee.

Use `lastUpdated` for the actual editorial review date and keep it consistent
with the visible byline. The shared comparison metadata supplies both visible
breadcrumbs and JSON-LD: `Article` for a product comparison, `CollectionPage` for
the overview, and `BreadcrumbList` for navigation. Do not invent ratings,
publication dates or reviews. Titles, descriptions and schema describe visible
content; follow [Google's title guidance](https://developers.google.com/search/docs/appearance/title-link)
and [breadcrumb guidance](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb).

For every Markdown document with an HTML counterpart, the shared document
catalog generates a `Link: <HTML URL>; rel="canonical"` header. Astro dev emits it
when a site is configured; production writes exact rules into Cloudflare's
`_headers`, alongside [App's response headers](../../app/build/response-headers.ts):
isolation, immutable caching for hashed assets, and compressible content types
for the TypeScript declaration, navigation and CommonJS package sources that
Cloudflare otherwise serves as the uncompressible `video/mp2t` and
`application/node`. Markdown-only agent instructions retain their own URLs. This
follows Google's
[canonical guidance for alternate formats](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
without blocking agents or crawlers from the Markdown sources.

After deploying, check the live HTML, Markdown response headers, sitemap and
robots rules. Search Console indexing and performance are separate observations;
do not report a successful build or Pagefind query as Google indexing. If Search
Console access is available, inspect the published URLs and submit the sitemap
there; indexing timing remains up to the search engine.

```bash
npm run build --workspace @code3d/web
npm run preview --workspace @code3d/web
```

`npm run test:types --workspace @code3d/web` checks Astro templates and TypeScript
in the independent CI workflow. The build generates the static site and
Pagefind index, includes App, and validates internal links, anchors, and
asset references. Preview the production build when testing search; Pagefind
indexes the build output.

Set `CODE3D_SITE_URL` to the public site URL for production, for example
`https://example.com/` or `https://example.com/code3d/`. It sets canonical URLs,
sitemap origin, and the optional deployment base path. Use the same value for
build and preview. Without it, local builds omit origin-specific metadata.
With it, the build also validates `sitemap-index.xml`, full public HTML page
coverage and the sitemap declaration in `robots.txt`. Markdown counterparts and
the 404 page are not indexed separately; the copied App is outside Astro's page
catalog.

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
`npm run pack:packages` and `npm run render:web-images` after building the public
packages and App, then rebuild the website.

The website workflow regenerates model images and builds the complete artifact
before deploying. Full tests run asynchronously in the independent CI workflow
and do not gate deployment. Automatic deployment from `main` is enabled by setting the repository
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

Keep each example focused on one learning goal. Group basic operations under
`operations/`, relations under `constraints/`, and shape constructors under
`primitives/`. Keep standalone Core text, expose, materials and topology-paths files at the example
root. Put focused extension-package examples in `examples/packages/`, using
the package's unscoped name. A package with one example uses a single file,
such as `materials.ts` or the shared ISO/GB screw gallery `screws.ts`.
Multiple examples use a package folder, such as `gears/parts.ts`,
`gears/assembly.ts` and the examples under `layout/`.
Complete projects and assemblies retain their existing directories even when they
use extension packages; do not wrap one file in a directory of the same name.
The primitive overview is a visual vocabulary of the built-in shapes, with each
shape exported separately and no positioning transforms. Keep cut, union and
intersect in separate files; names describe the API topic rather than preview
behavior. The npm directory explicitly teaches third-party package installation. Name basic examples for the
operation they teach, and complete projects for the thing being modeled. Put
supporting material, texture and geometry builders after the main model when
they would distract from that goal. Reuse a canonical component through imports;
link to package READMEs for catalogs of options instead of repeating them in App.
Include matching `default` values in parameter-tool annotations when the function
has optional defaults. Prefer explicit, editable sketch entries for drawn profiles;
reserve generated geometry for examples whose purpose is a pattern or algorithm.
Google Fonts examples require network access; test fonts belong in test fixtures,
not in the managed examples directory.

## Example verification

`packages/app/render-samples/catalog.ts` registers every runnable example.
The native example tests check catalog coverage, exported geometry and Arguments
presets; website focus tokens must resolve uniquely. App smoke tests open every
registered path in a fresh browser storage workspace. Run them locally against
the reserved task server with `CODE3D_TEST_URL=http://127.0.0.1:<port>/ npm run
test:examples:browser --workspace @code3d/app`; they use the host Chrome CDP session.
CI starts its own test server and browser. Include new example entries and their
geometry/interaction assertions in the same change as the source.
