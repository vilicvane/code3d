import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';

let server;
let offsetRelationSource;
let ToolEngine;
before(async () => {
  server = await createAppTestServer();
  const {offsetCallSource} = await server.ssrLoadModule(
    '/src/tools/source-expression.ts',
  );
  offsetRelationSource = (source, delta) =>
    offsetCallSource(source, 'offset', delta);
  ({ToolEngine} = await server.ssrLoadModule('/src/tools/tool-system.ts'));
});
after(async () => {
  await server?.close();
});

test('repeated drags combine signed increments without nesting offsets', () => {
  let source = 'part.down.on(base.up).offset((i - 2) * 8, 0, 0)';
  for (const [delta, expression] of [
    [2, '(i - 2) * 8 + 2'],
    [3, '(i - 2) * 8 + 5'],
    [-8, '(i - 2) * 8 - 3'],
    [3, '(i - 2) * 8'],
  ]) {
    source = offsetRelationSource(source, [delta, 0, 0]);
    assert.equal(source, `part.down.on(base.up).offset(${expression}, 0, 0)`);
  }
});

test('an absent or spread offset gets one reusable literal call', () => {
  for (const source of [
    'part.down.on(base.up)',
    'relation.offset(...values)',
  ]) {
    const first = offsetRelationSource(source, [2, -3, 0]);
    assert.equal(first, `${source}.offset(2, -3, 0)`);
    assert.equal(
      offsetRelationSource(first, [-1, 2, 4]),
      `${source}.offset(1, -1, 4)`,
    );
  }
});

test('only the outer call is edited, preserving parentheses, axes and comments', () => {
  const source =
    '(relation.offset(x, 0, 0).offset(/* x */ ((i - 2) * 8),\n  y, /* z */ -2,))';
  assert.equal(
    offsetRelationSource(source, [3, 0, -1]),
    '(relation.offset(x, 0, 0).offset(/* x */ ((i - 2) * 8 + 3),\n  y, /* z */ -3,))',
  );
  assert.equal(
    offsetRelationSource(
      'relation.offset(x /* a */ + /* b */ 2, 0, 0)',
      [-2, 0, 0],
    ),
    'relation.offset(x /* a */  /* b */, 0, 0)',
  );
  assert.equal(
    offsetRelationSource('relation.offset(- /* sign */ 2, 0, 0)', [3, 0, 0]),
    'relation.offset(- /* sign */ 2 + 3, 0, 0)',
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
  ]) {
    const original = `relation.offset(${expression}, 0, 0)`;
    const adjusted = offsetRelationSource(original, [3, 0, 0]);
    let calls = 0;
    const evaluate = source =>
      Function(
        'relation',
        'i',
        'next',
        `return ${source};`,
      )({offset: x => x}, 2, () => {
        calls++;
        return 4;
      });
    assert.equal(evaluate(adjusted), evaluate(original) + 3, adjusted);
    assert.equal(calls, expression === 'next()' ? 2 : 0);
  }
  assert.equal(
    offsetRelationSource('relation.offset(value as number, 0, 0)', [2, 0, 0]),
    'relation.offset((value as number) + 2, 0, 0)',
  );
});

test('zero gestures preserve source and numeric changes remain compact', () => {
  assert.equal(offsetRelationSource('relation', [0, 0, 0]), 'relation');
  assert.equal(
    offsetRelationSource('relation.offset(0x10, 1_000, -.2)', [-2, 2, 0.3]),
    'relation.offset(14, 1002, 0.1)',
  );
});

test('cancelling an increment preserves line-comment boundaries', () => {
  const source = 'relation.offset(x + // keep this comment\n  2, 0, 0)';
  const adjusted = offsetRelationSource(source, [-2, 0, 0]);
  assert.ok(adjusted.includes('// keep this comment\n'));
  assert.equal(
    Function('relation', 'x', `return ${adjusted};`)({offset: x => x}, 4),
    4,
  );
});

test('tool transactions read relocated anchors and accumulate before recompilation', () => {
  const original = 'relation.offset((i - 2) * 8, 0, 0)';
  const anchor = {file: '/model.ts', start: 0, end: original.length};
  let source = '// inserted above after compile\n' + original;
  let currentRef = {
    ...anchor,
    start: source.indexOf('relation'),
    end: source.length,
  };
  let version = 1;
  const previews = [];
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
  for (const increment of [2, 3, -1]) {
    const session = engine.begin('position');
    const intent = {
      kind: 'relation.offset',
      receiver: {sourceRef: anchor},
      occurrenceKeys: ['source/0', 'context/0'],
      delta: [increment, 0, 0],
      frameQuaternion: [0, 0, 0, 1],
      direction: 1,
    };
    const before = source;
    assert.equal(session.preview(intent).status, 'ready');
    assert.equal(source, before);
    assert.equal(session.commit(intent).status, 'committed');
  }
  assert.equal(
    source,
    '// inserted above after compile\nrelation.offset((i - 2) * 8 + 4, 0, 0)',
  );
  assert.deepEqual(
    previews.map(preview => preview.delta),
    [
      [2, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [3, 0, 0],
      [-1, 0, 0],
      [-1, 0, 0],
    ],
  );
  assert.ok(previews.every(preview => preview.occurrenceKeys.length === 2));
});

test('a lost receiver anchor conflicts without reading stale source', () => {
  const engine = new ToolEngine({
    sourceVersion: () => 2,
    resolveSourceRef: () => undefined,
    readSource: () => assert.fail('must resolve the anchor first'),
  });
  const result = engine.resolve('position', {
    kind: 'relation.offset',
    receiver: {sourceRef: {file: '/model.ts', start: 1, end: 20}},
    occurrenceKeys: ['source/0'],
    delta: [1, 0, 0],
    frameQuaternion: [0, 0, 0, 1],
    direction: 1,
  });
  assert.equal(result.status, 'conflict');
});
