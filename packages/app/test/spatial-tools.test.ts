import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {Matrix4, Object3D, Quaternion, Vector3} from 'three';
import {defined} from '../../../test/assert.ts';
import type {ToolHost} from '../src/tools/tool-system.ts';
import type {ViewportDecoration} from '../src/viewport-decoration.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>,
  compiler: Awaited<ReturnType<typeof createTestModelPipeline>>,
  spatialBindings: (typeof import('../src/tools/model-spatial-tool.ts'))['spatialBindings'],
  spatialIntent: (typeof import('../src/tools/model-spatial-tool.ts'))['spatialIntent'],
  ToolEngine: (typeof import('../src/tools/tool-system.ts'))['ToolEngine'],
  offsetExpression: (typeof import('../src/tools/source-expression.ts'))['offsetExpression'];
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
  ({spatialBindings, spatialIntent} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts'));
  ({ToolEngine} = await server.ssrLoadModule<
    typeof import('../src/tools/tool-system.ts')
  >('/src/tools/tool-system.ts'));
  ({offsetExpression} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts'));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((x, i) =>
    assert.ok(Math.abs(x - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );

async function placementTools(
  source: string,
  needle: string,
  name?: string,
  activate?: import('../src/tools/transform-gizmo.ts').SpatialTool,
) {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const at = source.indexOf(needle);
  let target = module.sourceTargets.find(target =>
    name
      ? ['transformation', 'constraint'].includes(target.kind) &&
        target.tool?.signature.name === name &&
        target.sourceRef.start <= at &&
        target.sourceRef.end >= at + needle.length
      : target.kind === 'value' && target.sourceRef.start === at,
  );
  assert.ok(
    target,
    JSON.stringify(
      module.sourceTargets
        .filter(
          target => target.sourceRef.start <= at && target.sourceRef.end >= at,
        )
        .map(target => ({
          kind: target.kind,
          source: source.slice(target.sourceRef.start, target.sourceRef.end),
          evaluations: target.evaluations.map(value => ({
            owner: value.relationOwnerNodeId,
            constraint: value.constraintId,
          })),
        })),
    ),
  );
  if (activate) {
    const {contextualToolActivation} = await server.ssrLoadModule<
      typeof import('../src/tools/contextual-tool-context.ts')
    >('/src/tools/contextual-tool-context.ts');
    const ref = defined(
      contextualToolActivation(
        module,
        {target, evaluation: target.evaluations[0]},
        activate,
      ),
    );
    target = defined(
      module.sourceTargets.find(
        candidate =>
          candidate.sourceRef.file === ref.file &&
          candidate.sourceRef.start === ref.start &&
          candidate.sourceRef.end === ref.end,
      ),
    );
    if (target.rotationToolId)
      target = defined(
        module.sourceTargets.find(
          candidate => candidate.id === target!.rotationToolId,
        ),
      );
  }
  const evaluations = [
    ...new Map(
      target.evaluations.map(value => [value.relationOwnerNodeId, value]),
    ).values(),
  ];
  const occurrences = evaluations.map((evaluation, index) => ({
    key: `part/${index}`,
    placement: 'composition' as const,
    node: {
      ...defined(module.objects.get(defined(evaluation.relationOwnerNodeId))),
      ...evaluation.relationPreview,
    },
  }));
  const {relationBindings} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts');
  const bindings = relationBindings(
    module,
    occurrences[0],
    occurrences,
    evaluations[0].constraintId ?? null,
    new Map(),
    new Map(),
    {target, evaluation: evaluations[0]},
  );
  return {module, target, occurrences, bindings};
}

for (const mode of ['translate', 'rotate'] as const) {
  test(`a shared multi-constraint self inserts independent ${mode} for every loop instance`, async () => {
    const source = `import {box, group} from '@code3d/core';
const holes = [[-10,-10], [10,-10], [-10,10], [10,10]].map(([x,z]) => box(8, 4, 8).originOffset(-x,0,-z));
const parts = holes.map(hole => box(2,2,2).relate(part => [part.axis.align(hole.axis), part.on(hole.up)]));
export default group([...holes, ...parts]);`;
    const built = await placementTools(source, 'part.axis');
    assert.equal(built.occurrences.length, 4);
    assert.equal(built.bindings.length, 6);
    const binding = defined(
      built.bindings.find(
        value =>
          value.kind === 'spatial' &&
          value.mode === mode &&
          value.axis === (mode === 'rotate' ? 'z' : 'x'),
      ),
    );
    assert.ok(binding.kind === 'spatial');
    const intent = spatialIntent(binding, mode === 'rotate' ? 30 : 5);
    assert.equal(intent.preview.objects.length, 4);
    const host = hostFor(source);
    const engine = new ToolEngine(host.host);
    const gesture = engine.begin('placement');
    assert.equal(gesture.preview(intent).status, 'ready');
    gesture.cancel();
    assert.equal(host.source(), source);
    assert.equal(engine.begin('placement').commit(intent).status, 'committed');
    assert.match(
      host.source(),
      mode === 'rotate'
        ? /part\.on\(hole\.up\), rotate\(0, 0, 30\)/
        : /part\.on\(hole\.up\), offset\(5, 0, 0\)/,
    );
    const next = await placementTools(host.source(), 'part.axis');
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    built.occurrences.forEach((occurrence, i) => {
      const predicted = composeTransforms(
        occurrence.node.compositionTransform,
        intent.preview.objects[i].transform,
      );
      near(
        predicted.position,
        next.occurrences[i].node.compositionTransform.position,
      );
      near(
        predicted.quaternion,
        next.occurrences[i].node.compositionTransform.quaternion,
      );
    });
  });
}

test('self edits the nearest independent call without crossing the next constraint segment', async () => {
  const source = `import {box, group, offset, rotate} from '@code3d/core';
const base = box(20,4,20);
const result = box(2,2,2).relate(part => [part.axis.align(base.axis), part.on(base.up), offset(2,0,0), rotate(0,0,20), offset(7,0,0), part.on(base.up), offset(100,0,0)]);
export default group([base,result]);`;
  const built = await placementTools(
    source,
    'part.axis',
    undefined,
    'translate',
  );
  const binding = defined(
    built.bindings.find(
      value =>
        value.kind === 'spatial' &&
        value.mode === 'translate' &&
        value.axis === 'x',
    ),
  );
  assert.ok(binding.kind === 'spatial');
  const host = hostFor(source);
  const intent = spatialIntent(binding, 5);
  assert.equal(
    new ToolEngine(host.host).begin('nearest').commit(intent).status,
    'committed',
  );
  assert.match(
    host.source(),
    /offset\(5,0,0\), rotate\(0,0,20\), offset\(7,0,0\)/,
  );
  assert.match(host.source(), /offset\(100,0,0\)/);
  const next = await placementTools(
    host.source(),
    'part.axis',
    undefined,
    'translate',
  );
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  near(
    composeTransforms(
      built.occurrences[0].node.compositionTransform,
      intent.preview.objects[0].transform,
    ).position,
    next.occurrences[0].node.compositionTransform.position,
  );
});

for (const [chain, selected, mode, expected] of [
  [
    'offset(2,3,4), rotate(10,20,30)',
    'offset(2,3,4)',
    'translate',
    'offset(7,3,4), rotate(10,20,30)',
  ],
  [
    'offset(2,3,4), rotate(10,20,30)',
    'offset(2,3,4)',
    'rotate',
    'offset(2,3,4), rotate(15,20,30)',
  ],
  [
    'rotate(10,20,30), offset(2,3,4)',
    'rotate(10,20,30)',
    'translate',
    'rotate(10,20,30), offset(7,3,4)',
  ],
  [
    'pivot([2,3,4]).rotate(10,20,30), offset(2,3,4)',
    'rotate(10,20,30)',
    'rotate',
    'pivot([2,3,4]).rotate(15,20,30), offset(2,3,4)',
  ],
  [
    'aroundLine(base.axis).rotate(30), offset(2,3,4)',
    'rotate(30)',
    'rotate',
    'aroundLine(base.axis).rotate(35), offset(2,3,4)',
  ],
] as const) {
  test(`independent selection ${selected} / ${mode} preserves its chain stage`, async () => {
    const source = `import {box, group, offset, rotate, pivot, aroundLine} from '@code3d/core';
const base = box(20,4,20);
const result = box(2,2,2).relate(part => [part.axis.align(base.axis), part.on(base.up), ${chain}]);
export default group([base,result]);`;
    const name = selected.startsWith('offset') ? 'offset' : 'rotate';
    const built = await placementTools(
      source,
      selected,
      name,
      mode === 'translate'
        ? 'translate'
        : selected === 'rotate(30)'
          ? 'rotate-axis'
          : 'rotate-point',
    );
    const binding = defined(
      built.bindings.find(
        value => value.kind === 'spatial' && value.mode === mode,
      ),
    );
    assert.ok(binding.kind === 'spatial');
    const host = hostFor(source);
    const intent = spatialIntent(binding, binding.value + 5);
    assert.equal(
      new ToolEngine(host.host).begin('selected').commit(intent).status,
      'committed',
    );
    assert.ok(host.source().includes(expected), host.source());
    const next = await placementTools(host.source(), 'part.axis');
    // A selected operation previews its own prefix; compare with that same prefix
    // after the edit, rather than the later authored operations.
    const editedName = mode === 'translate' ? 'offset' : 'rotate';
    const editedCall = defined(
      expected.match(new RegExp(editedName + '\\([^)]*\\)')),
    )[0];
    const edited = await placementTools(host.source(), editedCall, editedName);
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    assert.equal(next.module.diagnostic, undefined);
    const predicted = composeTransforms(
      built.occurrences[0].node.compositionTransform,
      intent.preview.objects[0].transform,
    );
    near(
      predicted.position,
      edited.occurrences[0].node.compositionTransform.position,
    );
    near(
      predicted.quaternion,
      edited.occurrences[0].node.compositionTransform.quaternion,
    );
  });
}

for (const relation of [
  'offset(2,3,4)',
  '[part.axis.align(base.axis),part.on(base.up),offset(2,3,4)]',
]) {
  test(`independent tools follow material-derived members: ${relation}`, async () => {
    const source = `import {box, offset} from '@code3d/core'; const base=box(20,4,20); export default box(2,2,2).relate(part=>${relation}).material('#d8ff3e');`;
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const occurrence = {
      key: 'part/0',
      placement: 'composition' as const,
      node: defined(module.fallback),
    };
    const {relationBindings} = await server.ssrLoadModule<
      typeof import('../src/tools/model-spatial-tool.ts')
    >('/src/tools/model-spatial-tool.ts');
    const bindings = relationBindings(
      module,
      occurrence,
      [occurrence],
      null,
      new Map(),
      new Map(),
    );
    assert.equal(bindings.length, 6);
    for (const mode of ['translate', 'rotate']) {
      const binding = defined(
        bindings.find(value => value.kind === 'spatial' && value.mode === mode),
      );
      assert.ok(binding.kind === 'spatial');
      const host = hostFor(source);
      const intent = spatialIntent(binding, binding.value + 5);
      assert.equal(
        new ToolEngine(host.host).begin('derived').commit(intent).status,
        'committed',
      );
      const next = await compiler.compile(
        {files: [{path: '/model.ts', source: host.source()}]},
        '/model.ts',
      );
      assert.equal(next.diagnostic, undefined);
      const {composeTransforms} =
        await import('../../core/bld/tooling/index.js');
      const predicted = composeTransforms(
        occurrence.node.compositionTransform,
        intent.preview.objects[0].transform,
      );
      near(
        predicted.position,
        defined(next.fallback).compositionTransform.position,
      );
      near(
        predicted.quaternion,
        defined(next.fallback).compositionTransform.quaternion,
      );
      if (mode === 'rotate' && relation === 'offset(2,3,4)')
        assert.match(
          host.source(),
          /part=>\[offset\(2,3,4\), rotate\(5, 0, 0\)\]/,
        );
    }
  });
}

test('independent pivotVertex selects the relate self topology', async () => {
  const source = `import {box, pivotVertex} from '@code3d/core'; export default box(8,6,4).relate(() => pivotVertex(3).rotate(10,20,30));`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const selection = defined(
    module.sourceTargets.find(
      target =>
        target.kind === 'topology-selection' &&
        target.tool?.signature.name === 'pivotVertex',
    ),
  );
  assert.deepEqual(defined(selection.evaluations[0].selection).ids, [3]);
  assert.equal(
    defined(selection.evaluations[0].selection).inputNodeId,
    defined(module.fallback).nodeId,
  );
});

test('independent insertion retains import comments and avoids shadowed aliases', async () => {
  const {transformationInsertion, transformationImportSource} =
    await server.ssrLoadModule<
      typeof import('../src/tools/source-expression.ts')
    >('/src/tools/source-expression.ts');
  for (const [imports, callback, name] of [
    ["import {box, offset as move} from '@code3d/core';", '(part)', 'move'],
    ["import * as c3 from '@code3d/core';", '(part)', 'c3.offset'],
    ["import {box, offset} from '@code3d/core';", '({offset})', 'code3dOffset'],
    [
      "import {box // keep this comment\n} from '@code3d/core';",
      '(part)',
      'offset',
    ],
    [
      "import {box, // keep this comma\n} from '@code3d/core';",
      '(part)',
      'offset',
    ],
  ]) {
    const expression = 'part.on(base.up)';
    const source = `${imports}\nconst apply = ${callback} => ${expression};`;
    const ref = {
      file: '/model.ts',
      start: source.indexOf(expression),
      end: source.indexOf(expression) + expression.length,
    };
    const insertion = defined(
      transformationInsertion('/model.ts', source, ref, 'offset'),
    );
    assert.equal(insertion.name, name);
    assert.equal(insertion.container, 'return');
    if (insertion.importAddition) {
      const add = insertion.importAddition;
      const updated = transformationImportSource(
        source.slice(add.sourceRef.start, add.sourceRef.end),
        add.specifier,
        add.statement,
      );
      const ts = (await import('@typescript/typescript6')).default;
      const parsed = ts.createSourceFile(
        'imports.ts',
        `import ${updated} from '@code3d/core';`,
        ts.ScriptTarget.Latest,
        true,
      );
      assert.equal(
        (parsed as unknown as {parseDiagnostics: unknown[]}).parseDiagnostics
          .length,
        0,
        updated,
      );
      if (imports.includes('// keep')) assert.ok(updated.includes('// keep'));
    }
  }
});

test('a group axis includes its child geometry without model-unit padding', async () => {
  const source = `import {box,group,line} from '@code3d/core'; export default group([line([0,10,0],[0,20,0]), line([0,-4,0],[0,-3,0])]).expose({guide: box(1,1,1).axis});`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const node = defined(module.fallback);
  const {namedElementDecorations} = await server.ssrLoadModule<
    typeof import('../src/model/element-decorations.ts')
  >('/src/model/element-decorations.ts');
  const element = defined(
    node.elements.find(element => element.name === 'guide'),
  );
  const axis = namedElementDecorations(node, element).find(
    decoration => decoration.kind === 'anchor',
  );
  assert.ok(axis?.elementKind === 'line');
  near(
    [axis.span.negative, axis.span.positive],
    [4 + element.transform.position[1], 20 - element.transform.position[1]],
  );
});

async function build(source: string, name: string) {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const target = module.sourceTargets.find(
    target =>
      (target.tool?.signature.name === name ||
        (target.operation?.kind === name &&
          target.kind === 'operation-output')) &&
      target.evaluations[0].operationId,
  );
  assert.ok(target, `No operation scope for ${name}`);
  const evaluation = target.evaluations[0];
  const node = defined(module.objects.get(evaluation.nodeIds[0]));
  const occurrence = {key: 'source/0', node, placement: 'standalone' as const};
  const bindings = spatialBindings(
    module,
    {target, evaluation},
    occurrence,
    [occurrence],
    new Map(),
    new Map(),
  );
  return {module, target, evaluation, node, occurrence, bindings};
}

function hostFor(source: string) {
  const host: ToolHost = {
    sourceVersion: () => 1,
    resolveSourceRef: ref => ref,
    readSource: ref => source.slice(ref.start, ref.end),
    applySourceEdits: (_version, edits) => {
      for (const edit of [...edits].sort(
        (a, b) => b.sourceRef.start - a.sourceRef.start,
      )) {
        assert.equal(
          source.slice(edit.sourceRef.start, edit.sourceRef.end),
          edit.expectedText,
        );
        source =
          source.slice(0, edit.sourceRef.start) +
          edit.text +
          source.slice(edit.sourceRef.end);
      }
      return true;
    },
    applyPreview() {},
    commitPreview() {},
    clearPreview() {},
  };
  return {host, source: () => source};
}

for (const [call, operation, expected, value, axis = 'z'] of [
  ['rotate()', 'rotate', 'rotate(0, 0, 15)', 15],
  ['rotate()', 'rotate', 'rotate(15, 0, 0)', 15, 'x'],
  ['rotate()', 'rotate', 'rotate(0, 15, 0)', 15, 'y'],
  ['rotate(12, /* rest */)', 'rotate', 'rotate(15, /* rest */0, 0)', 15, 'x'],
  ['originOffset()', 'originOffset', 'originOffset(5, 0, 0)', 5, 'x'],
  ['rotate(12, /* next */)', 'rotate', 'rotate(12, /* next */0, 15)', 15],
  ['rotate(...angles)', 'rotate', 'rotate(20, 30, 15)', 15],
  ['rotate(20, 30, undefined)', 'rotate', 'rotate(20, 30, 15)', 15],
  ['originOffset()', 'originOffset', 'originOffset(0, 0, 5)', 5],
] as const) {
  test(`${call} exposes every axis and completes defaults on ${axis} commit`, async () => {
    const source = `import {box} from '@code3d/core'; const angles = [20, 30, 40] as const; box(8, 6, 4).${call};`;
    const {node, bindings} = await build(source, operation);
    assert.equal(bindings.length, 3);
    const binding = defined(bindings.find(binding => binding.axis === axis));
    const host = hostFor(source);
    const engine = new ToolEngine(host.host);
    const intent = spatialIntent(binding, value);
    const session = engine.begin('default-axis');
    assert.equal(session.preview(intent).status, 'ready');
    assert.equal(host.source(), source);
    session.cancel();
    assert.equal(host.source(), source);
    const unchanged = engine.resolve(
      'unchanged',
      spatialIntent(binding, binding.value),
    );
    assert.equal(unchanged.status, 'ready');
    if (unchanged.status === 'ready')
      assert.ok(
        unchanged.plan.edits.every(edit => edit.text === edit.expectedText),
      );
    assert.equal(
      engine.begin('default-axis').commit(intent).status,
      'committed',
    );
    assert.equal(host.source(), source.replace(call, expected));
    const {node: next} = await build(host.source(), operation);
    const {committedSpatialObject} = await server.ssrLoadModule<
      typeof import('../src/tools/spatial-edit.ts')
    >('/src/tools/spatial-edit.ts');
    const preview = committedSpatialObject(intent.preview.objects[0]);
    const transform = new Matrix4().compose(
      new Vector3(...preview.transform.position),
      new Quaternion(...preview.transform.quaternion),
      new Vector3(1, 1, 1),
    );
    const before = defined(node.mesh).topologyVertices;
    const after = defined(next.mesh).topologyVertices;
    for (let i = 0; i < before.length; i += 3)
      near(
        new Vector3().fromArray(before, i).applyMatrix4(transform).toArray(),
        [...after.slice(i, i + 3)],
      );
  });
}

for (const call of ['rotate()', 'originOffset()']) {
  test(`group ${call} exposes all default axes`, async () => {
    const {bindings} = await build(
      `import {box, group} from '@code3d/core'; group([box(8,6,4)]).${call};`,
      call.split('(')[0],
    );
    assert.equal(bindings.length, 3);
    assert.deepEqual(
      bindings.map(binding => binding.value),
      [0, 0, 0],
    );
  });
}

for (const operation of ['rotate', 'originOffset'] as const) {
  test(`materializing ${operation} inputs previews every execution of the call`, async () => {
    const source = `import {box, group} from '@code3d/core'; function part(i: number) {const coords = [i * 2, i * 3, i * 4] as const; return box(8, 6, 4).${operation}(...coords);} group([part(1), part(2)]);`;
    const result = await build(source, operation);
    const occurrences = result.target.evaluations.map((evaluation, index) => ({
      key: `part/${index}`,
      node: defined(result.module.objects.get(evaluation.nodeIds[0])),
      placement: 'standalone' as const,
    }));
    assert.equal(occurrences.length, 2);
    const bindings = spatialBindings(
      result.module,
      result,
      occurrences[0],
      occurrences,
      new Map(),
      new Map(),
    );
    const binding = defined(bindings.find(binding => binding.axis === 'z'));
    const unchanged = spatialIntent(binding, binding.value);
    for (const preview of unchanged.preview.objects) {
      near(preview.transform.position, [0, 0, 0]);
      near(preview.transform.quaternion, [0, 0, 0, 1]);
    }
    const intent = spatialIntent(binding, 9);
    assert.equal(intent.preview.objects.length, 2);
    const host = hostFor(source);
    assert.equal(
      new ToolEngine(host.host).begin('shared-call').commit(intent).status,
      'committed',
    );
    const next = await build(host.source(), operation);
    const {committedSpatialObject} = await server.ssrLoadModule<
      typeof import('../src/tools/spatial-edit.ts')
    >('/src/tools/spatial-edit.ts');
    for (const [index, occurrence] of occurrences.entries()) {
      const preview = committedSpatialObject(intent.preview.objects[index]);
      const transform = new Matrix4().compose(
        new Vector3(...preview.transform.position),
        new Quaternion(...preview.transform.quaternion),
        new Vector3(1, 1, 1),
      );
      const before = defined(occurrence.node.mesh).topologyVertices;
      const after = defined(
        defined(
          next.module.objects.get(next.target.evaluations[index].nodeIds[0]),
        ).mesh,
      ).topologyVertices;
      for (let i = 0; i < before.length; i += 3)
        near(
          new Vector3().fromArray(before, i).applyMatrix4(transform).toArray(),
          [...after.slice(i, i + 3)],
        );
    }
  });
}

test('incomplete relation offsets fill their existing call and preserve expressions', async () => {
  const {offsetCallSource} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts');
  assert.equal(
    offsetCallSource('self.on(base.up).offset()', 'offset', [0, 0, 5]),
    'self.on(base.up).offset(0, 0, 5)',
  );
  assert.equal(
    offsetCallSource(
      'self.on(base.up).offset(size, /* next */)',
      'offset',
      [0, 2, 0],
    ),
    'self.on(base.up).offset(size, /* next */2, 0)',
  );
  assert.equal(
    offsetCallSource('self.on(base.up).offset()', 'offset', [0, 0, 0]),
    'self.on(base.up).offset()',
  );
});

test('originCenter without parameters displays its center and drags by appending an offset', async () => {
  const source =
    'import {box} from "@code3d/core"; const part = box(8, 6, 4).originVertex(3).rotate(0, 0, 90).originCenter();';
  const {node, target, evaluation, bindings, module} = await build(
    source,
    'originCenter',
  );
  assert.equal(target.tool, undefined);
  assert.ok(target.kind === 'operation-output');
  assert.equal(
    source.slice(target.sourceRef.start, target.sourceRef.end),
    'originCenter()',
  );
  assert.equal(bindings.length, 3);
  near(
    bindings[0].frame.position,
    defined(defined(node).elements.find(e => e.name === 'center')).transform
      .position,
  );
  const {originSourceDecoration} = await server.ssrLoadModule<
    typeof import('../src/model/origin-decorations.ts')
  >('/src/model/origin-decorations.ts');
  near(
    anchorDecoration(
      originSourceDecoration.decorations({module, target, evaluation})[0],
    ).transform.position,
    defined(node).origin,
  );
  const intent = spatialIntent(bindings[0], 2);
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('center');
  assert.ok(session.preview(intent).status === 'ready');
  assert.equal(host.source(), source);
  assert.ok(session.commit(intent).status === 'committed');
  assert.match(host.source(), /originCenter\(\)\.originOffset\(2, 0, 0\)/);
  const {node: next} = await build(host.source(), 'originOffset');
  near(defined(next).origin, [0, 0, 0]);
  near(
    [...defined(defined(next).mesh).topologyVertices],
    [...defined(defined(node).mesh).topologyVertices].map(
      (v, i) => v - (i % 3 === 0 ? 2 : 0),
    ),
  );
});

test('originVertex exposes the output origin and retains its input for vertex selection', async () => {
  const source =
    'import {box} from "@code3d/core"; const part = box(8, 6, 4).originVertex(3);';
  const {node, target, evaluation, bindings} = await build(
    source,
    'originVertex',
  );
  assert.ok(target.kind === 'topology-selection');
  assert.notEqual(
    defined(evaluation.selection).inputNodeId,
    defined(node).nodeId,
  );
  assert.deepEqual(defined(evaluation.selection).ids, [3]);
  assert.equal(bindings.length, 3);
  near(bindings[0].frame.position, defined(node).origin);
  const intent = spatialIntent(bindings[0], 2);
  const host = hostFor(source);
  const result = new ToolEngine(host.host).begin('origin-test').commit(intent);
  assert.ok(result.status === 'committed');
  assert.match(host.source(), /originVertex\(3\)\.originOffset\(2, 0, 0\)/);
  near(intent.preview.objects[0].spatial.origin, [
    defined(node).origin[0] + 2,
    defined(node).origin[1],
    defined(node).origin[2],
  ]);
});

test('originVertex candidates map from input topology to the displayed result after earlier transforms', async () => {
  for (const prefix of [
    '',
    '.originOffset(5, -2, 3).rotate(15, 35, 10).scaled(2)',
  ]) {
    for (const id of [3, 6]) {
      const {module, node, evaluation} = await build(
        `import {box} from '@code3d/core'; box(8, 6, 4)${prefix}.originVertex(${id});`,
        'originVertex',
      );
      const selection = defined(evaluation.selection);
      const scope = defined(selection.scope);
      assert.equal(scope.geometryNodeId, selection.inputNodeId);
      const input = defined(
        defined(module.objects.get(scope.geometryNodeId)).mesh,
      );
      const output = defined(node.mesh);
      assert.deepEqual(scope.availableIds, input.vertexIds);
      assert.deepEqual(output.vertexIds, input.vertexIds);
      const transform = new Matrix4().compose(
        new Vector3(...scope.transform.position),
        new Quaternion(...scope.transform.quaternion),
        new Vector3(...scope.transform.scale),
      );
      input.vertexIds.forEach((vertexId, i) => {
        const candidate = new Vector3()
          .fromArray(input.topologyVertices, i * 3)
          .applyMatrix4(transform);
        const actual = new Vector3().fromArray(output.topologyVertices, i * 3);
        assert.ok(
          candidate.distanceTo(actual) < 1e-5,
          `V${vertexId} must stay on the output geometry`,
        );
        if (vertexId === id) near(actual.toArray(), [0, 0, 0]);
      });
    }
  }
});

for (const call of ['rotate(angle, 35, 10)', 'rotate(angle /* angle */)']) {
  test(`${call} edits the upstream angle, completes defaults and matches recomputed B-Rep vertices`, async () => {
    const source = `import {box} from "@code3d/core"; const angle = 25; const part = box(8, 6, 4).originOffset(1, 2, 3).${call};`;
    const {node, bindings} = await build(source, 'rotate');
    const binding = bindings.find(binding => binding.axis === 'x');
    assert.ok(defined(binding).spatial.source.kind === 'parameter');
    const intent = spatialIntent(defined(binding), 55);
    const host = hostFor(source);
    const engine = new ToolEngine(host.host);
    const session = engine.begin('rotation-test');
    assert.ok(session.preview(intent).status === 'ready');
    assert.equal(host.source(), source);
    assert.ok(session.commit(intent).status === 'committed');
    assert.equal(
      host.source(),
      source
        .replace('const angle = 25', 'const angle = 55')
        .replace(
          'rotate(angle /* angle */)',
          'rotate(angle /* angle */, 0, 0)',
        ),
    );
    const {node: next} = await build(host.source(), 'rotate');
    const {rotateVector} = await import('../../core/bld/tooling/index.js');
    const transform = intent.preview.objects[0].transform;
    const before = defined(defined(node).mesh).topologyVertices;
    const after = defined(defined(next).mesh).topologyVertices;
    for (let i = 0; i < before.length; i += 3) {
      const rotated = rotateVector(
        [before[i], before[i + 1], before[i + 2]],
        transform.quaternion,
      ).map((x, axis) => x + transform.position[axis]);
      near(rotated, [...after.slice(i, i + 3)]);
    }
  });
}

test('shared size and angle parameters keep the size expression while editing this angle', async () => {
  const source =
    'import {box} from "@code3d/core"; const size = 8; box(size, 6, 4).rotate(size, 35, 10);';
  const {bindings} = await build(source, 'rotate');
  const binding = bindings[0];
  assert.ok(binding.spatial.source.kind === 'argument');
  const host = hostFor(source);
  const result = new ToolEngine(host.host)
    .begin('angle')
    .commit(spatialIntent(binding, 18));
  assert.ok(result.status === 'committed');
  assert.match(host.source(), /const size = 8/);
  assert.match(host.source(), /rotate\(size \+ 10, 35, 10\)/);
});

test('group rotation tools preview the same assembly poses as committed XYZ angle edits', async () => {
  const source = `import {box, group} from '@code3d/core';
const base = box(10, 10, 10);
const cap = box(2, 2, 2).relate(self => self.on(base.up));
const angle = 25;
export default group([base, cap]).originPoint(cap.center).rotate(angle, 35, 10);`;
  const {node, bindings} = await build(source, 'rotate');
  assert.equal(bindings.length, 3);
  const binding = defined(bindings.find(binding => binding.axis === 'x'));
  assert.equal(binding.spatial.source.kind, 'parameter');
  const intent = spatialIntent(binding, 55);
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('group-rotation');
  assert.equal(session.preview(intent).status, 'ready');
  assert.equal(host.source(), source);
  assert.equal(session.commit(intent).status, 'committed');
  assert.match(host.source(), /const angle = 55/);
  const {node: next} = await build(host.source(), 'rotate');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  for (let i = 0; i < node.children.length; i++) {
    const expected = composeTransforms(
      intent.preview.objects[0].transform,
      node.children[i].transform,
    );
    near(next.children[i].transform.position, expected.position);
    near(next.children[i].transform.quaternion, expected.quaternion);
    assert.deepEqual(next.children[i].mesh, node.children[i].mesh);
  }
  near(next.origin, [0, 0, 0]);
});

test('originOffset drag accumulates on the selected offset and cancel preserves source', async () => {
  const source =
    'import {box} from "@code3d/core"; box(8, 6, 4).originVertex(3).originOffset(4, 0, 0);';
  const {node, bindings} = await build(source, 'originOffset');
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('offset');
  const intent = spatialIntent(bindings[0], 7);
  near(intent.preview.objects[0].spatial.origin, [3, 0, 0]);
  session.preview(intent);
  session.cancel();
  assert.equal(host.source(), source);
  near(defined(node).origin, [0, 0, 0]);
});

test('numeric adjustment folds repeated deltas while preserving expressions', () => {
  assert.equal(offsetExpression('2', 3), '5');
  assert.equal(offsetExpression('Math.sin(t)', 3), 'Math.sin(t) + 3');
  assert.equal(offsetExpression('Math.sin(t) + 3', 4), 'Math.sin(t) + 7');
  assert.equal(offsetExpression('size - 5', 5), 'size');
  assert.equal(offsetExpression('size * 2', -3), 'size * 2 - 3');
});

test('origin offset editing reuses the outer call and retains authored comments', async () => {
  const {offsetCallSource} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts');
  const source = 'originCenter().originOffset(/* x */ (size + 2), 0, 0)';
  const changed = offsetCallSource(source, 'originOffset', [2, 0, 0]);
  assert.equal(
    changed,
    'originCenter().originOffset(/* x */ (size + 4), 0, 0)',
  );
  assert.equal(
    offsetCallSource(changed, 'originOffset', [-4, 0, 0]),
    'originCenter().originOffset(/* x */ (size), 0, 0)',
  );
});

async function relationTool(source: string, name: string) {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined, JSON.stringify(module.diagnostic));
  const target = module.sourceTargets.find(
    target =>
      target.kind === 'constraint' &&
      (target.tool?.signature.name === name ||
        target.evaluations[0].relationSpatial?.kind === name) &&
      target.evaluations[0].relationSpatial,
  );
  assert.ok(target, `No relation tool for ${name}`);
  const evaluation = target.evaluations[0];
  const node = {
    ...defined(module.objects.get(defined(evaluation.relationSpatial).nodeId)),
    ...evaluation.relationPreview,
  };
  const occurrence = {
    key: 'source/self',
    node,
    placement: 'composition' as const,
  };
  const bindings = spatialBindings(
    module,
    {target, evaluation},
    occurrence,
    [occurrence],
    new Map(),
    new Map(),
  );
  return {module, target, evaluation, node, bindings};
}

for (const [chain, name, expected, axis = 'z'] of [
  [
    'pivot().rotate(25, 35, 10)',
    'pivot',
    'pivot([0, 0, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot([2]).rotate(25, 35, 10)',
    'pivot',
    'pivot([2, 0, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot(coords).rotate(25, 35, 10)',
    'pivot',
    'pivot([2, 3, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot([...coords]).rotate(25, 35, 10)',
    'pivot',
    'pivot([2, 3, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot(undefined).rotate(25, 35, 10)',
    'pivot',
    'pivot([0, 0, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot().rotate(25, 35, 10)',
    'pivot',
    'pivot([7, 0, 0]).rotate(25, 35, 10)',
    'x',
  ],
  [
    'pivot([2, /* rest */]).rotate(25, 35, 10)',
    'pivot',
    'pivot([7, /* rest */0, 0]).rotate(25, 35, 10)',
    'x',
  ],
  [
    'pivot([, 2]).rotate(25, 35, 10)',
    'pivot',
    'pivot([0, 7, 0]).rotate(25, 35, 10)',
    'y',
  ],
  ['rotate()', 'rotate', 'rotate(7, 0, 0)', 'x'],
  ['rotate()', 'rotate', 'rotate(0, 0, 7)'],
  [
    'aroundLine(base.axis).rotate()',
    'rotate',
    'aroundLine(base.axis).rotate(7)',
  ],
] as const) {
  test(`relation ${chain} provides ${axis} tools from its rendered pose`, async () => {
    const source = `import {box} from '@code3d/core'; const coords = [2, 3, 4] as const; const base = box(20, 10, 30); box(8, 6, 4).relate(self => self.on(base.up).${chain});`;
    const {node, bindings} = await relationTool(source, name);
    assert.equal(bindings.length, chain.startsWith('aroundLine') ? 1 : 3);
    const binding = defined(
      bindings.find(
        binding =>
          binding.axis === (chain.startsWith('aroundLine') ? 'y' : axis),
      ),
    );
    const intent = spatialIntent(binding, 7);
    const host = hostFor(source);
    const engine = new ToolEngine(host.host);
    const session = engine.begin('rendered-pivot');
    assert.equal(session.preview(intent).status, 'ready');
    session.cancel();
    assert.equal(host.source(), source);
    assert.equal(
      engine.begin('rendered-pivot').commit(intent).status,
      'committed',
    );
    assert.equal(host.source(), source.replace(chain, expected));
    const {node: next} = await relationTool(host.source(), name);
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    const preview = composeTransforms(
      node.compositionTransform,
      intent.preview.objects[0].transform,
    );
    near(preview.position, next.compositionTransform.position);
    near(preview.quaternion, next.compositionTransform.quaternion);
  });
}

for (const reverse of [false, true] as const) {
  test(`relation rotation previews and edits self with ${reverse ? 'reversed' : 'forward'} on syntax`, async () => {
    const source = `import {box} from '@code3d/core'; const angle = 25; const base = box(20, 10, 30); const part = box(8, 6, 4).relate(self => ${reverse ? 'base.on(self.up)' : 'self.on(base.up)'}.pivot([1, 2, 3]).rotate(angle, 35, 10));`;
    const {node, bindings, evaluation} = await relationTool(source, 'rotate');
    assert.equal(bindings.length, 3);
    assert.equal(evaluation.relationOwnerNodeId, defined(node).nodeId);
    const binding = bindings[0];
    assert.ok(binding.spatial.source.kind === 'parameter');
    const intent = spatialIntent(binding, 55);
    const host = hostFor(source);
    const session = new ToolEngine(host.host).begin('relation-rotate');
    assert.ok(session.preview(intent).status === 'ready');
    session.cancel();
    assert.equal(host.source(), source);
    assert.equal(
      new ToolEngine(host.host).begin('relation-rotate').commit(intent).status,
      'committed',
    );
    const {node: next} = await relationTool(host.source(), 'rotate');
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    const preview = composeTransforms(
      defined(node).compositionTransform,
      intent.preview.objects[0].transform,
    );
    near(preview.position, defined(next).compositionTransform.position);
    near(preview.quaternion, defined(next).compositionTransform.quaternion);
    assert.deepEqual(
      defined(defined(node).mesh).topologyVertices,
      defined(defined(next).mesh).topologyVertices,
    );
  });
}

test('pivot coordinates have an independent drag and preserve the local frame', async () => {
  const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const part = box(8, 6, 4).originOffset(1, 2, 3).rotate(10, 20, 30).relate(self => self.on(base.up).pivot([5, 0, 0]).rotate(25, 35, 10));`;
  const {node, bindings} = await relationTool(source, 'pivot');
  assert.equal(bindings.length, 3);
  const intent = spatialIntent(bindings[0], 8);
  const host = hostFor(source);
  assert.equal(
    new ToolEngine(host.host).begin('pivot').commit(intent).status,
    'committed',
  );
  assert.match(host.source(), /pivot\(\[8, 0, 0\]\)/);
  const {node: next} = await relationTool(host.source(), 'pivot');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  const preview = composeTransforms(
    defined(node).compositionTransform,
    intent.preview.objects[0].transform,
  );
  near(preview.position, defined(next).compositionTransform.position);
  near(preview.quaternion, defined(next).compositionTransform.quaternion);
});

for (const [geometry, id] of [
  ['box(8, 6, 4)', 3],
  ['box(8, 6, 4).shell(1)', [1, 3]],
] as const) {
  test(`pivotVertex selects self topology ${JSON.stringify(id)} when self is the target of on`, async () => {
    const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const part = ${geometry}.relate(self => base.on(self.up).pivotVertex(${JSON.stringify(id)}).rotate(0, 0, 45));`;
    const {module, node, target, evaluation, bindings} = await relationTool(
      source,
      'pivotVertex',
    );
    assert.equal(bindings.length, 0);
    const selection = module.sourceTargets.find(
      target =>
        target.kind === 'topology-selection' &&
        target.tool?.signature.name === 'pivotVertex',
    );
    assert.equal(
      defined(defined(selection).evaluations[0].selection).inputNodeId,
      defined(node).nodeId,
    );
    assert.deepEqual(defined(defined(selection).evaluations[0].selection).ids, [
      id,
    ]);
    const {originSourceDecoration} = await server.ssrLoadModule<
      typeof import('../src/model/origin-decorations.ts')
    >('/src/model/origin-decorations.ts');
    const markers = originSourceDecoration.decorations({
      module,
      target,
      evaluation,
    });
    assert.equal(anchorDecoration(markers[0]).elementKind, 'point');
  });
}

test('around exposes a positioned axis and a single angle ring', async () => {
  const source = `import {box, point} from '@code3d/core'; const base = box(20, 10, 30); const axis = box(2, 2, 2).relate(self => self.center.on(point([10, 20, 30]).up).offset(0, 0, 0)); const part = box(8, 6, 4).relate(self => self.on(base.up).aroundLine(axis.axis).rotate(25).pivot([2, 3, 4]).rotate(10, 20, 30).offset(7, 0, 0));`;
  const {node, bindings} = await relationTool(source, 'rotate');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].axis, 'y');
  const intent = spatialIntent(bindings[0], 55);
  const host = hostFor(source);
  new ToolEngine(host.host).begin('aroundLine').commit(intent);
  assert.match(host.source(), /\.rotate\(55\)/);
  const {node: next} = await relationTool(host.source(), 'rotate');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  const preview = composeTransforms(
    defined(node).compositionTransform,
    intent.preview.objects[0].transform,
  );
  near(preview.position, defined(next).compositionTransform.position);
  near(preview.quaternion, defined(next).compositionTransform.quaternion);
  const {
    module,
    target,
    evaluation,
    bindings: axisBindings,
  } = await relationTool(source, 'aroundLine');
  assert.equal(axisBindings.length, 0);
  const {originSourceDecoration} = await server.ssrLoadModule<
    typeof import('../src/model/origin-decorations.ts')
  >('/src/model/origin-decorations.ts');
  assert.equal(
    anchorDecoration(
      originSourceDecoration.decorations({module, target, evaluation})[0],
    ).elementKind,
    'line',
  );
});

for (const reverse of [false, true] as const) {
  test(`align rotation edits self and preserves preview consistency with ${reverse ? 'reversed' : 'forward'} source`, async () => {
    const source = `import {box, point} from '@code3d/core'; const base = point([20, 10, 30]); const part = box(8, 6, 4).relate(self => ${reverse ? 'base.align(self.center)' : 'self.center.align(base)'}.offset(2, 3, 4).pivot([1, 2, 3]).rotate(25, 35, 10).aroundLine(box(1, 1, 1).axis).rotate(45).offset(7, 0, 0));`;
    const {node, bindings} = await relationTool(source, 'rotate');
    const intent = spatialIntent(bindings[0], 55),
      host = hostFor(source);
    const cancelled = new ToolEngine(host.host).begin('align-rotate');
    cancelled.preview(intent);
    cancelled.cancel();
    assert.equal(host.source(), source);
    new ToolEngine(host.host).begin('align-rotate').commit(intent);
    const {node: next} = await relationTool(host.source(), 'rotate');
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    const preview = composeTransforms(
      defined(node).compositionTransform,
      intent.preview.objects[0].transform,
    );
    near(preview.position, defined(next).compositionTransform.position);
    near(preview.quaternion, defined(next).compositionTransform.quaternion);
  });
}

test('a reversed around axis previews the authored signed angle', async () => {
  const source = `import {box, point} from '@code3d/core'; const base=point([20,10,30]); const axis=box(1,1,1).axis.reverse(); const part=box(8,6,4).relate(self=>self.center.align(base).aroundLine(axis).rotate(25));`;
  const {node, bindings} = await relationTool(source, 'rotate');
  assert.equal(bindings.length, 1);
  const intent = spatialIntent(bindings[0], 55),
    host = hostFor(source);
  new ToolEngine(host.host).begin('reverse-axis').commit(intent);
  const {node: next} = await relationTool(host.source(), 'rotate');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  const preview = composeTransforms(
    defined(node).compositionTransform,
    intent.preview.objects[0].transform,
  );
  near(preview.position, defined(next).compositionTransform.position);
  near(preview.quaternion, defined(next).compositionTransform.quaternion);
});

test('a bound selection renders each computed plane once across named and relation previews', async () => {
  const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const part = box(8, 6, 4).rotate(0, 0, 30).relate(self => self.on(base.up));`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const target = module.sourceTargets.find(
    target =>
      target.kind === 'element' &&
      source.slice(target.sourceRef.start, target.sourceRef.end) === 'up',
  );
  assert.ok(defined(defined(target).evaluations[0].element).bound);
  const {elementSourceDecoration, relationSourceDecoration} =
    await server.ssrLoadModule<
      typeof import('../src/model/element-decorations.ts')
    >('/src/model/element-decorations.ts');
  assert.ok(target);
  const scope = {module, target, evaluation: defined(target).evaluations[0]};
  const named = elementSourceDecoration.decorations(scope);
  assert.equal(named.length, 0);
  const contacts = relationSourceDecoration.decorations(scope);
  const targetMesh = contacts.find(
    decoration =>
      decoration.kind === 'surface' && decoration.id.includes(':target:'),
  );
  assert.ok(targetMesh?.kind === 'surface');
  assert.equal(targetMesh.mesh.vertices.length, 12);
  assert.deepEqual(targetMesh.mesh.surfaceGroups, []);
  const combined = [...named, ...contacts];
  assert.equal(new Set(combined.map(item => item.id)).size, combined.length);
  assert.equal(
    combined.filter(decoration => decoration.kind === 'surface').length,
    2,
  );
  const relationTarget = module.sourceTargets.find(
    target =>
      target.kind === 'constraint' && target.evaluations[0].constraintId,
  );
  const relation = relationSourceDecoration.decorations({
    module,
    target: defined(relationTarget),
    evaluation: defined(relationTarget).evaluations[0],
  });
  assert.equal(relation.filter(item => item.kind === 'surface').length, 2);
  const bounds = relation.filter(item => item.kind === 'bounds');
  assert.equal(bounds.length, 1);
  near(bounds[0].size, [
    8 * Math.cos(Math.PI / 6) + 6 * Math.sin(Math.PI / 6),
    8 * Math.sin(Math.PI / 6) + 6 * Math.cos(Math.PI / 6),
    4,
  ]);
  const sourcePlane = relation.find(
    item => item.kind === 'surface' && item.nodeId === bounds[0].nodeId,
  );
  assert.ok(sourcePlane);
  assert.equal(sourcePlane.appearance.color, bounds[0].appearance.color);
});

for (const [call, kind] of [
  ['pivot([5, 0, 0])', 'point'],
  ['aroundLine(axis.axis)', 'line'],
] as const) {
  test(`an unfinished ${call} retains a source reference and visible marker`, async () => {
    const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const axis = box(2, 2, 2); const part = box(8, 6, 4).relate(self => self.on(base.up).${call});`;
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.match(defined(module.diagnostic).summary, /completed Constraint/);
    const target = module.sourceTargets.find(
      target =>
        target.kind === 'constraint' &&
        target.evaluations[0].relationSpatial?.kind === call.split('(')[0],
    );
    assert.ok(target);
    const evaluation = target.evaluations[0];
    const {originSourceDecoration} = await server.ssrLoadModule<
      typeof import('../src/model/origin-decorations.ts')
    >('/src/model/origin-decorations.ts');
    const markers = originSourceDecoration.decorations({
      module,
      target,
      evaluation,
    });
    assert.equal(anchorDecoration(markers[0]).elementKind, kind);
    assert.equal(markers[0].nodeId, evaluation.relationOwnerNodeId);
  });
}

test('completing an upstream offset preserves preceding displacements', async () => {
  const source = `import {box} from '@code3d/core';
const amount = 2;
const base = box(20, 10, 30);
box(8, 6, 4).relate(self => self.on(base.up).offset(0, 3, 4).offset(amount /* x */));`;
  const compile = (source: string) =>
    compiler.compile({files: [{path: '/model.ts', source}]}, '/model.ts');
  const module = await compile(source);
  assert.equal(module.diagnostic, undefined);
  const node = defined(module.fallback);
  const occurrence = {
    object: new Object3D(),
    depth: 0,
    view: 'source' as const,
    node,
    key: 'part',
    placement: 'composition' as const,
  };
  const {positionBindings} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts');
  const binding = defined(
    positionBindings(occurrence, [occurrence], null).find(
      binding => binding.axis === 'x',
    ),
  );
  assert.equal(binding.kind, 'parameter');
  if (binding.kind !== 'parameter') return;
  const host = hostFor(source);
  const result = new ToolEngine(host.host).begin('offset').commit({
    kind: 'parameter.set',
    target: binding.target,
    value: 7,
    completeArguments: binding.completeArguments,
  });
  assert.equal(result.status, 'committed');
  assert.equal(
    host.source(),
    source
      .replace('const amount = 2', 'const amount = 7')
      .replace('offset(amount /* x */)', 'offset(amount /* x */, 0, 0)'),
  );
  const next = await compile(host.source());
  assert.equal(next.diagnostic, undefined);
  assert.deepEqual(
    defined(next.fallback).constraints.at(-1)?.offsets.at(-1)!.value,
    [7, 0, 0],
  );
});

test('coupled constraint stages share the final joint pose and parameter editing limits', async () => {
  const source = `import {box} from '@code3d/core'; const base=box(20,10,20); const part=box(2,2,2).relate(self=>[self.axis.align(base.axis).rotate(0,25,0),self.on(base.up)]);`;
  const {bindings, target, module, node, evaluation} = await relationTool(
    source,
    'rotate',
  );
  assert.equal(bindings.length, 0);
  assert.equal(defined(target.tool).signature.name, 'rotate');
  const {positionBindings} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts');
  const occurrence = {
    object: new Object3D(),
    depth: 0,
    view: 'source' as const,
    node,
    key: 'coupled',
    placement: 'composition' as const,
  };
  assert.equal(node.constraints.length, 2);
  const final = defined(module.objects.get(node.nodeId));
  assert.equal(final.constraints.length, 2);
  assert.deepEqual(node.compositionTransform, final.compositionTransform);
  near(node.compositionTransform.position, [0, 6, 0]);
  assert.deepEqual(
    positionBindings(
      occurrence,
      [occurrence],
      defined(evaluation.constraintId),
    ),
    [],
  );
  const changed = source.replace('25', '55');
  const {node: next} = await relationTool(changed, 'rotate');
  near(
    defined(next).compositionTransform.position,
    defined(node).compositionTransform.position,
  );
  assert.notDeepEqual(
    defined(next).compositionTransform.quaternion,
    defined(node).compositionTransform.quaternion,
  );
  assert.equal(module.diagnostic, undefined);
});

function anchorDecoration(decoration: ViewportDecoration) {
  assert.ok(decoration.kind === 'anchor');
  return decoration;
}

test('origin drag uses its initial snapshot and switches to result coordinates on commit', async () => {
  const source = `import {point} from '@code3d/core'; point([10, 20, 30]).originOffset(2, 3, 4);`;
  const {node, bindings} = await build(source, 'originOffset');
  const {committedSpatialObject} = await server.ssrLoadModule<
    typeof import('../src/tools/spatial-edit.ts')
  >('/src/tools/spatial-edit.ts');
  const binding = defined(bindings.find(binding => binding.axis === 'x'));
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('origin-snapshot');
  const first = spatialIntent(binding, 5);
  const second = spatialIntent(binding, 7);
  session.preview(first);
  session.preview(second);
  near(first.preview.objects[0].spatial.origin, [3, 0, 0]);
  near(second.preview.objects[0].spatial.origin, [5, 0, 0]);
  near(second.preview.objects[0].transform.position, [0, 0, 0]);
  near([...defined(defined(node).mesh).topologyVertices], [8, 17, 26]);
  session.cancel();
  assert.equal(host.source(), source);
  const result = new ToolEngine(host.host)
    .begin('origin-commit')
    .commit(second);
  assert.equal(result.status, 'committed');
  const committed = committedSpatialObject(second.preview.objects[0]);
  near(committed.spatial.origin, [0, 0, 0]);
  near(committed.transform.position, [-5, 0, 0]);
  const {node: next} = await build(host.source(), 'originOffset');
  near([...defined(defined(next).mesh).topologyVertices], [3, 17, 26]);
  near(defined(next).origin, [0, 0, 0]);
});

test('originPoint on geometry and groups appends an offset and preserves point references through preview and commit', async () => {
  for (const expression of [
    'base.originPoint(base.vertex(3))',
    'group([base, cap]).originPoint(cap.center)',
  ]) {
    const source = `import {box, group} from '@code3d/core';
const base = box(10, 10, 10);
const cap = box(2, 2, 2).relate(self => self.on(base.up));
export default ${expression};`;
    const {node, bindings} = await build(source, 'originPoint');
    assert.equal(bindings.length, 3);
    near(bindings[0].frame.position, [0, 0, 0]);
    const intent = spatialIntent(bindings[0], 2);
    const host = hostFor(source);
    const session = new ToolEngine(host.host).begin('point-origin');
    assert.equal(session.preview(intent).status, 'ready');
    assert.equal(host.source(), source);
    near(intent.preview.objects[0].transform.position, [0, 0, 0]);
    assert.equal(session.commit(intent).status, 'committed');
    assert.ok(host.source().includes(`${expression}.originOffset(2, 0, 0)`));
    const {node: next} = await build(host.source(), 'originOffset');
    near(next.origin, [0, 0, 0]);
    if (node.kind === 'group') {
      for (let i = 0; i < node.children.length; i++)
        near(
          next.children[i].transform.position,
          node.children[i].transform.position.map(
            (v, axis) => v - (axis === 0 ? 2 : 0),
          ),
        );
    } else {
      near(
        [...defined(next.mesh).topologyVertices],
        [...defined(node.mesh).topologyVertices].map(
          (v, i) => v - (i % 3 === 0 ? 2 : 0),
        ),
      );
    }
  }
});

test('default relation rotations append a local rotation and match the committed pose', async () => {
  const {relationRotationBindings} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts');
  for (const chain of [
    'self.on(base.up)',
    'base.on(self.up)',
    'self.on(base.up).rotate(0, 25, 0).offset(3, 2, 1)',
  ]) {
    const source = `import {box} from '@code3d/core'; const base=box(20,10,20); export default box(8,6,4).relate(self=>${chain});`;
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    const node = defined(module.fallback);
    const occurrence = {key: 'part', node, placement: 'composition' as const};
    const ref = defined(node.constraints.at(-1)?.sourceRefs.at(-1));
    const bindings = relationRotationBindings(occurrence, [occurrence], ref);
    assert.equal(bindings.length, 3);
    const intent = spatialIntent(bindings[2], 30);
    const host = hostFor(source);
    const session = new ToolEngine(host.host).begin('relation-rotate');
    assert.equal(session.preview(intent).status, 'ready');
    session.cancel();
    assert.equal(host.source(), source);
    assert.equal(
      new ToolEngine(host.host).begin('relation-rotate').commit(intent).status,
      'committed',
    );
    assert.ok(host.source().includes(`${chain}.rotate(0, 0, 30)`));
    const next = await compiler.compile(
      {files: [{path: '/model.ts', source: host.source()}]},
      '/model.ts',
    );
    assert.equal(next.diagnostic, undefined);
    const matrix = (
      t:
        | typeof node.compositionTransform
        | (typeof intent.preview.objects)[0]['transform'],
    ) =>
      new Matrix4().compose(
        new Vector3(...t.position),
        new Quaternion(...t.quaternion),
        new Vector3(1, 1, 1),
      );
    near(
      matrix(node.compositionTransform).multiply(
        matrix(intent.preview.objects[0].transform),
      ).elements,
      matrix(defined(next.fallback).compositionTransform).elements,
    );
  }
});

test('composition rotation edits reuse the authored call across offsets and preserve the full-result preview', async () => {
  const {existingRelationRotationBindings} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts');
  for (const chain of [
    'self.on(base.up).rotate(10,20,30).offset(3,4,5)',
    'base.on(self.up).offset(3,4,5).rotate(10,20,30)',
    'self.on(base.up).pivot([5,0,0]).rotate(10,20,30).offset(3,4,5)',
    'self.on(base.up).aroundLine(base.axis).rotate(20).offset(3,4,5)',
    'self.on(base.up).rotate(10,20,30).offset(3,4,5).aroundLine(base.axis).rotate(25).offset(6,7,8)',
    'base.on(self.up).rotate(10,20,30).offset(3,4,5).rotate(25,15,5)',
    'self.on(base.up).aroundLine(base.axis).rotate(20).offset(3,4,5).pivot([5,0,0]).rotate(25,15,5)',
  ]) {
    const source = `import {box} from '@code3d/core'; const base=box(20,10,20); export default box(8,6,4).relate(self=>${chain}).material('#d8ff3e');`;
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    const node = defined(module.fallback);
    const occurrence = {key: 'part', node, placement: 'composition' as const};
    const authored = module.sourceTargets.find(
      target =>
        target.kind === 'constraint' &&
        target.tool?.signature.name === 'rotate',
    );
    const resolved = authored && {
      ...authored,
      sourceRef: authored.callRef ?? authored.sourceRef,
    };
    assert.ok(
      resolved,
      JSON.stringify({
        refs: node.constraints.at(-1)?.sourceRefs,
        targets: module.sourceTargets
          .filter(t => t.tool?.signature.name === 'rotate')
          .map(t => ({
            kind: t.kind,
            ref: t.sourceRef,
            tool: t.tool?.signature.name,
          })),
      }),
    );
    const target = resolved;
    const bindings = existingRelationRotationBindings(
      module,
      target,
      occurrence,
      [occurrence],
      new Map(),
      new Map(),
    );
    const axisOnly =
      chain.indexOf('aroundLine') >= 0 &&
      chain.indexOf('aroundLine') < chain.indexOf('rotate');
    assert.equal(bindings.length, axisOnly ? 1 : 3);
    const intent = spatialIntent(bindings[0], 40);
    const host = hostFor(source);
    assert.equal(
      new ToolEngine(host.host).begin('rotate').commit(intent).status,
      'committed',
    );
    assert.equal(
      (host.source().match(/\.rotate\(/g) ?? []).length,
      (source.match(/\.rotate\(/g) ?? []).length,
    );
    assert.ok(
      host.source().includes(axisOnly ? '.rotate(40)' : '.rotate(40,20,30)'),
    );
    const next = await compiler.compile(
      {files: [{path: '/model.ts', source: host.source()}]},
      '/model.ts',
    );
    const matrix = (t: (typeof intent.preview.objects)[0]['transform']) =>
      new Matrix4().compose(
        new Vector3(...t.position),
        new Quaternion(...t.quaternion),
        new Vector3(1, 1, 1),
      );
    near(
      matrix(node.compositionTransform).multiply(
        matrix(intent.preview.objects[0].transform),
      ).elements,
      matrix(defined(next.fallback).compositionTransform).elements,
    );
  }
});

test('default relation tools share current material-derived instances and exclude unrelated members', async () => {
  const {relationBindings} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts');
  const source = `import {box} from '@code3d/core';
const base = box(20,10,20);
export default box(8,6,4).relate(self => self.on(base.up).pivot([5,0,0]).rotate(10,20,30)).material('#d8ff3e');`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  const node = defined(module.fallback);
  const first = {key: 'first', node, placement: 'composition' as const};
  const second = {...first, key: 'second'};
  const unrelated = {
    ...first,
    key: 'unrelated',
    node: {...node, constraints: []},
  };
  const bindings = relationBindings(
    module,
    first,
    [first, second, unrelated],
    null,
    new Map(),
    new Map(),
  );
  assert.equal(bindings.length, 6);
  for (const binding of bindings) {
    const keys =
      binding.kind === 'expression'
        ? binding.occurrenceKeys
        : binding.kind === 'spatial'
          ? binding.spatial.objects.map(object => object.key)
          : [];
    assert.deepEqual(keys, ['first', 'second']);
  }
});

test('activated relation tools edit their selected call and preserve later operations', async () => {
  const source = `import {box} from '@code3d/core'; const base=box(20,10,20); export default box(8,6,4).relate(self=>self.on(base.up).offset(1,2,3).pivot([3,1,0]).rotate(10,20,30).offset(4,5,6).pivot([-2,0,4]).rotate(40,50,60));`;
  const moved = await placementTools(source, 'self.on', undefined, 'translate');
  const offset = defined(
    moved.bindings.find(
      binding => binding.mode === 'translate' && binding.axis === 'x',
    ),
  );
  assert.equal(offset.value, 1);
  const rotated = await placementTools(
    source,
    'offset(1,2,3)',
    'offset',
    'rotate-point',
  );
  const module = rotated.module;
  const node = defined(module.fallback);
  const rotate = defined(
    rotated.bindings.find(
      binding => binding.mode === 'rotate' && binding.axis === 'x',
    ),
  );
  assert.ok(rotate.kind === 'spatial');
  assert.equal(rotate.value, 10);
  const host = hostFor(source);
  assert.equal(
    new ToolEngine(host.host).begin('rotate').commit(spatialIntent(rotate, 25))
      .status,
    'committed',
  );
  assert.match(
    host.source(),
    /\.rotate\(25,20,30\)\.offset\(4,5,6\)\.pivot\(\[-2,0,4\]\)\.rotate\(40,50,60\)/,
  );
  const self = module.sourceTargets.find(
    target =>
      target.kind === 'value' &&
      target.sourceRef.start === source.indexOf('self.on'),
  );
  assert.ok(self);
  const preview = defined(self.evaluations[0].relationPreview);
  const {originSourceDecoration} = await server.ssrLoadModule<
    typeof import('../src/model/origin-decorations.ts')
  >('/src/model/origin-decorations.ts');
  const marker = originSourceDecoration.decorations({
    module,
    target: self,
    evaluation: self.evaluations[0],
  })[0];
  assert.ok(marker?.kind === 'anchor');
  near(
    marker.transform.position,
    preview.constraints[0].rotations[0].spatial.origin,
  );
  assert.notDeepEqual(
    marker.transform.position,
    preview.constraints[0].rotations[1].spatial.origin,
  );

  near(
    preview.compositionTransform.position,
    node.compositionTransform.position,
  );
  near(
    preview.compositionTransform.quaternion,
    node.compositionTransform.quaternion,
  );
});

for (const operation of ['offset', 'rotate'] as const)
  for (const index of [0, 1]) {
    test(`${operation} stage ${index} edits itself and appends the other tool immediately after it`, async () => {
      const {relationBindings} = await server.ssrLoadModule<
        typeof import('../src/tools/model-spatial-tool.ts')
      >('/src/tools/model-spatial-tool.ts');
      const source = `import {box} from '@code3d/core'; const base=box(20,10,20); export default box(8,6,4).relate(self=>self.on(base.up).offset(1,2,3).rotate(10,20,30).offset(4,5,6).rotate(40,50,60));`;
      const module = await compiler.compile(
        {files: [{path: '/model.ts', source}]},
        '/model.ts',
      );
      const target = module.sourceTargets
        .filter(
          target =>
            target.kind === 'constraint' &&
            target.tool?.signature.name === operation,
        )
        .sort((a, b) => a.sourceRef.end - b.sourceRef.end)[index];
      const evaluation = target.evaluations[0];
      const node = {
        ...defined(module.fallback),
        ...defined(evaluation.relationPreview),
      };
      const occurrence = {key: 'part', node, placement: 'composition' as const};
      const bindings = relationBindings(
        module,
        occurrence,
        [occurrence],
        evaluation.constraintId!,
        new Map(),
        new Map(),
        {target, evaluation},
      );
      assert.equal(bindings.length, 6);
      const same = defined(
        bindings.find(
          binding =>
            binding.axis === 'x' &&
            binding.mode === (operation === 'offset' ? 'translate' : 'rotate'),
        ),
      );
      assert.equal(
        same.value,
        operation === 'offset' ? [1, 4][index] : [10, 40][index],
      );
      const other = defined(
        bindings.find(
          binding => binding.axis === 'x' && binding.mode !== same.mode,
        ),
      );
      const host = hostFor(source);
      const engine = new ToolEngine(host.host);
      const insertion =
        operation === 'offset' ? '.rotate(25, 0, 0)' : '.offset(3, 0, 0)';
      const intent =
        other.kind === 'spatial'
          ? spatialIntent(other, 25)
          : other.kind === 'expression'
            ? {
                kind: 'relation.offset' as const,
                receiver: other.receiver,
                occurrenceKeys: other.occurrenceKeys,
                offsetArguments: other.offsetArguments,
                delta: [3, 0, 0] as const,
                frameQuaternion: other.frame.quaternion,
                direction: 1 as const,
              }
            : undefined;
      assert.ok(intent);
      const resolution = engine.resolve('other-tool', intent);
      assert.equal(resolution.status, 'ready');
      assert.equal(
        engine.begin('other-tool').commit(intent).status,
        'committed',
      );
      const end = target.sourceRef.end;
      assert.equal(
        host.source(),
        source.slice(0, end) + insertion + source.slice(end),
      );
      const next = await compiler.compile(
        {files: [{path: '/model.ts', source: host.source()}]},
        '/model.ts',
      );
      assert.equal(next.diagnostic, undefined);
      const appended = defined(
        next.sourceTargets.find(
          candidate =>
            candidate.kind === 'constraint' &&
            candidate.sourceRef.end === end + insertion.length,
        ),
      );
      const actual = defined(
        appended.evaluations[0].relationPreview,
      ).compositionTransform;
      if (intent.kind === 'model.spatial') {
        const matrix = (t: {
          position: readonly number[];
          quaternion: readonly number[];
        }) =>
          new Matrix4().compose(
            new Vector3().fromArray(t.position),
            new Quaternion().fromArray(t.quaternion),
            new Vector3(1, 1, 1),
          );
        near(
          matrix(node.compositionTransform).multiply(
            matrix(intent.preview.objects[0].transform),
          ).elements,
          matrix(actual).elements,
        );
      } else {
        assert.ok(
          resolution.status === 'ready' &&
            resolution.plan.preview?.kind === 'occurrence-translation',
        );
        const delta = resolution.plan.preview.delta;
        near(
          actual.position,
          node.compositionTransform.position.map(
            (value, axis) => value + delta[axis],
          ),
        );
        near(actual.quaternion, node.compositionTransform.quaternion);
      }
    });
  }

for (const selector of [
  'pivotVertex(1)',
  'pivot([2,3,4])',
  'pivotPoint(base.center)',
  'aroundEdge(1)',
  'aroundLine(base.axis)',
  'aroundLine(base.axis.reverse())',
] as const) {
  test(`reference displacement ${selector} retains its reference and matches every instance's solved pose`, async () => {
    const source = `import {box, group, pivot, pivotVertex, pivotPoint, aroundEdge, aroundLine} from '@code3d/core';
const base=box(40,8,30).rotate(10,20,30);
const parts=[1,2].map(i=>box(10+i,8,6).relate(self=>[self.on(base.up),${selector}.rotate(${selector.startsWith('around') ? '35' : '10,20,30'})])); group([base,...parts]);`;
    const built = await placementTools(
      source,
      'self.on',
      undefined,
      selector.startsWith('around') ? 'rotate-axis' : 'rotate-point',
    );
    const {rotationReferenceBindings} = await server.ssrLoadModule<
      typeof import('../src/tools/model-spatial-tool.ts')
    >('/src/tools/model-spatial-tool.ts');
    const references = rotationReferenceBindings(built.bindings);
    const binding = defined(references.find(binding => binding.axis === 'x'));
    assert.ok(binding.kind === 'spatial');
    assert.equal(
      binding.spatial.source.kind === 'reference-offset' &&
        binding.spatial.source.explicit,
      true,
      JSON.stringify(binding.spatial),
    );
    const intent = spatialIntent(binding, binding.value + 5);
    const host = hostFor(source);
    const result = new ToolEngine(host.host).begin('reference').commit(intent);
    assert.equal(result.status, 'committed');
    assert.ok(
      host
        .source()
        .includes(
          selector.startsWith('pivot(')
            ? 'pivot([7, 3, 4])'
            : `${selector}.${selector.startsWith('around') ? 'axisOffset' : 'pivotOffset'}(5, 0, 0)`,
        ),
      host.source(),
    );
    const next = await placementTools(host.source(), 'self.on');
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    built.occurrences.forEach((occurrence, i) => {
      const predicted = composeTransforms(
        occurrence.node.compositionTransform,
        intent.preview.objects[i].transform,
      );
      near(
        predicted.position,
        next.occurrences[i].node.compositionTransform.position,
      );
      near(
        predicted.quaternion,
        next.occurrences[i].node.compositionTransform.quaternion,
      );
    });
  });
}

test('reference source edits support aliases, namespaces, repeated movement and selector replacement', async () => {
  const {referenceOffsetSource, rotationReferenceSource} =
    await server.ssrLoadModule<
      typeof import('../src/tools/source-expression.ts')
    >('/src/tools/source-expression.ts');
  const factory = {
    name: 'center',
    sourceRef: {file: '/model.ts', start: 0, end: 1},
    container: 'array' as const,
  };
  assert.deepEqual(
    referenceOffsetSource(
      'core.rotate(10,20,30)',
      'pivotOffset',
      [5, 0, 0],
      [5, 0, 0],
      false,
      'core.pivot',
    ),
    {
      text: 'core.pivot([0, 0, 0]).pivotOffset(5, 0, 0).rotate(10,20,30)',
      usesConstructor: true,
    },
  );
  assert.equal(
    referenceOffsetSource(
      'center([x,2,3]).rotate(10,20,30)',
      'pivotOffset',
      [5, 0, 0],
      [5, 0, 0],
      true,
    ).text,
    'center([x,2,3]).pivotOffset(5, 0, 0).rotate(10,20,30)',
  );
  assert.equal(
    referenceOffsetSource(
      'center([x,2,3]).pivotOffset(n + 5, 0, 0).rotate(10,20,30)',
      'pivotOffset',
      [9, 0, 0],
      [4, 0, 0],
      true,
    ).text,
    'center([x,2,3]).pivotOffset(n + 9, 0, 0).rotate(10,20,30)',
  );
  assert.equal(
    rotationReferenceSource(
      'center([x,2,3]).pivotOffset(n,0,0).rotate(10,20,30)',
      {
        selector: 'pivotVertex',
        expression: '4',
        factory: {...factory, name: 'vertexPivot'},
        previous: 'point',
        explicit: true,
      },
    ).text,
    'vertexPivot(4).pivotOffset(n,0,0).rotate(10,20,30)',
  );
  for (const [selector, method] of [
    ['pivotVertex(4)', 'pivotOffset'],
    ['aroundLine(base.axis)', 'axisOffset'],
  ] as const) {
    assert.equal(
      referenceOffsetSource(
        `${selector}.${method}(...coords).rotate(10)`,
        method,
        [6, 2, 3],
        [5, 0, 0],
        true,
      ).text,
      `${selector}.${method}(6, 2, 3).rotate(10)`,
    );
  }
  assert.equal(
    rotationReferenceSource('self.on(base.up).rotate(10,20,30)', {
      selector: 'aroundLine',
      expression: 'self.edge(2)',
      previous: 'point',
      explicit: false,
      append: 'chain',
    }).text,
    'self.on(base.up).rotate(10,20,30).aroundLine(self.edge(2)).rotate(0)',
  );
});

test('draft rotation reference edits complete once and preserve authored offsets, angles and constructor names', async () => {
  const {rotationReferenceSource} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts');
  for (const [source, selector, name, expression, expected] of [
    ['pV()', 'pivotVertex', 'pV', '4', 'pV(4).rotate(0, 0, 0)'],
    [
      'core.pivotVertex().pivotOffset(n,0,0)',
      'pivotVertex',
      'core.pivotVertex',
      '4',
      'core.pivotVertex(4).pivotOffset(n,0,0).rotate(0, 0, 0)',
    ],
    [
      'pivotVertex().rotate(x,2,3)',
      'pivotVertex',
      'pivotVertex',
      '4',
      'pivotVertex(4).rotate(x,2,3)',
    ],
    [
      'pivot([1,2,3]).pivotOffset(n,0,0)',
      'pivotVertex',
      'pivotVertex',
      '4',
      'pivotVertex(4).pivotOffset(n,0,0).rotate(0, 0, 0)',
    ],
    [
      'core.aroundLine().axisOffset(n,0,0)',
      'aroundLine',
      'core.aroundLine',
      'self.edge(2)',
      'core.aroundLine(self.edge(2)).axisOffset(n,0,0).rotate(0)',
    ],
    [
      'aroundLine().axisOffset(n,0,0).rotate(angle)',
      'aroundLine',
      'aroundLine',
      'self.edge(2)',
      'aroundLine(self.edge(2)).axisOffset(n,0,0).rotate(angle)',
    ],
    [
      'self.on(base.up).aroundLine()',
      'aroundLine',
      '',
      'self.edge(2)',
      'self.on(base.up).aroundLine(self.edge(2)).rotate(0)',
    ],
  ] as const) {
    assert.equal(
      rotationReferenceSource(source, {
        draft: true,
        selector,
        expression,
        previous: selector === 'aroundLine' ? 'axis' : 'point',
        explicit: true,
        factory: name
          ? {
              name,
              sourceRef: {file: '/model.ts', start: 0, end: 1},
              container: 'array',
            }
          : undefined,
      }).text,
      expected,
    );
  }
});

test('draft angle edits complete one rotation and retain other angles during pending recompilation', async () => {
  const {completeRotationSource} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts');
  let source = 'core.pivotVertex().pivotOffset(2, 3, 4)';
  source = completeRotationSource(source, false, 1, 25);
  assert.equal(
    source,
    'core.pivotVertex().pivotOffset(2, 3, 4).rotate(0, 25, 0)',
  );
  source = completeRotationSource(source, false, 0, 10);
  assert.equal(
    source,
    'core.pivotVertex().pivotOffset(2, 3, 4).rotate(10, 25, 0)',
  );
  assert.equal(
    completeRotationSource('aroundLine(base.axis)', true, 0, 35),
    'aroundLine(base.axis).rotate(35)',
  );
  assert.equal(
    completeRotationSource(
      'pivot([1,2,3]).rotate( /* x */ 15, amount, 20)',
      false,
      0,
      25,
    ),
    'pivot([1,2,3]).rotate( /* x */ 25, amount, 20)',
  );
});

for (const style of ['array', 'chain'] as const) {
  test(`toolbar activation only considers the adjacent transformation in a ${style}`, async () => {
    const point = 'pivotVertex(1).rotate(10,20,30)',
      axis = 'aroundEdge(1).rotate(25)';
    const relation =
      style === 'array'
        ? `[self.on(base.up), ${point}, ${axis}, ${point}]`
        : `self.on(base.up).${point}.${axis}.${point}`;
    const source = `import {box,group,pivotVertex,aroundEdge} from '@code3d/core'; const base=box(20,4,20); const part=box(8,6,4).relate(self=>${relation}); group([base,part]);`;
    const built = await placementTools(source, 'self.on');
    const {contextualToolActivation} = await server.ssrLoadModule<
      typeof import('../src/tools/contextual-tool-context.ts')
    >('/src/tools/contextual-tool-context.ts');
    const scope = {
      target: built.target,
      evaluation: built.target.evaluations[0],
    };
    const pointRef = defined(
      contextualToolActivation(built.module, scope, 'rotate-point'),
    );
    assert.equal(pointRef.end, source.indexOf(point) + point.length);
    const inserted = defined(
      contextualToolActivation(built.module, scope, 'rotate-axis'),
    );
    assert.ok(
      inserted.end <= source.indexOf(point),
      'Do not skip the point rotation to activate a later axis rotation',
    );
    const current = defined(
      built.module.sourceTargets.find(
        t =>
          t.tool?.signature.name === 'rotate' &&
          t.sourceRef.end === pointRef.end &&
          !t.rotationToolId,
      ),
    );
    const axisRef = defined(
      contextualToolActivation(
        built.module,
        {target: current, evaluation: current.evaluations[0]},
        'rotate-axis',
      ),
    );
    assert.equal(axisRef.end, source.indexOf(axis) + axis.length);
  });
}

test('array insertion gaps preview each loop prefix and retain inherited placement', async () => {
  const source = `import {box, group, rotate, offset} from '@code3d/core';
const base=box(20,4,20);
const parts=[3,7].map(x=>box(8,6,4).relate(self=>self.on(base.up)).relate(self=>[rotate(0,0,20),offset(x,0,0)]));
group([base,...parts]);`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const gaps = module.sourceTargets
    .filter(target => target.relationArray)
    .sort((a, b) => a.sourceRef.start - b.sourceRef.start);
  assert.equal(gaps.length, 3);
  for (const [index, gap] of gaps.entries()) {
    const instances = [
      ...new Map(gap.evaluations.map(e => [e.relationOwnerNodeId, e])).values(),
    ];
    assert.equal(instances.length, 2);
    const previews = instances.map(e => defined(e.relationPreview));
    assert.deepEqual(
      previews
        .map(p => p.compositionTransform.position)
        .sort((a, b) => a[0] - b[0]),
      index === 2
        ? [
            [3, 5, 0],
            [7, 5, 0],
          ]
        : [
            [0, 5, 0],
            [0, 5, 0],
          ],
    );
    assert.ok(
      previews.every(p => p.constraints.length === 1),
      'Earlier relate placement is inherited',
    );
    assert.ok(previews.every(p => (p.transformations?.length ?? 0) === index));
    const {relationBindings} = await server.ssrLoadModule<
      typeof import('../src/tools/model-spatial-tool.ts')
    >('/src/tools/model-spatial-tool.ts');
    const occurrences = previews.map((preview, i) => ({
      key: `part/${i}`,
      placement: 'composition' as const,
      node: {...defined(module.objects.get(preview.nodeId)), ...preview},
    }));
    const bindings = relationBindings(
      module,
      occurrences[0],
      occurrences,
      null,
      new Map(),
      new Map(),
      {target: gap, evaluation: instances[0]},
    );
    const binding = defined(
      bindings.find(b => b.mode === 'translate' && b.axis === 'x'),
    );
    assert.ok(
      binding.kind === 'spatial' &&
        binding.spatial.source.kind === 'transformation-insert',
    );
    const host = hostFor(source);
    assert.equal(
      new ToolEngine(host.host).begin('gap').commit(spatialIntent(binding, 5))
        .status,
      'committed',
    );
    const expected =
      index === 0
        ? '[offset(5, 0, 0), rotate(0,0,20)'
        : index === 1
          ? 'rotate(0,0,20), offset(5, 0, 0),offset(x,0,0)'
          : 'offset(x,0,0), offset(5, 0, 0)]';
    assert.ok(host.source().includes(expected), host.source());
  }
});

test('tool activation uses only current or immediately following transformation in the same segment', async () => {
  const {contextualToolActivation} = await server.ssrLoadModule<
    typeof import('../src/tools/contextual-tool-context.ts')
  >('/src/tools/contextual-tool-context.ts');
  for (const [items, current, tool, expected] of [
    [
      'offset(1,0,0),aroundEdge(1).rotate(61),offset(2,0,0)',
      'offset(1,0,0)',
      'rotate-axis',
      'rotate(61)',
    ],
    [
      'offset(1,0,0),aroundEdge(1).rotate(61),offset(2,0,0)',
      'offset(1,0,0)',
      'translate',
      'offset(1,0,0)',
    ],
    [
      'offset(1,0,0),rotate(0,0,20),aroundEdge(1).rotate(61)',
      'offset(1,0,0)',
      'rotate-axis',
      undefined,
    ],
    [
      'aroundEdge(1).rotate(61),rotate(0,0,20)',
      'rotate(61)',
      'rotate-point',
      'rotate(0,0,20)',
    ],
    [
      'rotate(0,0,20),offset(2,0,0)',
      'rotate(0,0,20)',
      'translate',
      'offset(2,0,0)',
    ],
    [
      'offset(1,0,0),self.axis.align(base.axis),aroundEdge(1).rotate(61)',
      'offset(1,0,0)',
      'rotate-axis',
      undefined,
    ],
  ] as const) {
    const source = `import {box,group,offset,rotate,aroundEdge} from '@code3d/core'; const base=box(20,4,20); const part=box(8,6,4).relate(self=>[self.on(base.up),${items}]);group([base,part]);`;
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const end = source.indexOf(current) + current.length;
    const target = defined(
      module.sourceTargets.find(
        t =>
          ['offset', 'rotate'].includes(t.tool?.signature.name ?? '') &&
          t.sourceRef.end === end,
      ),
    );
    const ref = defined(
      contextualToolActivation(
        module,
        {target, evaluation: target.evaluations[0]},
        tool,
      ),
    );
    if (expected)
      assert.equal(
        ref.end,
        source.indexOf(expected) + expected.length,
        JSON.stringify({items, current, tool, ref}),
      );
    else
      assert.ok(
        module.sourceTargets.some(
          t =>
            t.relationArray &&
            t.sourceRef.start === end &&
            t.sourceRef.end === ref.end,
        ),
        JSON.stringify({items, current, tool, ref}),
      );
  }
});
