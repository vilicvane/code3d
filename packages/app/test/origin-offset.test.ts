import type {ToolIntent, ToolPreview} from '../src/tools/tool-system.ts';
import type {Vec3} from '@code3d/core';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let offsetOriginSource: (source: string, delta: Vec3, current?: Vec3) => string;
let ToolEngine: (typeof import('../src/tools/tool-system.ts'))['ToolEngine'];
before(async () => {
  server = await createAppTestServer();
  const {offsetCallSource} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts');
  offsetOriginSource = (source, delta, current) =>
    offsetCallSource(source, 'originOffset', delta, current);
  ({ToolEngine} = await server.ssrLoadModule<
    typeof import('../src/tools/tool-system.ts')
  >('/src/tools/tool-system.ts'));
});
after(async () => {
  await server?.close();
});

test('repeated drags combine signed increments without nesting offsets', () => {
  let source = 'part.originOffset((i - 2) * 8, 0, 0)';
  for (const [delta, expression] of [
    [2, '(i - 2) * 8 + 2'],
    [3, '(i - 2) * 8 + 5'],
    [-8, '(i - 2) * 8 - 3'],
    [3, '(i - 2) * 8'],
  ] as const) {
    source = offsetOriginSource(source, [delta, 0, 0]);
    assert.equal(source, `part.originOffset(${expression}, 0, 0)`);
  }
});

test('an absent or spread offset gets one reusable literal call', () => {
  for (const source of ['part', 'part.originOffset(...values)'] as const) {
    const first = offsetOriginSource(source, [2, -3, 0]);
    assert.equal(first, `${source}.originOffset(2, -3, 0)`);
    assert.equal(
      offsetOriginSource(first, [-1, 2, 4]),
      `${source}.originOffset(1, -1, 4)`,
    );
  }
});

test('only the outer call is edited, preserving parentheses, axes and comments', () => {
  const source =
    '(part.originOffset(x, 0, 0).originOffset(/* x */ ((i - 2) * 8),\n  y, /* z */ -2,))';
  assert.equal(
    offsetOriginSource(source, [3, 0, -1]),
    '(part.originOffset(x, 0, 0).originOffset(/* x */ ((i - 2) * 8 + 3),\n  y, /* z */ -3,))',
  );
  assert.equal(
    offsetOriginSource(
      'part.originOffset(x /* a */ + /* b */ 2, 0, 0)',
      [-2, 0, 0],
    ),
    'part.originOffset(x /* a */  /* b */, 0, 0)',
  );
  assert.equal(
    offsetOriginSource('part.originOffset(- /* sign */ 2, 0, 0)', [3, 0, 0]),
    'part.originOffset(- /* sign */ 2 + 3, 0, 0)',
  );
});

test('expression increments preserve operator precedence and evaluation count', () => {
  for (const expression of [
    'i * 2',
    'i ? 3 : 4',
    'i || 4',
    'i & 3',
    '(i, 5)',
    'next()',
    'i ** 2',
    'i - -2',
  ] as const) {
    const original = `part.originOffset(${expression}, 0, 0)`;
    const adjusted = offsetOriginSource(original, [3, 0, 0]);
    let calls = 0;
    const evaluate = (source: string) =>
      Function(
        'part',
        'i',
        'next',
        `return ${source};`,
      )({originOffset: (x: number) => x}, 2, () => {
        calls++;
        return 4;
      });
    assert.equal(evaluate(adjusted), evaluate(original) + 3, adjusted);
    assert.equal(calls, expression === 'next()' ? 2 : 0);
  }
  assert.equal(
    offsetOriginSource('part.originOffset(value as number, 0, 0)', [2, 0, 0]),
    'part.originOffset((value as number) + 2, 0, 0)',
  );
});

test('zero gestures preserve source and numeric changes remain compact', () => {
  assert.equal(offsetOriginSource('part', [0, 0, 0]), 'part');
  assert.equal(
    offsetOriginSource('part.originOffset(0x10, 1_000, -.2)', [-2, 2, 0.3]),
    'part.originOffset(14, 1002, 0.1)',
  );
});

test('cancelling an increment preserves line-comment boundaries', () => {
  const source = 'part.originOffset(x + // keep this comment\n  2, 0, 0)';
  const adjusted = offsetOriginSource(source, [-2, 0, 0]);
  assert.ok(adjusted.includes('// keep this comment\n'));
  assert.equal(
    Function(
      'part',
      'x',
      `return ${adjusted};`,
    )({originOffset: (x: number) => x}, 4),
    4,
  );
});

test('tool transactions read relocated anchors and accumulate before recompilation', () => {
  const original = 'part.originOffset((i - 2) * 8, 0, 0)';
  const anchor = {file: '/model.ts', start: 0, end: original.length};
  let source = '// inserted above after compile\n' + original;
  let currentRef = {
    ...anchor,
    start: source.indexOf('part'),
    end: source.length,
  };
  let version = 1;
  const previews: ToolPreview[] = [];
  const engine = new ToolEngine({
    sourceVersion: () => version,
    resolveSourceRef: ref => {
      assert.equal(ref, anchor);
      return currentRef;
    },
    readSource: ref => source.slice(ref.start, ref.end),
    applySourceEdits(base, [edit]) {
      assert.equal(base, version);
      assert.equal(
        source.slice(edit.sourceRef.start, edit.sourceRef.end),
        edit.expectedText,
      );
      source =
        source.slice(0, edit.sourceRef.start) +
        edit.text +
        source.slice(edit.sourceRef.end);
      currentRef = {...currentRef, end: currentRef.start + edit.text.length};
      version++;
      return true;
    },
    applyPreview: preview => previews.push(preview),
    commitPreview() {},
    clearPreview() {},
  });
  for (const increment of [2, 3, -1] as const) {
    const session = engine.begin('position');
    const intent: ToolIntent = {
      kind: 'model.spatial',
      operation: 'originOffset',
      change: {
        kind: 'origin-offset',
        sourceRef: anchor,
        delta: [increment, 0, 0],
      },
      preview: {
        kind: 'model-spatial',
        objects: ['source/0', 'context/0'].map(key => ({
          key,
          nodeId: 'part',
          transform: {position: [-increment, 0, 0], quaternion: [0, 0, 0, 1]},
          spatial: {
            origin: [0, 0, 0],
            vector: [0, 0, 0],
            frame: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]},
          },
        })),
      },
    };
    const before = source;
    assert.ok(session.preview(intent).status === 'ready');
    assert.equal(source, before);
    assert.ok(session.commit(intent).status === 'committed');
  }
  assert.equal(
    source,
    '// inserted above after compile\npart.originOffset((i - 2) * 8 + 4, 0, 0)',
  );
  assert.deepEqual(
    previews.map(preview => {
      assert.ok(preview.kind === 'model-spatial');
      return preview.objects[0].transform.position;
    }),
    [
      [-2, 0, 0],
      [-2, 0, 0],
      [-3, 0, 0],
      [-3, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ],
  );
  assert.ok(
    previews.every(preview => {
      assert.ok(preview.kind === 'model-spatial');
      return preview.objects.length === 2;
    }),
  );
});

test('a lost receiver anchor conflicts without reading stale source', () => {
  const engine = new ToolEngine({
    sourceVersion: () => 2,
    resolveSourceRef: () => undefined,
    readSource: () => assert.fail('must resolve the anchor first'),
    applySourceEdits: () => assert.fail('must resolve the anchor first'),
    applyPreview: () => assert.fail('must resolve the anchor first'),
    commitPreview: () => assert.fail('must resolve the anchor first'),
    clearPreview: () => assert.fail('must resolve the anchor first'),
  });
  const result = engine.resolve('position', {
    kind: 'model.spatial',
    operation: 'originOffset',
    change: {
      kind: 'origin-offset',
      sourceRef: {file: '/model.ts', start: 1, end: 20},
      delta: [1, 0, 0],
    },
    preview: {kind: 'model-spatial', objects: []},
  });
  assert.ok(result.status === 'conflict');
});

test('editing an existing spread offset materializes that call instead of adding another stage', () => {
  assert.equal(
    offsetOriginSource('part.originOffset(...values)', [2, -3, 0], [1, 2, 3]),
    'part.originOffset(3, -1, 3)',
  );
});
