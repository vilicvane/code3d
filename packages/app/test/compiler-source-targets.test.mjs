import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
let compileProject;
let bundledExamples;
let server;

before(async () => {
  server = await createServer({
    root: appRoot,
    appType: 'custom',
    logLevel: 'error',
    server: {middlewareMode: true, hmr: false},
  });
  ({compileProject} = await server.ssrLoadModule('/src/model/compiler.ts'));
  ({bundledExamples} = await server.ssrLoadModule(
    '/src/project/bundled-examples.ts',
  ));
});

after(async () => {
  await server?.close();
});

test('retains topology values at bindings, aliases, and collection results', () => {
  const source = [
    'import {box, rectangle} from "@code3d/core";',
    'const plate = box(50, 4, 30);',
    'let screwPoints = rectangle(40, 20).relate(plane => plane.on(plate.top)).vertices();',
    'const alias = screwPoints;',
    'const subset = [screwPoints[0], screwPoints[2]];',
    'const repeated = [plate, plate];',
  ].join('\n');
  const module = compileProject(
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

test('represents an offset call with its constraint target', () => {
  const source = sharedOffsetSource();
  const module = compileProject(
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

test('retains shared-parameter peers in a group input context', () => {
  const source = sharedOffsetSource();
  const module = compileProject(
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

test('evaluates a user-defined Replicad primitive', () => {
  const source = [
    'import {definePrimitive, replicad} from "@code3d/core/replicad";',
    '/** @code3d.param radius {kind: "length"} */',
    'const cylinder = definePrimitive((radius: number) =>',
    '  replicad.makeCylinder(radius, 4),',
    ');',
    'export const model = cylinder(2);',
  ].join('\n');
  const module = compileProject(
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

test('compiles the standalone custom primitive example with direct annotations and a default argument', () => {
  const rootPath = '/examples/custom-primitives.ts';
  const module = compileProject({files: bundledExamples.files}, rootPath);
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

test('compiles one coil in the bundled primitives showcase without a separate coil example', () => {
  const rootPath = '/examples/primitives.ts';
  const module = compileProject({files: bundledExamples.files}, rootPath);
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

test('compiles the core tube example with its own operation and editable dimensions', () => {
  const rootPath = '/examples/primitives.ts';
  const module = compileProject({files: bundledExamples.files}, rootPath);
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
