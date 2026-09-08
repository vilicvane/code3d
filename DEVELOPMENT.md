# Development

This document covers repository setup, testing, and contributor conventions.
The [README](./README.md) introduces Code3D to its users; keep testing and
contributor workflow documentation here or in the relevant development skill.

## Setup

Use Node.js 24 and npm. From the repository root:

```bash
npm install
npm run build:packages
```

Follow the [development principles](./.agents/skills/code3d-prototyping/SKILL.md)
and [worktree workflow](./.agents/skills/worktree-development/SKILL.md) when
changing the project. The worktree workflow covers isolated development,
development server ports, and integration into the main workspace.

## Tests

Write runtime tests as `*.test.ts` with `node:test` and `node:assert/strict`.
Node.js 24 runs the files directly; use erasable TypeScript syntax and explicit
`.ts` extensions when importing test helpers. Type-only fixtures such as
`public-api.ts` are checked but never executed by the test runner.

```bash
npm test                         # build packages, check types, run workspace tests
npm run test:types               # check all tests, including browser tests
npm test --workspace @code3d/core
```

App tests use Vite when the tested module needs its transformations. Browser
tests connect to host Chrome over CDP and run against an existing development
server:

```bash
CODE3D_TEST_URL=http://localhost:3133 npm run test:browser --workspace @code3d/app
```

The example targets the main workspace server. For an isolated worktree, use
its reserved server port. Host Chrome must expose a CDP endpoint; the default
is `http://localhost:9222`, configurable through `CODE3D_CDP_URL`.

Browser callbacks import App modules through Vite URLs such as `/src/viewport.ts`.
The test TypeScript configuration maps these URLs for type checking. Declare
page state in the owning test; keep browser fixtures in `test/browser/` and
import them inside the callback so they execute in the browser.
