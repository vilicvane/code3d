import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import type {SourceTarget} from '../src/model/compiler.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestModelPipeline>>;
let decorations: typeof import('../src/model/parameter-decorations.ts');
let arguments_: typeof import('../src/model/tool-arguments.ts');
let dimensions: typeof import('../src/rendering/parameter-dimension.ts');
let Viewport: typeof import('../src/viewport.ts').ModelViewport;

before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
  arguments_ = await server.ssrLoadModule('/src/model/tool-arguments.ts');
  decorations = await server.ssrLoadModule(
    '/src/model/parameter-decorations.ts',
  );
  dimensions = await server.ssrLoadModule(
    '/src/rendering/parameter-dimension.ts',
  );
  ({ModelViewport: Viewport} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    ));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

async function focus(source: string, token: string, displacement = 0) {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const offset = source.indexOf(token) + displacement;
  const target = Viewport.prototype['sourceTargetAt'].call(
    {module} as unknown as InstanceType<typeof Viewport>,
    '/model.ts',
    offset,
  ) as SourceTarget;
  assert.ok(target);
  const parameter = arguments_.sourceParameterAt(target, '/model.ts', offset);
  const evaluation = target.evaluations[0];
  return {
    module,
    target,
    parameter,
    evaluation,
    guides: decorations.parameterSourceDecoration.decorations({
      module,
      target,
      evaluation,
      parameter,
    }),
  };
}

test('argument occurrences resolve literal, shared-variable and compound dimensions independently', async () => {
  const source = `import {box as makeBox} from '@code3d/core';
const size = 12;
const result = makeBox(size, size + 4, 30);`;
  for (const [token, name, vector] of [
    ['size,', 'x', [12, 0, 0]],
    ['size + 4', 'y', [0, 16, 0]],
    ['30)', 'z', [0, 0, 30]],
  ] as const) {
    const {guides, parameter} = await focus(source, token, token.length - 1);
    assert.equal(parameter?.name, name);
    assert.equal(guides.length, 1);
    const guide = guides[0];
    assert.equal(guide.kind, 'dimension');
    if (guide.kind !== 'dimension') throw new Error('Expected dimension');
    assert.deepEqual(guide.dimension.vector, vector);
    const edges = dimensions.dimensionEdges(guide.mesh, guide.dimension);
    assert.equal(edges.length, 4);
    for (const edge of edges) {
      assert.ok(
        Math.abs(
          new THREE.Vector3(...edge.end).distanceTo(
            new THREE.Vector3(...edge.start),
          ) - Math.hypot(...vector),
        ) < 1e-5,
      );
    }
  }
  const name = await focus(source, 'makeBox(size');
  assert.equal(name.parameter, undefined);
  assert.deepEqual(name.guides, []);
});

test('fillet selection uses consumed input edges and does not confuse its radius', async () => {
  const source = `import {box} from '@code3d/core';
const result = box(20, 30, 40).fillet(2, [1, 3]);`;
  const {guides, module, evaluation} = await focus(source, '[1, 3]', 3);
  const guide = guides[0];
  assert.equal(guide.kind, 'topology');
  if (guide.kind !== 'topology') throw new Error('Expected topology');
  assert.equal(guide.topologyKind, 'edge');
  assert.deepEqual(guide.ids, [1, 3]);
  assert.equal(
    guide.mesh,
    module.objects.get(evaluation.selection!.inputNodeId)!.mesh,
  );
  assert.notEqual(guide.mesh, module.objects.get(guide.nodeId)!.mesh);
  assert.deepEqual((await focus(source, '2, [')).guides, []);
});

test('originVertex highlights its input vertex in the rebased output frame', async () => {
  const source = `import {box} from '@code3d/core';
const result = box(20, 30, 40).rotate(20, 30, 40).originVertex(3);`;
  const {guides} = await focus(source, '3);');
  const guide = guides[0];
  assert.equal(guide.kind, 'topology');
  if (guide.kind !== 'topology') throw new Error('Expected topology');
  assert.equal(guide.topologyKind, 'vertex');
  const index = guide.mesh.vertexIds.findIndex(id => id === 3);
  assert.ok(index >= 0);
  const position = new THREE.Vector3()
    .fromArray(guide.mesh.topologyVertices, index * 3)
    .multiply(new THREE.Vector3(...guide.transform.scale))
    .applyQuaternion(new THREE.Quaternion(...guide.transform.quaternion))
    .add(new THREE.Vector3(...guide.transform.position));
  assert.ok(position.length() < 1e-5);
});

test('extrusion dimensions follow the profile normal and signed distance in both call forms', async () => {
  for (const call of ['extrude(profile, -12)', 'profile.extrude(-12)']) {
    const source = `import {rectangle, extrude} from '@code3d/core';
const profile = rectangle(20, 30).rotate(0, 0, 90).originOffset(4, 5, 6);
const result = ${call};`;
    const {guides} = await focus(source, '-12', 2);
    const guide = guides[0];
    assert.equal(guide.kind, 'dimension');
    if (guide.kind !== 'dimension') throw new Error('Expected dimension');
    assert.ok(
      new THREE.Vector3(...guide.dimension.vector).distanceTo(
        new THREE.Vector3(12, 0, 0),
      ) < 1e-8,
    );
    assert.deepEqual(guide.dimension.origin, [-4, -5, -6]);
    assert.equal(
      dimensions.dimensionEdges(guide.mesh, guide.dimension).length,
      4,
    );
  }
});

test('a curved edge of matching endpoint distance cannot represent a straight dimension', () => {
  const mesh = {
    edges: new Float32Array([0, 0, 0, 5, 3, 0, 5, 3, 0, 10, 0, 0]),
    edgeGroups: [{start: 0, count: 4, edgeId: 1}],
  };
  assert.deepEqual(
    dimensions.dimensionEdges(mesh, {origin: [0, 0, 0], vector: [10, 0, 0]}),
    [],
  );
});

test('representative edge selection uses the visible occurrence placement', () => {
  const edges = [
    {id: 1, start: [-5, -2, 0], end: [5, -2, 0]},
    {id: 2, start: [-5, 2, 0], end: [5, 2, 0]},
  ] as const;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 20, 30);
  camera.updateMatrixWorld();
  assert.equal(
    dimensions.representativeDimensionEdge(edges, camera, new THREE.Matrix4())
      ?.id,
    2,
  );
  assert.equal(
    dimensions.representativeDimensionEdge(
      edges,
      camera,
      new THREE.Matrix4().makeRotationZ(Math.PI),
    )?.id,
    1,
  );
});
