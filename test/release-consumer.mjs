// Runs outside the workspace with only this release's tarballs installed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

const selected = new Set(JSON.parse(process.argv[2]));
for (const name of selected) {
  if (name === '@code3d/cli') {
    const help = execFileSync(
      process.execPath,
      ['node_modules/@code3d/cli/bld/main.js', '--help'],
      {encoding: 'utf8', timeout: 10_000},
    );
    assert.match(help, /Usage: c3d/);
  } else await import(name);
}
if (selected.has('@code3d/core') || selected.has('@code3d/screws')) {
  const core = await import('@code3d/core');
  const tooling = await import('@code3d/core/tooling');
  const models = [];
  try {
    if (selected.has('@code3d/core')) {
      models.push(core.box(2, 3, 4));
      const faces = core.text(
        'B8i',
        core.font(new URL('./font.ttf', import.meta.url)),
        10,
      );
      models.push(...faces, ...core.extrude(faces, 2));
    }
    if (selected.has('@code3d/screws'))
      models.push((await import('@code3d/screws')).ISO4762.screw('M3', 8));
    const snapshot = tooling.createModelSnapshotter();
    for (const model of models) {
      assert.ok(tooling.isModelObject(model));
      assert.ok(snapshot(model));
    }
  } finally {
    tooling.disposeModelObjects(models);
    tooling.clearKernelOperationCache();
  }
}
if (selected.has('@code3d/materials')) {
  const {plastic} = await import('@code3d/materials');
  const {MeshStandardMaterial} = await import('@code3d/core/three');
  const material = plastic();
  assert.ok(material instanceof MeshStandardMaterial);
  material.dispose();
}
for (const name of ['@code3d/opencascade', '@code3d/solver']) {
  if (!selected.has(name)) continue;
  const bytes = await readFile(new URL(import.meta.resolve(name + '/wasm')));
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 97, 115, 109]);
}
console.log(
  'Selected package entries and modeling examples passed against the release dependency graph.',
);
