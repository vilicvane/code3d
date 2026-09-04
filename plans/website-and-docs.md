# Website and documentation

## Confirmed direction

Rebuild `packages/web` with Astro and Starlight. The website introduces
Code3D through the connection between ordinary TypeScript and direct geometric
interaction. The documentation teaches the current product; internal design
records stay in the repository.

- `/` is a custom product homepage; `/docs/` uses Starlight.
- `/examples/` and its detail pages share executable TypeScript sources with
  App and the existing OpenCascade image renderer.
- App remains an independent Vite build, delivered under `/app/` in the
  website artifact. Existing file routes open examples without copying code
  into a second project format.
- Website pages stay static. Search and small demonstrations load only the
  JavaScript they need; OCCT and Monaco belong to App.
- Build output remains `packages/web/dist/www`. Site origin and optional base
  path are configured with `CODE3D_SITE_URL`.
- English documentation covers first steps, practical guides, concepts,
  curated API reference, and current limitations. No CMS or documentation
  versions are needed for Prototype 01.
- Astro tooling uses package-local TypeScript 6 while core keeps TypeScript 7;
  TypeDoc automation waits for a compatible upstream release.
  The checker process explicitly resolves TypeScript to that local compiler:
  Volar's wildcard peer otherwise hoists to the native TS 7 package, which does
  not provide the JavaScript compiler API. A process-scoped Node resolution hook
  makes this boundary independent of npm's dependency placement.

## Execution

1. Replace the Vite website shell with Astro, Starlight, and shared site styles.
2. Consolidate example sources and generated model images; connect App links.
3. Build the product homepage, examples, and initial documentation.
4. Validate templates, examples, generated routes/anchors/assets, search,
   responsive layouts, and the App handoff in host Chrome.

These steps may adapt as implementation reveals constraints. A material change
to framework, product positioning, or persistence behavior requires discussion
with the user. Routine implementation choices remain flexible.

## Implemented

- Use App consistently in website copy, documentation, and the `/app/` route.
  Links that launch the App (including runnable examples) open in a new tab,
  preserving the current website or documentation page.

- Custom product homepage with keyboard-accessible source-context switching.
- Three executable examples, shared by App, content collections, and five
  real renderer outputs. The source loader watches example edits in development.
- Eleven initial documentation pages covering tutorials, App, files,
  relations, topology, reusable models, concepts, and curated reference.
- Search, responsive model images, shared fonts/colors, a custom 404 page,
  generated PNG social card, canonical URLs, and configurable deployment prefix.
- Separate App output served in development and included in the static
  website artifact; no modeling runtime is loaded by the homepage.
- Build-time template/type checks and route/anchor/asset validation.

## Verification

- Astro template/type checks: zero errors, warnings, and hints.
- All 17 generated HTML pages pass internal link, anchor, and asset checks.
- Root and `/code3d/` deployment paths are exercised.
- Host Chrome checks cover desktop/mobile layout, keyboard source tabs,
  search results, and App opening the shared example with no diagnostics.
- All 12 existing App tests pass.
- Model images are rendered through the actual application/OCCT pipeline;
  the original website's custom React hydration and Vite SSR plugin are removed.

## Acceptance

- One static deployment contains the homepage, documentation, examples, and
  separately built App.
- Homepage source selections and corresponding images come from real model
  evaluation; no second geometry implementation is introduced.
- Example source is type-checked and executed by the render pipeline.
- Internal links, anchors, and image assets resolve in the built site; search
  returns user-facing documentation and examples.
- Desktop, mobile, keyboard navigation, and reduced-motion preferences work.
- The isolated development server stays available for user acceptance until
  the requested integration into the main workspace is complete.
