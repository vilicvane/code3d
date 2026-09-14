// Copied into a fresh npm consumer by scripts/test-packages.mjs. No source hooks.
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {readFile} from 'node:fs/promises';
import * as core from '@code3d/core';
import * as tooling from '@code3d/core/tooling';
import * as interop from '@code3d/core/replicad';
import * as three from '@code3d/core/three';
import * as nativeThree from 'three';
import * as nativeReplicad from 'replicad';
import * as layout from '@code3d/layout';
import * as materials from '@code3d/materials';
import * as screws from '@code3d/screws';
import * as ISO4762 from '@code3d/screws/iso4762';
import * as ISO10642 from '@code3d/screws/iso10642';
import * as ISO14583 from '@code3d/screws/iso14583';
import * as ISO7379 from '@code3d/screws/iso7379';
import * as GB70_3 from '@code3d/screws/gb70-3';
import * as GB5281 from '@code3d/screws/gb5281';
import * as agent from '@code3d/agent';
import initSolver from '@code3d/solver';
import initOpenCascade from '@code3d/opencascade';

const browser = await import(
  new URL('../library/index.js', import.meta.resolve('@code3d/core'))
);
for (const [name, value] of Object.entries(core)) {
  assert.ok(
    value === browser[name],
    `${name} shares Node and browser identity`,
  );
  assert.ok(
    value === tooling.authoringApi[name],
    `${name} shares tooling identity`,
  );
}
assert.ok(three.MeshPhysicalMaterial === nativeThree.MeshPhysicalMaterial);
assert.ok(interop.replicad.Solid === nativeReplicad.Solid);
assert.ok(Object.keys(materials).length > 0 && Object.keys(agent).length > 0);
assert.equal(typeof initSolver, 'function');
assert.equal(typeof initOpenCascade, 'function');
for (const specifier of ['@code3d/opencascade/wasm', '@code3d/solver/wasm']) {
  const bytes = await readFile(new URL(import.meta.resolve(specifier)));
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 97, 115, 109]);
}
for (const specifier of [
  '@code3d/core/bld/library/runtime.js',
  '@code3d/screws/bld/library/thread.js',
])
  await assert.rejects(import(specifier), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  });

for (const [name, standard] of Object.entries(screws)) {
  const direct = await import(
    '@code3d/screws/' + name.toLowerCase().replace('_', '-')
  );
  assert.equal(direct.screw, standard.screw);
  assert.equal(direct.specifications, standard.specifications);
}

const records = new Map();
tooling.setKernelArtifactStore({
  get: id => records.get(id),
  set: (id, bytes) => records.set(id, bytes),
  touch: id => records.has(id),
  delete: id => records.delete(id),
  getMany: ids => ids.map(id => records.get(id)),
  touchMany: ids => ids.map(id => records.has(id)),
  flush() {},
});
let milliseconds = 0;
mock.method(performance, 'now', () => (milliseconds += 10));
let calls = 0;
const compute = core.cache(
  tooling.identifyCachedFunction(value => {
    calls++;
    return {value};
  }, 'packed:compute'),
);
const first = compute(7);
assert.ok(compute(7) === first);
tooling.clearKernelOperationCache();
assert.deepEqual(compute(7), {value: 7});
assert.equal(calls, 1);
assert.equal(tooling.kernelOperationCacheStats().persistentHits, 1);
mock.restoreAll();

const shapes = [];
try {
  const primitive = interop.definePrimitive(() =>
    interop.replicad.makeBox([0, 0, 0], [1, 2, 3]),
  );
  shapes.push(core.box(2, 3, 4), primitive());
  shapes.push(
    ...core.text('B8i', core.font(new URL('./font.ttf', import.meta.url)), 10),
  );
  assert.equal(shapes.length, 6);
  const posts = layout.linear(layout.repeat(shapes[0], 3), {
    axis: 'x',
    step: 8,
  });
  const assembly = core.group(posts);
  assert.deepEqual(assembly.bounds().size, [18, 3, 4]);
  assert.deepEqual(posts[2].position(assembly), [0, 0, 0]);
  assert.deepEqual(posts[2].bounds().minimum, [15, -1.5, -2]);
  shapes.push(...core.extrude(shapes.slice(2), 2));
  shapes.push(assembly);
  const space = core.box(30, 3, 4);
  const packed = layout.fillFlex(shapes[0], space, {
    axis: 'x',
    gap: 3,
    padding: {start: 2},
    justifyContent: 'end',
  });
  assert.equal(packed.length, 6);
  assert.deepEqual(packed[0].bounds(space).minimum, [-12, -1.5, -2]);
  assert.deepEqual(packed.at(-1).bounds(space).maximum, [15, 1.5, 2]);
  const counted = layout.flex([shapes[0], shapes[0], shapes[0]], space, {
    axis: 'x',
    padding: {start: 2, end: 1},
    justifyContent: 'space-between',
  });
  assert.deepEqual(counted[0].bounds(space).minimum, [-13, -1.5, -2]);
  assert.deepEqual(counted.at(-1).bounds(space).maximum, [14, 1.5, 2]);
  const tileSpace = core.box(10, 3, 12);
  const tiles = layout.fillGrid(shapes[0], tileSpace, {
    axes: ['x', 'z'],
    gap: 1,
  });
  assert.equal(tiles.length, 6);
  const tileGroup = core.group(tiles);
  assert.deepEqual(tileGroup.bounds().size, [8, 3, 9]);
  const cells = layout.grid(layout.repeat(shapes[0], 4), tileSpace, {
    axes: ['x', 'z'],
    columns: [{fr: 1}, {fr: 1}],
    rows: 2,
    justifyItems: 'center',
  });
  assert.equal(cells.length, 4);
  const circular = layout.radial(layout.repeat(shapes[0], 4), {
    axis: 'y',
    radius: 5,
    rotate: true,
  });
  assert.equal(circular.length, 4);
  shapes.push(
    space,
    tileSpace,
    core.group(packed),
    core.group(counted),
    tileGroup,
    core.group(cells),
    core.group(circular),
  );
  shapes.push(
    ISO4762.screw('M3', 8),
    ISO10642.screw('M3', 10),
    ISO14583.screw('M3', 8),
    ISO7379.screw(6.5, 10),
    GB70_3.screw('M3', 10),
    GB70_3.clearanceHole('M3', {depth: 8, countersink: {diameter: 8}}),
    GB5281.screw(6.5, 10),
    GB5281.clearanceHole(6.5, {depth: 8, counterbore: true}),
  );
  const snapshot = tooling.createModelSnapshotter();
  for (const shape of shapes) {
    assert.ok(
      tooling.isModelObject(shape),
      'package models share Core runtime identity',
    );
    assert.ok(snapshot(shape));
  }
  assert.ok(tooling.kernelOperationCacheStats().persistentWrites > 0);
  console.log(
    'Installed Node/browser/tooling share state; text topology, extrusion, Layout and Screws evaluate successfully.',
  );
} finally {
  tooling.disposeModelObjects(shapes);
  tooling.setKernelArtifactStore(undefined);
  tooling.clearKernelOperationCache();
}
