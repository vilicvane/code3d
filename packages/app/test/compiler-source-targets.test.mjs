import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestProjectCompiler} from './project-test-files.mjs';

let compileProject;
let bundledExamples;
let server;
let compiler;
let replicad;
let clearKernelOperationCache;
let kernelOperationCacheStats;

before(async () => {
  server = await createAppTestServer();
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
  assert.equal(module.parameterImpacts.get(spacingTargetId), 2);
  assert.ok(
    contextNodeIds.some(nodeId =>
      module.objects
        .get(nodeId)
        ?.parameters.some(parameter => parameter.target.id === spacingTargetId),
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
