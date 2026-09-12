// Copied into a fresh npm consumer by scripts/test-packages.mjs. No source hooks.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as core from '@code3d/core';
import * as tooling from '@code3d/core/tooling';
import * as interop from '@code3d/core/replicad';
import * as three from '@code3d/core/three';
import * as nativeThree from 'three';
import * as nativeReplicad from 'replicad';
import * as materials from '@code3d/materials';
import * as screws from '@code3d/screws';
import * as ISO4762 from '@code3d/screws/iso4762';
import * as ISO10642 from '@code3d/screws/iso10642';
import * as ISO14583 from '@code3d/screws/iso14583';
import * as ISO7379 from '@code3d/screws/iso7379';
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
let calls = 0;
const compute = core.cached(
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
  shapes.push(...core.extrude(shapes.slice(2), 2));
  shapes.push(
    ISO4762.screw('M3', 8),
    ISO10642.screw('M3', 10),
    ISO14583.screw('M3', 8),
    ISO7379.screw(6.5, 10),
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
    'Installed Node/browser/tooling share state; text topology, extrusion and Screws evaluate successfully.',
  );
} finally {
  tooling.disposeModelObjects(shapes);
  tooling.setKernelArtifactStore(undefined);
  tooling.clearKernelOperationCache();
}
