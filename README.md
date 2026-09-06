# Code3D

The expressive power of code, with the immediacy of direct manipulation.

[Open App](https://www.code3d.org/app/) · [Website](https://www.code3d.org/) ·
[Documentation](https://www.code3d.org/docs/)

Code3D is a solid modeler where TypeScript and the viewport form one continuous
interface. Use code to define precise, reusable models, and interact directly
with the geometry whenever space is easier to work with visually.

The viewport is more than a preview: it understands source expressions,
runtime objects, and model topology. Interactive changes return as readable
TypeScript, so the model never splits into code and hidden UI state.

## Code and geometry, connected

- Build with ordinary TypeScript: parameters, functions, control flow, and
  modules.
- Move through source to inspect the exact object produced by each expression.
- Select topology, position parts, and adjust parameters directly in the
  viewport.
- Keep every durable change in source, ready to read, diff, test, and reuse.
- Work in your own project folder with browser-compatible npm packages.
- Export the model you are inspecting as STEP, STL, or 3MF.

Code3D evaluates precise B-Rep geometry with OpenCascade and exposes typed
points, edges, faces, bounds, and frames for reusable model APIs. Hollow solids
with [uniform walls and selected openings](https://www.code3d.org/docs/guides/shells/),
position parts with [directional bounds and explicit rotations](https://www.code3d.org/docs/guides/relations/),
and follow [topology source paths](https://www.code3d.org/docs/guides/topology/)
through derived geometry.

## Example

```ts
import {box, cylinder, group} from '@code3d/core';

const base = box(36, 4, 24).fillet(1);
const post = cylinder(4, 14).relate(part => part.on(base.up).offset(-10, 0, 0));

export const model = group([base, post]);
```

Place the cursor on `base`, `post`, or their relation to inspect that exact
context. Adjust the relation interactively and Code3D writes the result back to
the same source.

## Run locally

To run the App on your machine, use Node.js 24 and npm:

```bash
git clone https://github.com/vilicvane/code3d.git
cd code3d
npm install
npm run dev
```

Open [localhost:3133](http://localhost:3133) in your browser.

## Tests

Write runtime tests as `*.test.ts` with `node:test` and `node:assert/strict`.
Node.js 24 runs the files directly; use erasable TypeScript syntax and explicit
`.ts` extensions when importing test helpers. Type-only fixtures such as
`public-api.ts` are checked but never executed by the test runner.

```bash
npm test                         # build packages, check types, run workspace tests
npm run test:types               # check all migrated tests, including browser tests
npm test --workspace @code3d/core
```

App tests use Vite when the tested module needs its transformations. Browser
tests connect to host Chrome over CDP and run against an existing development
server:

```bash
CODE3D_TEST_URL=http://localhost:3133 npm run test:browser --workspace @code3d/app
```

## Project status

Code3D is currently Prototype 01. APIs and project behavior are still evolving.
See the [current capabilities and limitations](https://www.code3d.org/docs/reference/limitations/)
before depending on it for an existing workflow.

## License

Code3D uses the [Interim Community License](./LICENSE). Community use and
ordinary commercial design are permitted; competing commercial software or
services require written permission. Third-party components retain their own
licenses.
