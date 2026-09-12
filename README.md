# Code3D

The expressive power of code, with the immediacy of direct manipulation.

[Open App](https://www.code3d.org/app/) · [Website](https://www.code3d.org/) ·
[Documentation](https://www.code3d.org/docs/) · [Modeling agent instructions](docs/agents.md)

Code3D is a solid modeler where TypeScript and the viewport form one continuous
interface. Use code to define precise, reusable models, and interact directly
with the geometry whenever space is easier to work with visually.

The viewport is more than a preview: it understands source expressions,
runtime objects, and model topology. Interactive changes return as readable
TypeScript, so the model never splits into code and hidden UI state.

![Code3D App showing TypeScript source alongside an iPhone model and an agent render preview](./assets/readme/iphone-modeling.png)

## Code and geometry, connected

- Build with ordinary TypeScript: parameters, functions, control flow, and
  modules.
- Move through source to inspect the exact object produced by each expression.
- Select topology, position parts, and adjust parameters directly in the
  viewport.
- Keep every durable change in source, ready to read, diff, test, and reuse.
- Install browser-compatible npm packages in browser storage, or work in your own local project folder.
- Export the model you are inspecting as STEP, STL, or 3MF.

Code3D evaluates precise B-Rep geometry with OpenCascade and exposes typed
points, edges, faces, bounds, and frames for reusable model APIs. Hollow solids
with [uniform walls and selected openings](https://www.code3d.org/docs/guides/shells/),
position parts with [directional bounds and explicit rotations](https://www.code3d.org/docs/guides/relations/),
and follow [topology source paths](https://www.code3d.org/docs/guides/topology/)
through derived geometry.

Each model has [local coordinates](https://www.code3d.org/docs/concepts/local-coordinates/).
Choose a shared origin to assemble parts directly with `group`, rotate around
local zero, or use relations for geometry-based placement. The [origin and rotation guide](https://www.code3d.org/docs/guides/origins-and-rotation/)
shows each step with the same editable source used by the App.

## Example

```ts
import {cylinder, regularPrism} from '@code3d/core';

/**
 * Select spacer(...) to edit its parameters or compare the Arguments presets.
 * @code3d.param height {kind: 'length', default: 12, constraints: {min: 4, max: 30}}
 * @code3d.param radius {kind: 'length', default: 5, constraints: {min: 4, max: 10}}
 * @code3d.param sides {kind: 'count', default: 6, constraints: {min: 3, max: 12}}
 * @code3d.arguments [12, 5, 6]
 * @code3d.arguments [20, 6, 8]
 */
export function spacer(height = 12, radius = 5, sides = 6) {
  const body = regularPrism(radius, height, sides);
  const bore = cylinder(2, height);
  return body.cut([bore]);
}

export default spacer(12, 5, 6);
```

This spacer demonstrates parameter annotations and presets. Select a call to change
its dimensions with the parameter tools, or use the Arguments presets to inspect
different sizes. An edit to the shared function affects every caller; Undo
restores the source and its resulting geometry.

## Explore the examples

- [Desktop stand](https://www.code3d.org/app/#/file/examples/projects/phone-stand.ts): change the width and lean of a one-piece phone stand.
- [Mounting plate](https://www.code3d.org/app/#/file/examples/sketches/mounting-plate.ts): edit a slot on a rotated part's plane.
- [Text](https://www.code3d.org/app/#/file/examples/text.ts): raised and engraved text using Google Fonts.
- [Third-party npm packages](https://www.code3d.org/app/#/file/examples/npm/model.ts): install and use a browser-compatible npm dependency.
- [Desktop controller](https://www.code3d.org/app/#/file/examples/projects/desktop-controller/model.ts): explore a multi-file assembly and export STEP, STL or 3MF.
- [Modeling with an agent](docs/agents.md): connect an agent and continue editing the same project.

The iPhone image above is a modeling screenshot; its complete source is not
currently distributed with the runnable examples.

## Run locally

To run the App on your machine, use Node.js 24 and npm:

```bash
git clone https://github.com/vilicvane/code3d.git
cd code3d
npm install
npm run dev
```

Open [localhost:3133](http://localhost:3133) in your browser.

For repository development, see the [development guide](./.agents/docs/development.md)
and [architecture documentation](./.agents/docs/README.md).

## Project status

Code3D is currently Prototype 01. APIs and project behavior are still evolving.
See the [current capabilities and limitations](https://www.code3d.org/docs/reference/limitations/)
before depending on it for an existing workflow.

## License

Code3D uses the [Interim Community License](./LICENSE). Community use and
ordinary commercial design are permitted; competing commercial software or
services require written permission. Third-party components retain their own
licenses.
