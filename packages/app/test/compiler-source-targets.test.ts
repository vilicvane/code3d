import type {
  SourceTarget,
  SourceTargetEvaluation,
} from '../src/model/compiler.ts';
import type {ToolParameterSchema} from '../src/model/tool-schema.ts';
import {defined} from '../../../test/assert.ts';
import {TopologyIdSet} from '@code3d/core/tooling';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {renderSamples} from '../render-samples/catalog.ts';
import {sourceTokenOffset} from '../render-samples/source-focus.ts';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';
import * as THREE from 'three';

let compileProject: import('../src/model/project-compiler.ts').ProjectCompiler['compile'];
let bundledExamples: (typeof import('../src/project/bundled-examples.ts'))['bundledExamples'];
let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestProjectCompiler>>;
let replicad: typeof import('replicad');
let clearKernelOperationCache: (typeof import('../../core/bld/library/kernel-cache.js'))['clearKernelOperationCache'];
let kernelOperationCacheStats: (typeof import('../../core/bld/library/kernel-cache.js'))['kernelOperationCacheStats'];
let ModelViewport: (typeof import('../src/viewport.ts'))['ModelViewport'];
let sourceTargetPlacement: (typeof import('../src/viewport.ts'))['sourceTargetPlacement'];
let positionBindings: (typeof import('../src/viewport.ts'))['positionBindings'];
let applyNodeTransform: (typeof import('../src/rendering/model-renderer.ts'))['applyNodeTransform'];

before(async () => {
  server = await createAppTestServer();
  ({ModelViewport, sourceTargetPlacement, positionBindings} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    ));
  ({applyNodeTransform} = await server.ssrLoadModule<
    typeof import('../src/rendering/model-renderer.ts')
  >('/src/rendering/model-renderer.ts'));
  compiler = await createTestProjectCompiler(server);
  compileProject = compiler.compile.bind(compiler);
  await compileProject(
    {
      files: [
        {
          path: '/model.ts',
          source: 'import {box} from "@code3d/core"; box(1, 1, 1);',
        },
      ],
    },
    '/model.ts',
  );
  // Observe the project's instance, never a second host core/kernel.
  const replicadModules = [...defined(compiler['runtime']).modules].filter(
    ([path]) => path.endsWith('/replicad/dist/replicad.js'),
  );
  assert.equal(replicadModules.length, 1);
  replicad = replicadModules[0][1] as typeof replicad;
  ({clearKernelOperationCache, kernelOperationCacheStats} = defined(
    compiler['runtime'],
  ).modules.get(
    '/node_modules/@code3d/core/bld/library/kernel-cache.js',
  ) as typeof import('../../core/bld/library/kernel-cache.js'));
  ({bundledExamples} = await server.ssrLoadModule<
    typeof import('../src/project/bundled-examples.ts')
  >('/src/project/bundled-examples.ts'));
});

after(async () => {
  compiler?.dispose();
  await server?.close();
});

test('shell tools select input surfaces while displaying the result, including failed offsets', async () => {
  for (const [call, selected, failure] of [
    ['shell(1)', [], false],
    ['shell(1, [])', [], false],
    ['shell(-1, [6, 5, 6])', [5, 6], false],
    ['shell(11, [6])', [6], true],
    ['shell(1, [99, 6])', [6], true],
    ['shell(1, [1, 2, 3, 4, 5, 6])', [1, 2, 3, 4, 5, 6], true],
  ] as const) {
    const source = `import {box} from '@code3d/core';
const stock = box(30, 20, 10);
const hollow = stock.${call};
export default hollow;`;
    const module = await compileProject(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(Boolean(module.diagnostic), failure, call);
    const target = module.sourceTargets.find(
      target =>
        target.kind === 'topology-selection' &&
        source.slice(target.sourceRef.start, target.sourceRef.end) === call,
    );
    assert.ok(target, call);
    const evaluation = target.evaluations[0];
    assert.ok(defined(evaluation.selection).kind === 'surface');
    assert.deepEqual(defined(evaluation.selection).ids, selected);
    const input = module.objects.get(defined(evaluation.selection).inputNodeId);
    assert.equal(
      new Set(
        defined(defined(input).mesh).surfaceGroups.map(
          group => group.surfaceId,
        ),
      ).size,
      6,
    );
    const parameter = defined(target.tool).signature.parameters[1];
    assert.equal(parameter.name, 'removedSurfaceIds');
    assert.equal(selectionParameter(parameter).multiple, true);
    assert.equal(parameter.label, 'Openings');
    assert.equal(
      defined(defined(target.tool).arguments[1].target).kind,
      call === 'shell(1)' ? 'omitted' : 'present',
    );
    if (failure) {
      assert.deepEqual(evaluation.nodeIds, [defined(input).nodeId]);
    } else {
      assert.notEqual(evaluation.nodeIds[0], defined(input).nodeId);
      assert.ok(
        defined(module.operations.get(defined(evaluation.operationId))).kind ===
          'shell',
      );
    }
  }
});

test('exposed topology retains its geometry, placement and child selection scope', async () => {
  const source = `import {box, group, point} from '@code3d/core';
const part = box(10, 20, 30);
const shifted = group([part]).expose({body: part}).relate(self => self.body.center.on(point([40, 50, 60]).up).offset(0, 0, 0));
const assembly = group([shifted]).expose({mount: shifted.body.surface(1), body: shifted.body});
const outline = assembly.mount.edges();
const ends = assembly.mount.edge(1).vertices();
const center = assembly.mount.center;
const mixed = [center, assembly.mount.edge(1)];
export default assembly;`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const binding = (name: string) =>
    defined(
      module.sourceTargets.find(
        target =>
          target.kind === 'value' &&
          source.slice(target.sourceRef.start).startsWith(name + ' ='),
      ),
    ).evaluations[0];
  const outline = binding('outline');
  assert.equal(defined(outline.topologyReferences).length, 4);
  assert.equal(outline.nodeIds.length, 1);
  const ownerId = outline.nodeIds[0];
  assert.ok(defined(module.objects.get(ownerId)).kind === 'group');
  for (const reference of defined(outline.topologyReferences)) {
    assert.equal(reference.nodeId, ownerId);
    assert.ok(
      defined(module.objects.get(reference.geometryNodeId)).kind === 'solid',
    );
    assert.deepEqual(reference.transform.position, [40, 50, 60]);
  }
  const selection = defined(
    module.sourceTargets.find(
      target =>
        target.kind === 'topology-selection' &&
        source.slice(target.sourceRef.start, target.sourceRef.end) ===
          'edges()',
    ),
  ).evaluations[0].selection;
  assert.equal(defined(selection).inputNodeId, ownerId);
  assert.deepEqual(
    selectionScope(defined(selection)).availableIds,
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    selectionScope(defined(selection)).transform.position,
    [40, 50, 60],
  );
  assert.deepEqual(
    defined(binding('ends').topologyReferences).map(reference => {
      assert.ok('id' in reference);
      return reference.id;
    }),
    [1, 2],
  );
  assert.equal(defined(binding('center').anchorReferences).length, 1);
  assert.deepEqual(
    defined(binding('center').anchorReferences)[0].transform.position,
    [35, 50, 60],
  );
  assert.equal(binding('center').isCollection, false);
  assert.equal(defined(binding('mixed').topologyReferences).length, 1);
  assert.equal(defined(binding('mixed').anchorReferences).length, 1);
});

test('a failed chained selection keeps only the containing face selectable', async () => {
  const source = `import {box, group} from '@code3d/core';
const part = box(10, 20, 30);
const assembly = group([part]).expose({mount: part.surface(1)});
const invalid = assembly.mount.edge(12);`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.match(defined(module.diagnostic).summary, /does not belong/);
  const target = module.sourceTargets.find(
    target =>
      target.kind === 'topology-selection' &&
      source.slice(target.sourceRef.start, target.sourceRef.end) === 'edge(12)',
  );
  const selection = defined(target).evaluations[0].selection;
  assert.deepEqual(defined(selection).ids, []);
  assert.deepEqual(
    selectionScope(defined(selection)).availableIds,
    [1, 2, 3, 4],
  );
  assert.ok(
    defined(module.objects.get(defined(selection).inputNodeId)).kind ===
      'group',
  );
});

test('topology selection guides contain only the requested original IDs', async () => {
  const {restrictTopologyMesh} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    );
  const module = await compileProject(
    {
      files: [
        {
          path: '/model.ts',
          source: `import {box} from '@code3d/core'; export default box(10, 20, 30);`,
        },
      ],
    },
    '/model.ts',
  );
  const mesh = defined(module.fallback).mesh;
  const vertices = restrictTopologyMesh(
    defined(mesh),
    'vertex',
    new TopologyIdSet([2, 4]),
  );
  assert.deepEqual(vertices.vertexIds, [2, 4]);
  assert.equal(vertices.topologyVertices.length, 6);
  const edges = restrictTopologyMesh(
    defined(mesh),
    'edge',
    new TopologyIdSet([2, 4]),
  );
  assert.deepEqual(
    edges.edgeGroups.map(group => group.edgeId),
    [2, 4],
  );
  assert.equal(edges.edgeGroups[0].start, 0);
  assert.equal(
    edges.edges.length,
    edges.edgeGroups.reduce((sum, group) => sum + group.count * 3, 0),
  );
  const faces = restrictTopologyMesh(
    defined(mesh),
    'surface',
    new TopologyIdSet([2, 4]),
  );
  assert.deepEqual(
    faces.surfaceGroups.map(group => group.surfaceId),
    [2, 4],
  );
  assert.equal(faces.surfaceGroups[0].start, 0);
  assert.equal(
    faces.triangles.length,
    faces.surfaceGroups.reduce((sum, group) => sum + group.count, 0),
  );
});

test('a caret on range previews one map result with resolved collection placement', async () => {
  for (const count of [5, 1] as const) {
    const source = [
      "import range from 'just-range';",
      "import {box, group} from '@code3d/core';",
      'const base = box(44, 2, 10);',
      `const bars = range(${count}).map(i => box(4, 4 + i * 3, 4).relate(part => part.down.on(base.up).offset((i - 2) * 8, 0, 0)));`,
      'const first = bars[0];',
      'const singleton = [first];',
      'const set = new Set(bars);',
      'const map = new Map(bars.map((bar, i) => [i, bar]));',
      'export default group([base, ...bars]);',
    ].join('\n');
    const module = await compileProject(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const at = (text: string) =>
      ModelViewport.prototype['sourceTargetAt'].call(
        {module},
        '/model.ts',
        source.indexOf(text) + text.length,
      );
    const target = at('const bars = range');
    // Caret range|(n) belongs to the surrounding model-valued map call.
    assert.ok(defined(target).kind === 'value');
    assert.equal(defined(target).evaluations.length, 1);
    const evaluation = defined(target).evaluations[0];
    assert.equal(evaluation.nodeIds.length, count);
    assert.equal(sourceTargetPlacement(evaluation), 'composition');
    const positions = evaluation.nodeIds.map(nodeId => {
      const object = new THREE.Object3D();
      applyNodeTransform(
        object,
        defined(module.objects.get(nodeId)),
        sourceTargetPlacement(evaluation),
      );
      return object.position.x;
    });
    assert.deepEqual(
      positions,
      Array.from({length: count}, (_, i) => (i - 2) * 8),
    );
    assert.equal(
      sourceTargetPlacement(defined(at('const first')).evaluations[0]),
      'standalone',
    );
    for (const binding of ['singleton', 'set', 'map'] as const) {
      assert.equal(
        sourceTargetPlacement(defined(at(`const ${binding}`)).evaluations[0]),
        'composition',
      );
    }
  }
});

test('position bindings preserve inline expressions and prioritize safe upstream parameters in the outer call', async () => {
  const source = [
    "import {box, group} from '@code3d/core';",
    'const base = box(44, 2, 10);',
    'const spacing = 8;',
    'const bars = [1, 2].flatMap(i => [',
    '  box(4, 4, 4).relate(p => p.down.on(base.up).offset(i * 8, 0, 0)),',
    '  box(4, 4, 4).relate(p => p.down.on(base.up).offset(i * spacing, 0, 0)),',
    '  box(4, 4, 4).relate(p => p.down.on(base.up).offset(i * spacing, 0, 0).offset(2, 0, 0)),',
    ']);',
    'export default group([base, ...bars]);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const occurrences = defined(module.fallback).children.map((node, i) => ({
    key: `root/${i}`,
    node,
    object: new THREE.Object3D(),
    depth: 1,
    view: 'source' as const,
    placement: 'composition' as const,
  }));
  const bindings = [1, 2, 3].map(index =>
    positionBindings(occurrences[index], occurrences, null),
  );
  assert.ok(bindings[0][0].kind === 'expression');
  assert.ok(bindings[0][1].kind === 'parameter');
  assert.deepEqual(bindings[0][0].occurrenceKeys, ['root/1', 'root/4']);
  assert.ok(bindings[1][0].kind === 'parameter');
  assert.equal(bindings[1][0].target.sourceRef.start, source.indexOf('8;'));
  assert.ok(bindings[2][0].kind === 'parameter');
  assert.equal(
    bindings[2][0].target.sourceRef.start,
    source.indexOf('.offset(2') + '.offset('.length,
  );
});

test('editing a plate fillet does not rebuild an unchanged screw across compiles', async t => {
  clearKernelOperationCache();
  const loftWith = replicad.Sketch.prototype.loftWith;
  const lofts = t.mock.method(
    replicad.Sketch.prototype,
    'loftWith',
    function (
      this: import('replicad').Sketch,
      ...args: Parameters<typeof loftWith>
    ) {
      return loftWith.apply(this, args);
    },
  );
  const source = (radius: number) =>
    [
      'import {box, cut, group} from "@code3d/core";',
      'import {ISO4762} from "@code3d/screws";',
      `let plate = box(40, 10, 40).fillet(${radius}, [2, 3, 4, 6, 7, 8, 11, 12]).chamfer(1.2, [[1, 10]]);`,
      'const hole = ISO4762.clearanceHole("M6", 10).relate(tool => tool.shaftBottom.on(plate.down.flip()));',
      'plate = cut(plate, [hole]).paint("#666");',
      'const screw = ISO4762.screw("M6", 18).paint("#999").relate(part => part.headBottom.on(hole.counterboreBottom.flip()).offset(0, -0.5, 0));',
      'export default group([plate, screw], "M6 fastener demo");',
    ].join('\n');
  let buildCount;
  try {
    for (const radius of [2, 2.1, 2] as const) {
      const before = kernelOperationCacheStats();
      const module = await compileProject(
        {files: [{path: '/model.ts', source: source(radius)}]},
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
      assert.ok(module.exports.has('default'));
      if (buildCount === undefined) {
        buildCount = lofts.mock.callCount();
        assert.ok(buildCount > 0);
      } else {
        assert.equal(lofts.mock.callCount(), buildCount);
        if (radius === 2) {
          assert.equal(kernelOperationCacheStats().misses, before.misses);
        }
      }
    }
  } finally {
    clearKernelOperationCache();
  }
});

test('retains topology values at bindings, aliases, and collection results', async () => {
  const source = [
    'import {box, rectangle} from "@code3d/core";',
    'const plate = box(50, 4, 30);',
    'let screwPoints = rectangle(40, 20).relate(plane => plane.on(plate.up)).vertices();',
    'const alias = screwPoints;',
    'const subset = [screwPoints[0], screwPoints[2]];',
    'const repeated = [plate, plate];',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: 'model.ts', source}]},
    'model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const binding = (name: string) =>
    defined(
      module.sourceTargets.find(
        target =>
          target.kind === 'value' &&
          source.slice(target.sourceRef.start).startsWith(name + ' ='),
      ),
    ).evaluations[0];
  const points = binding('screwPoints');
  assert.equal(points.nodeIds.length, 1);
  assert.equal(defined(points.topologyReferences).length, 4);
  const call = module.sourceTargets.find(
    target => target.kind === 'topology-selection',
  );
  assert.deepEqual(
    defined(defined(call).evaluations[0].selection).ids,
    defined(points.topologyReferences).map(reference => {
      assert.ok('id' in reference);
      return reference.id;
    }),
  );
  assert.ok(
    defined(points.topologyReferences).every(
      reference =>
        reference.kind === 'vertex' && reference.nodeId === points.nodeIds[0],
    ),
  );
  assert.deepEqual(
    binding('alias').topologyReferences,
    points.topologyReferences,
  );
  assert.deepEqual(binding('subset').topologyReferences, [
    defined(points.topologyReferences)[0],
    defined(points.topologyReferences)[2],
  ]);
  assert.equal(binding('repeated').nodeIds.length, 2);
});

test('parameter previews observe bound values without changing function execution', async () => {
  const source = `import {box} from '@code3d/core';
    function strict(part) {
      'use strict';
      if (this !== undefined || arguments.length !== 1) throw new Error('function semantics changed');
      return part;
    }
    let reads = 0;
    const object = {get part() { reads++; return box(10, 10, 10); }};
    function unpack({part}, [peer], ...remaining) {
      if (remaining.length !== 1) throw new Error('rest arguments changed');
      return [strict(part), peer, ...remaining];
    }
    const models = unpack(object, [box(20, 20, 20)], box(30, 30, 30));
    if (reads !== 1) throw new Error('destructuring getter observed twice');
    const identity = (part = box(40, 40, 40)) => part;
    models.map(identity);
    identity();`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  for (const [binding, context, count, collection] of [
    ['part', 'function strict(', 1, false],
    ['part', 'function unpack(', 1, false],
    ['peer', 'function unpack(', 1, false],
    ['remaining', 'function unpack(', 1, true],
    ['part', 'const identity = (', 4, false],
  ] as const) {
    const start = source.indexOf(binding, source.indexOf(context));
    const target = ModelViewport.prototype['sourceTargetAt'].call(
      {module},
      '/model.ts',
      start + 1,
    );
    assert.ok(defined(target).kind === 'value');
    assert.equal(defined(target).sourceRef.start, start);
    assert.equal(defined(target).sourceRef.end, start + binding.length);
    assert.equal(defined(target).evaluations.length, count);
    assert.equal(
      new Set(
        defined(target).evaluations.flatMap(evaluation => evaluation.nodeIds),
      ).size,
      count,
    );
    for (const evaluation of defined(target).evaluations) {
      assert.equal(evaluation.isCollection, collection);
      assert.equal(evaluation.constraintId, undefined);
      assert.equal(evaluation.nodeIds.length, 1);
    }
  }
});

for (const compose of [true, false] as const) {
  test(`relate model values retain their relation context ${compose ? 'with' : 'without'} a loft consumer`, async () => {
    const source = `import {box, circle, loft, rectangle} from '@code3d/core';
      const model = (() => {
        const ref = box(100, 100, 100);
        const start = circle(20).relate(circle => circle.on(ref.down));
        const end = rectangle(40, 40).relate(circle => circle.on(ref.up));
        ${compose ? 'return loft([start, end]);' : ''}
      })();`;
    const module = await compileProject(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    for (const id of ['down', 'up'] as const) {
      const callback = `circle => circle.on(ref.${id})`;
      const callbackStart = source.indexOf(callback);
      const relation = defined(
        module.sourceTargets.find(
          target =>
            target.kind === 'constraint' &&
            source.slice(target.sourceRef.start, target.sourceRef.end) ===
              `circle.on(ref.${id})`,
        ),
      ).evaluations[0];
      for (const offset of [
        callbackStart + 3,
        callbackStart + 'circle => cir'.length,
      ] as const) {
        const target = ModelViewport.prototype['sourceTargetAt'].call(
          {module},
          '/model.ts',
          offset,
        );
        assert.ok(defined(target).kind === 'value');
        assert.equal(defined(target).evaluations.length, 1);
        const evaluation = defined(target).evaluations[0];
        assert.deepEqual(evaluation.nodeIds, relation.nodeIds);
        assert.deepEqual(evaluation.focusNodeIds, [
          relation.constraintOwnerNodeId,
        ]);
        assert.equal(evaluation.constraintId, relation.constraintId);
        assert.equal(sourceTargetPlacement(evaluation), 'composition');
        assert.deepEqual(
          defined(target).contextTargetIds,
          defined(
            module.sourceTargets.find(
              candidate =>
                candidate.kind === 'constraint' &&
                candidate.evaluations[0] === relation,
            ),
          ).contextTargetIds,
        );
      }
      const focused = module.objects.get(
        defined(relation.constraintOwnerNodeId),
      );
      assert.ok(
        defined(focused).compositionTransform.position.some(
          value => Math.abs(value) > 49,
        ),
      );
      assert.deepEqual(defined(focused).transform.position, [0, 0, 0]);
    }
  });
}

for (const [kind, sourceAnchor, targetAnchor] of [
  ['model', 'self', 'base.up'],
  ['edge', 'self.edge(id)', 'base.left'],
  ['surface', 'self.surface(id)', 'base.up'],
  ['vertex', 'self.vertex(id)', 'base.up'],
  ['named', 'self.up', 'base.down'],
] as const) {
  test(`${kind} anchors share relation context across runtime calls and downstream consumers`, async () => {
    const source = `import {box, group} from '@code3d/core';
      const base = box(10, 10, 10);
      function make(id: number) {
        const part = box(20, 20, 20).relate(self =>
          ${sourceAnchor}.on(${targetAnchor}).offset(7, 0, 0));
        const peer = box(2, 2, 2);
        const first = group([base, part, peer]);
        const second = group([base, part]);
        return group([first, second]);
      }
      export default group([make(2), make(3)]);`;
    const module = await compileProject(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const relation = module.sourceTargets.find(
      target =>
        target.kind === 'constraint' &&
        source.slice(target.sourceRef.start, target.sourceRef.end) ===
          `${sourceAnchor}.on(${targetAnchor})`,
    );
    assert.ok(relation);
    assert.equal(relation.evaluations.length, 4);
    for (const [anchor, isSource] of [
      [sourceAnchor, true],
      [targetAnchor, false],
    ] as const) {
      const target = ModelViewport.prototype['sourceTargetAt'].call(
        {module},
        '/model.ts',
        source.indexOf(anchor, source.indexOf(`${sourceAnchor}.on(`)) +
          anchor.length -
          1,
      );
      assert.equal(
        defined(target).kind,
        !isSource
          ? 'element'
          : kind === 'model'
            ? 'value'
            : kind === 'named'
              ? 'element'
              : 'topology-selection',
      );
      assert.equal(defined(target).evaluations.length, 4);
      assert.equal(
        new Set(defined(target).evaluations.map(e => e.contextId)).size,
        1,
      );
      assert.equal(
        new Set(defined(target).evaluations.map(e => e.constraintOwnerNodeId))
          .size,
        2,
      );
      for (const evaluation of defined(target).evaluations) {
        const constraint: SourceTargetEvaluation | undefined =
          relation.evaluations.find(
            candidate =>
              candidate.contextId === evaluation.contextId &&
              candidate.operationId === evaluation.operationId,
          );
        assert.ok(constraint);
        assert.deepEqual(evaluation.nodeIds, constraint.nodeIds);
        assert.equal(evaluation.constraintId, constraint.constraintId);
        assert.deepEqual(evaluation.operationInput, constraint.operationInput);
        assert.deepEqual(evaluation.runtime, constraint.runtime);
        const owner: string | undefined = isSource
          ? constraint.constraintOwnerNodeId
          : constraint.nodeIds.find(
              nodeId => nodeId !== constraint.constraintOwnerNodeId,
            );
        assert.deepEqual(evaluation.focusNodeIds, [owner]);
        assert.equal(sourceTargetPlacement(evaluation), 'composition');
        if (isSource && kind !== 'named' && kind !== 'model') {
          assert.equal(defined(evaluation.selection).kind, kind);
          assert.equal(defined(evaluation.selection).inputNodeId, owner);
          assert.deepEqual(defined(evaluation.selection).ids, [
            defined(evaluation.toolArguments)[0],
          ]);
          assert.ok(
            isSource
              ? [2, 3].includes(defined(evaluation.toolArguments)[0])
              : defined(evaluation.toolArguments)[0] === 1,
          );
          // Topology IDs keep their own call arguments; offset parameters must not leak in.
          assert.notEqual(
            evaluation.toolExecutionOrder,
            constraint.toolExecutionOrder,
          );
          assert.deepEqual(evaluation.parameters, []);
        }
      }
      assert.deepEqual(
        new Set(defined(target).contextTargetIds),
        new Set(relation.contextTargetIds),
      );
    }
  });
}

test('anchor context is limited to the enclosing relation in a constraint array', async () => {
  const source = `import {box, group} from '@code3d/core';
    const base = box(10, 10, 10);
    const alone = base.edge(2);
    const part = box(20, 20, 20).relate(self => [
      self.edge(3).on(base.left),
      self.up.on(base.down),
    ]);
    export default group([base, part]);`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const at = (text: string) =>
    ModelViewport.prototype['sourceTargetAt'].call(
      {module},
      '/model.ts',
      source.indexOf(text) + text.length - 1,
    );
  const edge = defined(at('self.edge(3)')).evaluations[0];
  const face = defined(at('self.up')).evaluations[0];
  assert.notEqual(edge.constraintId, face.constraintId);
  assert.equal(
    edge.constraintId,
    defined(at('base.left')).evaluations[0].constraintId,
  );
  assert.equal(
    face.constraintId,
    defined(at('base.down')).evaluations[0].constraintId,
  );
  const alone = defined(at('base.edge(2)')).evaluations[0];
  assert.equal(alone.nodeIds.length, 1);
  assert.equal(alone.constraintId, undefined);
  assert.equal(alone.operationId, undefined);
  assert.equal(sourceTargetPlacement(alone), 'standalone');
  assert.deepEqual(defined(at('base.edge(2)')).contextTargetIds, []);
});

test('represents an offset call with its constraint target', async () => {
  const source = sharedOffsetSource();
  const module = await compileProject(
    {files: [{path: 'model.ts', source}]},
    'model.ts',
  );
  const targets = exactTargets(module, source, 'offset(-spacing, 0, 0)');

  assert.deepEqual(
    targets.map(target => target.kind),
    ['constraint'],
  );
  assert.equal(targets[0].evaluations[0].nodeIds.length, 2);
  assert.deepEqual(targets[0].evaluations[0].toolArguments, {
    0: -24,
    1: 0,
    2: 0,
  });
});

test('derives parameter semantics from the call rather than variable annotations', async () => {
  const source = [
    "import {box} from '@code3d/core';",
    '/**',
    ' * @code3d.label Wrong label',
    ' * @code3d.description Not a tool description.',
    ' * @code3d.kind angle',
    ' * @code3d.unit cm',
    ' * @code3d.min 1000',
    ' * @code3d.max 1001',
    ' * @code3d.step 99',
    ' */',
    'const size = 40;',
    "/** @code3d.param width {kind: 'length', label: 'Width', constraints: {min: 1, max: 100}} */",
    'function plate(width: number) {return box(width, 10, 20);}',
    'plate(size * 2);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: 'model.ts', source}]},
    'model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const call = exactTargets(module, source, 'plate(size * 2)').find(
    target => target.tool,
  );
  assert.ok(call);
  assert.deepEqual(
    valueParameter(defined(call.tool).signature.parameters[0]).constraints,
    {
      min: 1,
      max: 100,
    },
  );
  assert.equal(defined(call.tool).signature.parameters[0].label, 'Width');
  const usage = defined(call.evaluations[0].parameters).find(
    parameter => parameter.operation === 'plate',
  );
  assert.ok(defined(usage).target.kind === 'length');
  assert.equal(defined(usage).target.label, 'Size');
  assert.equal(defined(usage).target.value, 40);
  assert.equal(defined(usage).value, 80);
  assert.equal(defined(usage).sensitivity, 2);
  assert.equal(
    source.slice(
      defined(usage).target.sourceRef.start,
      defined(usage).target.sourceRef.end,
    ),
    '40',
  );
  assert.deepEqual(Object.keys(defined(usage).target).sort(), [
    'id',
    'kind',
    'label',
    'sourceRef',
    'value',
  ]);
});

test('retains shared-parameter peers in a group input context', async () => {
  const source = sharedOffsetSource();
  const module = await compileProject(
    {files: [{path: 'model.ts', source}]},
    'model.ts',
  );
  const leftInput = exactTargets(
    module,
    source,
    'left',
    'group([base, left',
  ).find(target => target.kind === 'operation-input');
  assert.ok(leftInput);
  const evaluation = leftInput.evaluations[0];
  const contextNodeIds = leftInput.contextTargetIds.flatMap(targetId => {
    const target = module.sourceTargets.find(
      candidate => candidate.id === targetId,
    );
    return (
      target?.evaluations.find(
        candidate => candidate.operationId === evaluation.operationId,
      )?.nodeIds ?? []
    );
  });
  const spacingTargetId = defined(
    exactTargets(module, source, 'offset(-spacing, 0, 0)')[0].evaluations[0]
      .parameters,
  ).find(
    parameter => parameter.operation === 'offset' && parameter.argument === 'x',
  )?.target.id;

  assert.ok(spacingTargetId);
  assert.ok(
    contextNodeIds.some(nodeId =>
      module.objects
        .get(nodeId)
        ?.parameters.some(parameter => parameter.target.id === spacingTargetId),
    ),
  );
});

for (const call of [
  'origin(9, 8, 7)',
  'originOffset(0, 2, 0)',
  'originVertex(3)',
  'originCenter()',
  'rotate(0, 0, 90)',
] as const) {
  test(`retains the model before ${call} at its receiver source range`, async () => {
    const source = [
      'import {box} from "@code3d/core";',
      'const pivoted = box(8, 6, 4).origin(1, 2, 3);',
      `const direct = pivoted.${call};`,
      `const chained = pivoted.originOffset(0, 5, 0).${call};`,
    ].join('\n');
    const module = await compileProject(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    for (const [binding, receiver, origin] of [
      ['direct', 'pivoted', [1, 2, 3]],
      ['chained', 'pivoted.originOffset(0, 5, 0)', [1, 7, 3]],
    ] as const) {
      const context = `const ${binding} = ${receiver}.${call}`;
      const input = exactTargets(module, source, receiver, context).find(
        target => target.kind === 'operation-input',
      );
      assert.ok(input, `missing receiver target for ${context}`);
      const output = module.sourceTargets.find(target => {
        const evaluation = target.evaluations[0];
        return (
          evaluation.operationId === input.evaluations[0].operationId &&
          target.kind ===
            (call.startsWith('originVertex')
              ? 'topology-selection'
              : 'operation-output')
        );
      });
      assert.ok(output);
      // The caret immediately before the dot belongs to the receiver.
      assert.equal(source[input.sourceRef.end], '.');
      assert.equal(output.sourceRef.start, input.sourceRef.end + 1);
      const evaluation = input.evaluations[0];
      const operation = module.operations.get(defined(evaluation.operationId));
      assert.equal(evaluation.operationId, output.evaluations[0].operationId);
      assert.equal(defined(operation).kind, call.slice(0, call.indexOf('(')));
      assert.deepEqual(evaluation.nodeIds, [
        defined(operation).inputs[0].nodeId,
      ]);
      assert.notEqual(evaluation.nodeIds[0], defined(operation).outputNodeId);
      assert.deepEqual(
        defined(module.objects.get(evaluation.nodeIds[0])).origin,
        origin,
      );
    }
  });
}

test('captures computed methods and model-valued inputs without operation metadata', async () => {
  const source = [
    'import {box} from "@code3d/core";',
    'const pivoted = box(8, 6, 4).origin(1, 2, 3);',
    'const method = "originOffset";',
    'const changed = pivoted[method](0, 5, 0);',
    'function inspect(model) { return model.originCenter(); }',
    'const inspected = inspect(changed);',
    'const vertex = changed.vertex(1);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  for (const [text, context, expected] of [
    ['pivoted', 'changed = pivoted', [1, 2, 3]],
    ['changed', 'inspect(changed)', [1, 7, 3]],
    ['changed', 'vertex = changed', [1, 7, 3]],
  ] as const) {
    const start = source.indexOf(text, source.indexOf(context));
    const target = ModelViewport.prototype['sourceTargetAt'].call(
      {module},
      '/model.ts',
      start + text.length,
    );
    assert.equal(defined(target).sourceRef.start, start);
    assert.equal(defined(target).sourceRef.end, start + text.length);
    assert.deepEqual(
      defined(module.objects.get(defined(target).evaluations[0].nodeIds[0]))
        .origin,
      expected,
    );
  }
});

test('derives composition roles for imported aliases, namespace calls, and nested inputs', async () => {
  const source = [
    'import * as core from "@code3d/core";',
    'import {loft as skin, group as assemble} from "@code3d/core";',
    'const spine = core.bezier([[0, 0, 0], [12, 7, 0], [10, 20, 9], [4, 28, 14]]);',
    'const start = core.circle(4).relate(p => p.on(core.point().up).offset(0, 0, 0).rotate(0, 0, -Math.atan2(12, 7) * 180 / Math.PI));',
    'const end = core.rectangle(7, 4).relate(p => p.on(core.point([4, 28, 14]).up).offset(0, 0, 0).rotate(Math.atan2(5, 10) * 180 / Math.PI, 0, Math.atan2(6, 8) * 180 / Math.PI));',
    'const body = skin([...[start], end], {spine});',
    'const sections = [start, end];',
    'const options = {spine};',
    'const second = core.loft(sections, options);',
    'export default assemble([body, second]);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  for (const [text, context, role] of [
    ['start', 'skin([...[start]', 'receiver'],
    ['end', 'skin([...[start], end', 'section'],
    ['spine', 'skin([...[start], end], {spine}', 'spine'],
    ['sections', 'core.loft(sections', 'collection'],
    ['options', 'core.loft(sections, options', 'spine'],
    ['body', 'assemble([body', 'child'],
  ] as const) {
    const target = exactTargets(module, source, text, context).find(
      target => target.kind === 'operation-input',
    );
    assert.ok(target, `${context}: missing ${text}`);
    assert.equal(defined(target.operation).role, role);
    const evaluation = target.evaluations[0];
    const operation = module.operations.get(defined(evaluation.operationId));
    assert.ok(
      evaluation.nodeIds.every(id =>
        defined(operation).inputs.some(input => input.nodeId === id),
      ),
    );
    // Container tracing must not create duplicate sibling previews.
    const peers = target.contextTargetIds.flatMap(
      id =>
        defined(module.sourceTargets.find(candidate => candidate.id === id))
          .evaluations[0].nodeIds,
    );
    assert.equal(peers.length, new Set(peers).size);
  }
});

test('keeps repeated and failed receiver evaluations separate', async () => {
  const source = [
    'import {box} from "@code3d/core";',
    'const pivoted = box(8, 6, 4).origin(1, 2, 3);',
    'const results = [2, 5].map(y => pivoted.originOffset(0, y, 0));',
    'const changed = results[1];',
    'export const failed = changed.originVertex(9999);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.ok(module.diagnostic);
  const repeated = exactTargets(module, source, 'pivoted', 'y => pivoted').find(
    target => target.kind === 'operation-input',
  );
  assert.equal(defined(repeated).evaluations.length, 2);
  assert.equal(
    new Set(
      defined(repeated).evaluations.map(evaluation => evaluation.operationId),
    ).size,
    2,
  );
  assert.deepEqual(
    [...defined(repeated).evaluations]
      .sort((a, b) => a.runtime.order - b.runtime.order)
      .map(
        evaluation =>
          defined(
            module.objects.get(
              defined(module.operations.get(defined(evaluation.operationId)))
                .outputNodeId,
            ),
          ).origin,
      ),
    [
      [1, 4, 3],
      [1, 7, 3],
    ],
  );
  const beforeFailure = exactTargets(
    module,
    source,
    'changed',
    'failed = changed',
  ).find(target => target.kind === 'value');
  assert.ok(beforeFailure);
  assert.deepEqual(
    defined(module.objects.get(beforeFailure.evaluations[0].nodeIds[0])).origin,
    [1, 7, 3],
  );
  const failure = exactTargets(module, source, 'originVertex(9999)').find(
    target => target.kind === 'topology-selection',
  );
  assert.equal(defined(failure).evaluations[0].runtime.outcome, 'failed');
  assert.deepEqual(defined(defined(failure).evaluations[0].selection).ids, []);
});

test('input observation preserves getters, this, argument order, and optional calls', async () => {
  const source = [
    'import {box, group} from "@code3d/core";',
    'const base = box(8, 6, 4);',
    'let reads = 0;',
    'const container = { get model() { reads++; return base; }, call(model) { if (this !== container) throw Error("this"); return model.originCenter(); } };',
    'const first = container.call(container.model);',
    'if (reads !== 1) throw Error(`reads: ${reads}`);',
    'const missing = undefined;',
    'missing?.originOffset(reads++, 0, 0);',
    'base.originOffset?.(0, 1, 0);',
    'if (reads !== 1) throw Error("optional arguments");',
    'export default group([first]);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
});

test('a failed repetition retains its own receiver instead of the previous successful input', async () => {
  const source = [
    'import {box} from "@code3d/core";',
    'const base = box(8, 6, 4);',
    'for (const id of [1, 9999]) {',
    '  const current = base.origin(0, id, 0);',
    '  current.originVertex(id);',
    '}',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.ok(module.diagnostic);
  const target = ModelViewport.prototype['sourceTargetAt'].call(
    {module},
    '/model.ts',
    source.indexOf('current.origin') + 'current'.length,
  );
  assert.equal(defined(target).evaluations.length, 2);
  assert.deepEqual(
    defined(target).evaluations.map(
      evaluation => defined(module.objects.get(evaluation.nodeIds[0])).origin,
    ),
    [
      [0, 9999, 0],
      [0, 1, 0],
    ],
  );
  assert.equal(defined(target).evaluations[0].operationId, undefined);
  assert.ok(defined(target).evaluations[1].operationId);
});

test('input target identities survive preceding text edits', async () => {
  const body = [
    'import {box, group as assemble} from "@code3d/core";',
    'const base = box(8, 6, 4);',
    'const moved = base.originOffset(0, 2, 0);',
    'export default assemble([base, moved]);',
  ].join('\n');
  const targets: SourceTarget[][] = [];
  for (const source of [body, '// preceding edit\n' + body] as const) {
    const module = await compileProject(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    targets.push(
      module.sourceTargets.filter(target => target.kind === 'operation-input'),
    );
  }
  assert.deepEqual(
    targets[0].map(target => target.id),
    targets[1].map(target => target.id),
  );
  assert.ok(
    targets[1].every(
      (target, i) => target.sourceRef.start > targets[0][i].sourceRef.start,
    ),
  );
});

test('evaluates a user-defined Replicad primitive', async () => {
  const source = [
    'import {definePrimitive, replicad} from "@code3d/core/replicad";',
    '/** @code3d.param radius {kind: "length"} */',
    'const cylinder = definePrimitive((radius: number) =>',
    '  replicad.makeCylinder(radius, 4),',
    ');',
    'export const model = cylinder(2);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: 'model.ts', source}]},
    'model.ts',
  );

  assert.equal(module.diagnostic, undefined);
  const modelId = module.exports.get('model');
  assert.ok(modelId);
  assert.ok(module.objects.get(modelId)?.operation.kind === 'primitive');
  assert.ok(
    exactTargets(module, source, 'cylinder(2)').some(
      target => target.kind === 'operation-output',
    ),
  );
  const output = exactTargets(module, source, 'cylinder(2)').find(
    target => target.kind === 'operation-output',
  );
  assert.equal(
    defined(defined(output).evaluations[0].parameters)[0]?.argument,
    'radius',
  );
});

test('compiles the standalone custom primitive example with direct annotations and a default argument', async () => {
  const rootPath = '/examples/custom-primitives.ts';
  const module = await compileProject({files: bundledExamples.files}, rootPath);
  assert.equal(module.diagnostic, undefined);
  assert.ok(module.exports.has('customPrimitivesExample'));
  const source = defined(
    bundledExamples.files.find(file => file.path === rootPath),
  ).source;

  for (const [call, arguments_] of [
    ['twistKnob(10, 3, 14)', ['radius', 'shaftRadius', 'y']],
    ['twistKnob(10, 3, 8, 30)', ['radius', 'shaftRadius', 'y', 'twist']],
  ] as const) {
    const start = source.indexOf(call);
    assert.notEqual(start, -1);
    const target = module.sourceTargets.find(
      target =>
        target.kind === 'operation-output' &&
        target.sourceRef.file === rootPath &&
        target.sourceRef.start === start,
    );
    assert.ok(target);
    const evaluation = target.evaluations[0];
    assert.deepEqual(
      defined(evaluation.parameters).map(parameter => parameter.argument),
      arguments_,
    );
    assert.deepEqual(
      defined(evaluation.parameters).map(parameter => parameter.target.kind),
      arguments_.map(argument => (argument === 'twist' ? 'angle' : 'length')),
    );
    assert.equal(
      defined(evaluation.parameters).find(
        parameter => parameter.argument === 'twist',
      )?.value,
      arguments_.some(argument => argument === 'twist') ? 30 : undefined,
    );
    const model = module.objects.get(evaluation.nodeIds[0]);
    assert.ok(defined(model).operation.kind === 'primitive');
    assert.ok(defined(defined(model).mesh).triangles.length > 0);
  }
});

test('the documented origin example exposes each spatial operation and its assembly', async () => {
  const rootPath = '/examples/origin-and-rotation.ts';
  const file = bundledExamples.files.find(file => file.path === rootPath);
  assert.ok(file);
  const module = await compileProject({files: [file]}, rootPath);
  assert.equal(module.diagnostic, undefined);
  for (const [text, kind, parameters] of [
    ['blank.originVertex(3)', 'originVertex', ['id']],
    ['pivoted.originOffset(0, 2, 0)', 'originOffset', ['dx', 'dy', 'dz']],
    ['offset.rotate(15, 35, 0)', 'rotate', ['x', 'y', 'z']],
    ['rotated.originCenter()', 'originCenter', undefined],
    ['rotated.origin(0, 0, 0)', 'origin', ['x', 'y', 'z']],
  ] as const) {
    // The receiver is a separate input scope; the tool starts at the method name.
    const targets = exactTargets(
      module,
      file.source,
      defined(text).slice(defined(text).indexOf('.') + 1),
      text,
    );
    assert.ok(
      targets.some(target =>
        target.evaluations.some(evaluation => {
          const operation = module.operations.get(
            defined(evaluation.operationId),
          );
          return operation?.kind === kind && defined(operation).spatial;
        }),
      ),
      `The guide needs an inspectable spatial context for ${text}`,
    );
    if (parameters) {
      const target = targets.find(target => target.tool);
      assert.deepEqual(
        defined(target?.tool).signature.parameters.map(
          parameter => parameter.name,
        ),
        parameters,
      );
    }
  }
  const assembly = exactTargets(
    module,
    file.source,
    'group([rotated, companion])',
  );
  assert.ok(
    assembly.some(target =>
      target.evaluations.some(evaluation => evaluation.nodeIds.length > 0),
    ),
  );
});

test('the shared combined-constraints guide retains both inspectable relations', async () => {
  const rootPath = '/examples/combined-constraints.ts';
  const file = bundledExamples.files.find(file => file.path === rootPath);
  assert.ok(file);
  const module = await compileProject({files: [file]}, rootPath);
  assert.equal(module.diagnostic, undefined);
  assert.ok(module.exports.has('default'));
  const relations = ['first.right', 'first.down'].map(text => {
    const target = ModelViewport.prototype['sourceTargetAt'].call(
      {module},
      rootPath,
      file.source.indexOf(text) + text.length - 1,
    );
    const evaluation = defined(target).evaluations[0];
    assert.ok(evaluation.constraintId);
    assert.equal(sourceTargetPlacement(evaluation), 'composition');
    assert.equal(evaluation.nodeIds.length, 2);
    return evaluation.constraintId;
  });
  assert.notEqual(relations[0], relations[1]);
});

test('the App guide distinguishes a method receiver, its result and an ordinary function input', async () => {
  const document = await readFile(
    new URL(
      '../../web/src/content/docs/docs/getting-started/app.md',
      import.meta.url,
    ),
    'utf8',
  );
  const source = [...document.matchAll(/\`\`\`ts\n([\s\S]*?)\`\`\`/g)]
    .map(match => match[1])
    .find(source => source.includes('centered(rounded)'));
  assert.ok(source);
  const rootPath = '/model.ts';
  const module = await compileProject(
    {files: [{path: rootPath, source}]},
    rootPath,
  );
  assert.equal(module.diagnostic, undefined);
  const at = (text: string, context = text) => {
    const start = source.indexOf(text, source.indexOf(context));
    return ModelViewport.prototype['sourceTargetAt'].call(
      {module},
      rootPath,
      start + text.length - 1,
    );
  };
  const receiver = at('blank', 'blank.fillet(1)');
  const result = at('fillet(1)');
  const argument = at('rounded', 'centered(rounded)');
  assert.notDeepEqual(
    defined(receiver).evaluations[0].nodeIds,
    defined(result).evaluations[0].nodeIds,
  );
  assert.deepEqual(
    defined(argument).evaluations[0].nodeIds,
    defined(result).evaluations[0].nodeIds,
  );
  assert.equal(defined(at('centered(rounded)')).tool, undefined);
});

for (const sample of renderSamples) {
  test(`compiles the shared gallery source and focus for ${sample.id}`, async () => {
    const rootPath = '/examples/' + sample.file;
    const file = bundledExamples.files.find(file => file.path === rootPath);
    assert.ok(file, `Gallery source must be bundled in App: ${rootPath}`);
    const module = await compileProject({files: [file]}, rootPath);
    assert.equal(module.diagnostic, undefined);
    const offset = sourceTokenOffset(file.source, sample.focus);
    assert.ok(
      module.sourceTargets.some(
        target =>
          target.sourceRef.file === rootPath &&
          target.sourceRef.start <= offset &&
          target.sourceRef.end > offset &&
          target.evaluations.some(evaluation => evaluation.nodeIds.length > 0),
      ),
      'The gallery image must focus a renderable source context',
    );
  });
}

test('the documented function offers parameter tools and design-time arguments', async () => {
  const rootPath = '/examples/design-arguments.ts';
  const file = bundledExamples.files.find(file => file.path === rootPath);
  const module = await compileProject({files: [defined(file)]}, rootPath);
  assert.equal(module.diagnostic, undefined);
  const call = exactTargets(
    module,
    defined(file).source,
    'makeKnob(10, 5, 6)',
  ).find(target => target.tool);
  assert.ok(call);
  assert.deepEqual(
    defined(call.tool).signature.parameters.map(parameter => parameter.name),
    ['radius', 'height', 'sides'],
  );
  assert.deepEqual(
    valueParameter(defined(call.tool).signature.parameters[2]).constraints,
    {min: 3},
  );
  assert.deepEqual(
    module.designArguments.map(context => context.label),
    ['10, 5, 6', '14, 7, 8'],
  );
  for (const context of module.designArguments) {
    const preview = await compileProject(
      {files: [defined(file)]},
      rootPath,
      context.id,
    );
    assert.equal(preview.diagnostic, undefined);
    assert.equal(preview.activeDesignContextId, context.id);
  }
});

test('the npm documentation example compiles with the installed just-range package', async () => {
  const document = await readFile(
    new URL(
      '../../web/src/content/docs/docs/getting-started/files.md',
      import.meta.url,
    ),
    'utf8',
  );
  const source = [...document.matchAll(/\`\`\`ts\n([\s\S]*?)\`\`\`/g)]
    .map(match => match[1])
    .find(source => source.includes("from 'just-range'"));
  assert.ok(source);
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  assert.ok(module.fallback);
});

test('compiles one coil in the bundled primitives showcase without a separate coil example', async () => {
  const rootPath = '/examples/primitives.ts';
  const module = await compileProject({files: bundledExamples.files}, rootPath);
  assert.equal(module.diagnostic, undefined);
  assert.ok(module.exports.has('primitivesExample'));
  assert.ok(
    !bundledExamples.files.some(file => file.path === '/examples/coils.ts'),
  );
  const source = defined(
    bundledExamples.files.find(file => file.path === rootPath),
  ).source;
  assert.equal([...source.matchAll(/\bcoil\(/g)].length, 1);
  const start = source.indexOf('coil(5, 0.75, 4, 2.5)');
  assert.notEqual(start, -1);
  const target = module.sourceTargets.find(
    target =>
      target.kind === 'operation-output' &&
      target.sourceRef.file === rootPath &&
      target.sourceRef.start === start,
  );
  assert.deepEqual(
    defined(target?.evaluations[0].parameters).map(
      parameter => parameter.argument,
    ),
    ['coilRadius', 'wireRadius', 'pitch', 'turns'],
  );
  const model = module.objects.get(defined(target).evaluations[0].nodeIds[0]);
  assert.ok(defined(model).operation.kind === 'coil');
  assert.ok(defined(defined(model).mesh).triangles.length > 0);
});

test('compiles the core tube example with its own operation and editable dimensions', async () => {
  const rootPath = '/examples/primitives.ts';
  const module = await compileProject({files: bundledExamples.files}, rootPath);
  assert.equal(module.diagnostic, undefined);
  const source = defined(
    bundledExamples.files.find(file => file.path === rootPath),
  ).source;
  const start = source.indexOf('tube(5.5, 4.5, 4)');
  assert.notEqual(start, -1);
  const target = module.sourceTargets.find(
    target =>
      target.kind === 'operation-output' &&
      target.sourceRef.file === rootPath &&
      target.sourceRef.start === start,
  );
  assert.deepEqual(
    defined(target?.evaluations[0].parameters).map(
      parameter => parameter.argument,
    ),
    ['outerRadius', 'innerRadius', 'y'],
  );
  const model = module.objects.get(defined(target).evaluations[0].nodeIds[0]);
  assert.ok(defined(model).operation.kind === 'tube');
  assert.ok(defined(defined(model).mesh).triangles.length > 0);
});

function sharedOffsetSource() {
  return [
    'import {box, group} from "@code3d/core";',
    'const spacing = 24;',
    'const base = box(12, 4, 12);',
    'const left = box(8, 8, 8).relate(part =>',
    '  part.center.on(base.up).offset(-spacing, 0, 0),',
    ');',
    'const right = box(8, 8, 8).relate(part =>',
    '  part.center.on(base.up).offset(spacing, 0, 0),',
    ');',
    'export const model = group([base, left, right]);',
  ].join('\n');
}

function exactTargets(
  module: Awaited<ReturnType<typeof compileProject>>,
  source: string,
  text: string,
  context = text,
) {
  const contextStart = source.indexOf(context);
  assert.notEqual(contextStart, -1, `missing fixture context: ${context}`);
  const textStart = context.indexOf(text);
  assert.notEqual(textStart, -1, `missing ${text} in ${context}`);
  const start = contextStart + textStart;
  const end = start + text.length;
  return module.sourceTargets.filter(
    target => target.sourceRef.start === start && target.sourceRef.end === end,
  );
}

test('path IDs keep singular/list schemas, scope and failed-selection recovery', async () => {
  const source = `import {loft, rectangle, point} from '@code3d/core';
const base = rectangle(8, 6);
const top = rectangle(6, 4).relate(p => p.on(point([0, 12, 0]).up));
const body = loft([base, top]);
const cap = body.surface([1, 1]);
const rims = body.edges([[1, 1], [2, 1], 1]);
const corner = cap.vertex([1, 1]);
const invalid = cap.edges([[1, 1], [2, 1]]);`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.match(defined(module.diagnostic).summary, /E\[2,1\] does not belong/);
  const target = (text: string) =>
    module.sourceTargets.find(
      target =>
        target.kind === 'topology-selection' &&
        source.slice(target.sourceRef.start, target.sourceRef.end) === text,
    );
  for (const expression of ['surface([1, 1])', 'vertex([1, 1])'] as const) {
    const selection = target(expression);
    assert.equal(
      selectionParameter(
        defined(defined(selection).tool).signature.parameters[0],
      ).multiple,
      false,
    );
    assert.deepEqual(defined(defined(selection).evaluations[0].selection).ids, [
      [1, 1],
    ]);
  }
  const list = target('edges([[1, 1], [2, 1], 1])');
  assert.equal(
    selectionParameter(defined(defined(list).tool).signature.parameters[0])
      .multiple,
    true,
  );
  assert.deepEqual(defined(defined(list).evaluations[0].selection).ids, [
    [1, 1],
    [2, 1],
    1,
  ]);
  const invalid = defined(target('edges([[1, 1], [2, 1]])')).evaluations[0]
    .selection;
  assert.deepEqual(defined(invalid).ids, [[1, 1]]);
  assert.deepEqual(selectionScope(defined(invalid)).availableIds, [
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 4],
  ]);
  const {restrictTopologyMesh} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    );
  const mesh = structuredClone(
    defined(module.objects.get(selectionScope(defined(invalid)).geometryNodeId))
      .mesh,
  );
  const selected = restrictTopologyMesh(
    defined(mesh),
    'edge',
    new TopologyIdSet([
      [1, 1],
      [2, 1],
    ]),
  );
  assert.deepEqual(
    selected.edgeGroups.map(group => group.edgeId),
    [
      [1, 1],
      [2, 1],
    ],
  );
});

function selectionParameter(parameter: ToolParameterSchema) {
  assert.ok(
    parameter.kind === 'vertex' ||
      parameter.kind === 'edge' ||
      parameter.kind === 'surface',
  );
  return parameter;
}
function valueParameter(parameter: ToolParameterSchema) {
  assert.ok(
    parameter.kind === 'length' ||
      parameter.kind === 'angle' ||
      parameter.kind === 'scalar' ||
      parameter.kind === 'count',
  );
  return parameter;
}
function selectionScope(
  selection: NonNullable<SourceTargetEvaluation['selection']>,
) {
  assert.ok('scope' in selection);
  return defined(selection.scope);
}
