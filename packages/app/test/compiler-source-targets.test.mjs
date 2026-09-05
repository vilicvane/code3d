import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestProjectCompiler} from './project-test-files.mjs';
import * as THREE from 'three';

let compileProject;
let bundledExamples;
let server;
let compiler;
let replicad;
let clearKernelOperationCache;
let kernelOperationCacheStats;
let ModelViewport;
let sourceTargetPlacement;
let positionBindings;
let applyNodeTransform;

before(async () => {
  server = await createAppTestServer();
  ({ModelViewport, sourceTargetPlacement, positionBindings} =
    await server.ssrLoadModule('/src/viewport.ts'));
  ({applyNodeTransform} = await server.ssrLoadModule(
    '/src/rendering/model-renderer.ts',
  ));
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
  const replicadModules = [...compiler.runtime.modules].filter(([path]) =>
    path.endsWith('/replicad/dist/replicad.js'),
  );
  assert.equal(replicadModules.length, 1);
  replicad = replicadModules[0][1];
  ({clearKernelOperationCache, kernelOperationCacheStats} =
    compiler.runtime.modules.get(
      '/node_modules/@code3d/core/bld/library/kernel-cache.js',
    ));
  ({bundledExamples} = await server.ssrLoadModule(
    '/src/project/bundled-examples.ts',
  ));
});

after(async () => {
  compiler?.dispose();
  await server?.close();
});

test('a caret on range previews one map result with resolved collection placement', async () => {
  for (const count of [5, 1]) {
    const source = [
      "import range from 'just-range';",
      "import {box, group} from '@code3d/core';",
      'const base = box(44, 2, 10);',
      `const bars = range(${count}).map(i => box(4, 4 + i * 3, 4).relate(part => part.bottom.on(base.top).offset((i - 2) * 8, 0, 0)));`,
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
    const at = text =>
      ModelViewport.prototype.sourceTargetAt.call(
        {module},
        '/model.ts',
        source.indexOf(text) + text.length,
      );
    const target = at('const bars = range');
    // Caret range|(n) belongs to the surrounding model-valued map call.
    assert.equal(target.kind, 'value');
    assert.equal(target.evaluations.length, 1);
    const evaluation = target.evaluations[0];
    assert.equal(evaluation.nodeIds.length, count);
    assert.equal(sourceTargetPlacement(evaluation), 'composition');
    const positions = evaluation.nodeIds.map(nodeId => {
      const object = new THREE.Object3D();
      applyNodeTransform(
        object,
        module.objects.get(nodeId),
        sourceTargetPlacement(evaluation),
      );
      return object.position.x;
    });
    assert.deepEqual(
      positions,
      Array.from({length: count}, (_, i) => (i - 2) * 8),
    );
    assert.equal(
      sourceTargetPlacement(at('const first').evaluations[0]),
      'standalone',
    );
    for (const binding of ['singleton', 'set', 'map']) {
      assert.equal(
        sourceTargetPlacement(at(`const ${binding}`).evaluations[0]),
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
    '  box(4, 4, 4).relate(p => p.bottom.on(base.top).offset(i * 8, 0, 0)),',
    '  box(4, 4, 4).relate(p => p.bottom.on(base.top).offset(i * spacing, 0, 0)),',
    '  box(4, 4, 4).relate(p => p.bottom.on(base.top).offset(i * spacing, 0, 0).offset(2, 0, 0)),',
    ']);',
    'export default group([base, ...bars]);',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const occurrences = module.fallback.children.map((node, i) => ({
    key: `root/${i}`,
    node,
  }));
  const bindings = [1, 2, 3].map(index =>
    positionBindings(occurrences[index], occurrences, null),
  );
  assert.equal(bindings[0][0].kind, 'expression');
  assert.equal(bindings[0][1].kind, 'parameter');
  assert.deepEqual(bindings[0][0].occurrenceKeys, ['root/1', 'root/4']);
  assert.equal(bindings[1][0].kind, 'parameter');
  assert.equal(bindings[1][0].target.sourceRef.start, source.indexOf('8;'));
  assert.equal(bindings[2][0].kind, 'parameter');
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
    function (...args) {
      return loftWith.apply(this, args);
    },
  );
  const source = radius =>
    [
      'import {box, cut, group} from "@code3d/core";',
      'import {ISO4762} from "@code3d/screws";',
      `let plate = box(40, 10, 40).fillet(${radius}, [2, 3, 4, 6, 7, 8, 11, 12]).chamfer(1.2, [10]);`,
      'const hole = ISO4762.clearanceHole("M6", 10).relate(tool => tool.shaftBottom.on(plate.bottom).flip());',
      'plate = cut(plate, [hole]).paint("#666");',
      'const screw = ISO4762.screw("M6", 18).paint("#999").relate(part => part.headBottom.on(hole.counterboreBottom).flip().offset(0, -0.5, 0));',
      'export default group([plate, screw], "M6 fastener demo");',
    ].join('\n');
  let buildCount;
  try {
    for (const radius of [2, 2.1, 2]) {
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
    'let screwPoints = rectangle(40, 20).relate(plane => plane.on(plate.top)).vertices();',
    'const alias = screwPoints;',
    'const subset = [screwPoints[0], screwPoints[2]];',
    'const repeated = [plate, plate];',
  ].join('\n');
  const module = await compileProject(
    {files: [{path: 'model.ts', source}]},
    'model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const binding = name =>
    module.sourceTargets.find(
      target =>
        target.kind === 'value' &&
        source.slice(target.sourceRef.start).startsWith(name + ' ='),
    ).evaluations[0];
  const points = binding('screwPoints');
  assert.equal(points.nodeIds.length, 1);
  assert.equal(points.topologyReferences.length, 4);
  const call = module.sourceTargets.find(
    target => target.kind === 'topology-selection',
  );
  assert.deepEqual(
    call.evaluations[0].selection.ids,
    points.topologyReferences.map(reference => reference.id),
  );
  assert.ok(
    points.topologyReferences.every(
      reference =>
        reference.kind === 'vertex' && reference.nodeId === points.nodeIds[0],
    ),
  );
  assert.deepEqual(
    binding('alias').topologyReferences,
    points.topologyReferences,
  );
  assert.deepEqual(binding('subset').topologyReferences, [
    points.topologyReferences[0],
    points.topologyReferences[2],
  ]);
  assert.equal(binding('repeated').nodeIds.length, 2);
});

for (const [kind, sourceAnchor, targetAnchor] of [
  ['edge', 'self.edge(id)', 'base.edge(1)'],
  ['surface', 'self.surface(id)', 'base.surface(1)'],
  ['vertex', 'self.vertex(id)', 'base.vertex(1)'],
  ['named', 'self.top', 'base.bottom'],
]) {
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
    ]) {
      const target = ModelViewport.prototype.sourceTargetAt.call(
        {module},
        '/model.ts',
        source.indexOf(anchor) + anchor.length - 1,
      );
      assert.equal(
        target.kind,
        kind === 'named' ? 'element' : 'topology-selection',
      );
      assert.equal(target.evaluations.length, 4);
      assert.equal(new Set(target.evaluations.map(e => e.contextId)).size, 1);
      assert.equal(
        new Set(target.evaluations.map(e => e.constraintSourceNodeId)).size,
        2,
      );
      for (const evaluation of target.evaluations) {
        const constraint = relation.evaluations.find(
          candidate =>
            candidate.contextId === evaluation.contextId &&
            candidate.operationId === evaluation.operationId,
        );
        assert.ok(constraint);
        assert.deepEqual(evaluation.nodeIds, constraint.nodeIds);
        assert.equal(evaluation.constraintId, constraint.constraintId);
        assert.deepEqual(evaluation.operationInput, constraint.operationInput);
        assert.deepEqual(evaluation.runtime, constraint.runtime);
        const owner = isSource
          ? constraint.constraintSourceNodeId
          : constraint.nodeIds.find(
              nodeId => nodeId !== constraint.constraintSourceNodeId,
            );
        assert.deepEqual(evaluation.focusNodeIds, [owner]);
        assert.equal(sourceTargetPlacement(evaluation), 'composition');
        if (kind !== 'named') {
          assert.equal(evaluation.selection.kind, kind);
          assert.equal(evaluation.selection.inputNodeId, owner);
          assert.deepEqual(evaluation.selection.ids, [
            evaluation.toolArguments[0],
          ]);
          assert.ok(
            isSource
              ? [2, 3].includes(evaluation.toolArguments[0])
              : evaluation.toolArguments[0] === 1,
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
        new Set(target.contextTargetIds),
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
      self.edge(3).on(base.edge(1)),
      self.top.on(base.bottom),
    ]);
    export default group([base, part]);`;
  const module = await compileProject(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const at = text =>
    ModelViewport.prototype.sourceTargetAt.call(
      {module},
      '/model.ts',
      source.indexOf(text) + text.length - 1,
    );
  const edge = at('self.edge(3)').evaluations[0];
  const face = at('self.top').evaluations[0];
  assert.notEqual(edge.constraintId, face.constraintId);
  assert.equal(
    edge.constraintId,
    at('base.edge(1)').evaluations[0].constraintId,
  );
  assert.equal(
    face.constraintId,
    at('base.bottom').evaluations[0].constraintId,
  );
  const alone = at('base.edge(2)').evaluations[0];
  assert.equal(alone.nodeIds.length, 1);
  assert.equal(alone.constraintId, undefined);
  assert.equal(alone.operationId, undefined);
  assert.equal(sourceTargetPlacement(alone), 'standalone');
  assert.deepEqual(at('base.edge(2)').contextTargetIds, []);
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
  assert.deepEqual(call.tool.signature.parameters[0].constraints, {
    min: 1,
    max: 100,
  });
  assert.equal(call.tool.signature.parameters[0].label, 'Width');
  const usage = call.evaluations[0].parameters.find(
    parameter => parameter.operation === 'plate',
  );
  assert.equal(usage.target.kind, 'length');
  assert.equal(usage.target.label, 'Size');
  assert.equal(usage.target.value, 40);
  assert.equal(usage.value, 80);
  assert.equal(usage.sensitivity, 2);
  assert.equal(
    source.slice(usage.target.sourceRef.start, usage.target.sourceRef.end),
    '40',
  );
  assert.deepEqual(Object.keys(usage.target).sort(), [
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
  const spacingTargetId = exactTargets(
    module,
    source,
    'offset(-spacing, 0, 0)',
  )[0].evaluations[0].parameters.find(
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
]) {
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
    ]) {
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
      const operation = module.operations.get(evaluation.operationId);
      assert.equal(evaluation.operationId, output.evaluations[0].operationId);
      assert.equal(operation.kind, call.slice(0, call.indexOf('(')));
      assert.deepEqual(evaluation.nodeIds, [operation.inputs[0].nodeId]);
      assert.notEqual(evaluation.nodeIds[0], operation.outputNodeId);
      assert.deepEqual(
        module.objects.get(evaluation.nodeIds[0]).origin,
        origin,
      );
    }
  });
}

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
  assert.equal(module.objects.get(modelId)?.operation.kind, 'primitive');
  assert.ok(
    exactTargets(module, source, 'cylinder(2)').some(
      target => target.kind === 'operation-output',
    ),
  );
  const output = exactTargets(module, source, 'cylinder(2)').find(
    target => target.kind === 'operation-output',
  );
  assert.equal(output.evaluations[0].parameters[0]?.argument, 'radius');
});

test('compiles the standalone custom primitive example with direct annotations and a default argument', async () => {
  const rootPath = '/examples/custom-primitives.ts';
  const module = await compileProject({files: bundledExamples.files}, rootPath);
  assert.equal(module.diagnostic, undefined);
  assert.ok(module.exports.has('customPrimitivesExample'));
  const source = bundledExamples.files.find(
    file => file.path === rootPath,
  ).source;

  for (const [call, arguments_] of [
    ['twistKnob(10, 3, 14)', ['radius', 'shaftRadius', 'y']],
    ['twistKnob(10, 3, 8, 30)', ['radius', 'shaftRadius', 'y', 'twist']],
  ]) {
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
      evaluation.parameters.map(parameter => parameter.argument),
      arguments_,
    );
    assert.deepEqual(
      evaluation.parameters.map(parameter => parameter.target.kind),
      arguments_.map(argument => (argument === 'twist' ? 'angle' : 'length')),
    );
    assert.equal(
      evaluation.parameters.find(parameter => parameter.argument === 'twist')
        ?.value,
      arguments_.includes('twist') ? 30 : undefined,
    );
    const model = module.objects.get(evaluation.nodeIds[0]);
    assert.equal(model.operation.kind, 'primitive');
    assert.ok(model.mesh.triangles.length > 0);
  }
});

test('compiles one coil in the bundled primitives showcase without a separate coil example', async () => {
  const rootPath = '/examples/primitives.ts';
  const module = await compileProject({files: bundledExamples.files}, rootPath);
  assert.equal(module.diagnostic, undefined);
  assert.ok(module.exports.has('primitivesExample'));
  assert.ok(
    !bundledExamples.files.some(file => file.path === '/examples/coils.ts'),
  );
  const source = bundledExamples.files.find(
    file => file.path === rootPath,
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
    target?.evaluations[0].parameters.map(parameter => parameter.argument),
    ['coilRadius', 'wireRadius', 'pitch', 'turns'],
  );
  const model = module.objects.get(target.evaluations[0].nodeIds[0]);
  assert.equal(model.operation.kind, 'coil');
  assert.ok(model.mesh.triangles.length > 0);
});

test('compiles the core tube example with its own operation and editable dimensions', async () => {
  const rootPath = '/examples/primitives.ts';
  const module = await compileProject({files: bundledExamples.files}, rootPath);
  assert.equal(module.diagnostic, undefined);
  const source = bundledExamples.files.find(
    file => file.path === rootPath,
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
    target?.evaluations[0].parameters.map(parameter => parameter.argument),
    ['outerRadius', 'innerRadius', 'y'],
  );
  const model = module.objects.get(target.evaluations[0].nodeIds[0]);
  assert.equal(model.operation.kind, 'tube');
  assert.ok(model.mesh.triangles.length > 0);
});

function sharedOffsetSource() {
  return [
    'import {box, group} from "@code3d/core";',
    'const spacing = 24;',
    'const base = box(12, 4, 12);',
    'const left = box(8, 8, 8).relate(part =>',
    '  part.center.on(base.center).offset(-spacing, 0, 0),',
    ');',
    'const right = box(8, 8, 8).relate(part =>',
    '  part.center.on(base.center).offset(spacing, 0, 0),',
    ');',
    'export const model = group([base, left, right]);',
  ].join('\n');
}

function exactTargets(module, source, text, context = text) {
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
