# R-027 — Deduplicate injected package files

Status: complete

## Feedback

After Monaco opened an injected declaration as a model, identifier completion
offered both the public `@code3d/core` auto-import and an internal
`%40code3d/core/bld/library/runtime` auto-import for `box`.

## Resolution

- The TypeScript worker gives encoded Monaco model URIs and their raw extra-lib
  paths one file identity. The injected extra-lib path remains the canonical
  project root, while the equivalent model URI remains available for language
  features without becoming a second root.
- Completion candidates are not filtered or rewritten. TypeScript sees one
  package graph and uses the injected package metadata to expose its public
  `exports` entry naturally.
- `package.json` files remain readable by module resolution without becoming
  TypeScript source roots.

## Verification

- In host Chrome, opening the encoded `runtime.d.ts` mirror reproduced the
  duplicate completion before the fix. With the fix, `box` has one auto-import
  candidate sourced from `@code3d/core`.
- The app build passes.
