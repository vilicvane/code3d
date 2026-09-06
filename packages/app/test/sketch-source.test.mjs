import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';

let server, ToolEngine, analyzeSketchSource;
before(async () => {
  server = await createAppTestServer();
  ({ToolEngine} = await server.ssrLoadModule('/src/tools/tool-system.ts'));
  ({analyzeSketchSource} = await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  ));
});
after(async () => server?.close());

function setup(source) {
  let version = 1;
  const undo = [];
  const sourceRef = {file: '/model.ts', start: 0, end: source.length};
  const engine = new ToolEngine({
    sourceVersion: () => version,
    readSource: () => source,
    resolveSourceRef: () => ({...sourceRef, end: source.length}),
    applySourceEdits(base, edits) {
      assert.equal(base, version);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].expectedText, source);
      undo.push(source);
      source = edits[0].text;
      version++;
      return true;
    },
    applyPreview() {},
    commitPreview() {},
    clearPreview() {},
  });
  return {
    source: () => source,
    undo,
    edit(change, expectedText = source, references = {base: 'sketch1'}) {
      return engine.begin('sketch-test').commit({
        kind: 'sketch.edit',
        sourceRef,
        expectedText,
        layer: 'local',
        references,
        change,
      });
    },
  };
}

test('moving a numeric point preserves expressions, comments and tuple identities', () => {
  const source =
    "[\n  ['point', 1, [/* x */ -2, /* y */ +3]],\n  ['point', 8, [width * 2, 0]], // driven\n  ['line', 9, [1, 8]],\n]";
  const host = setup(source);
  assert.deepEqual(
    [...analyzeSketchSource(source).editable],
    [
      [1, [true, true]],
      [8, [false, true]],
    ],
  );
  assert.equal(
    host.edit({kind: 'move', positions: [{id: 1, position: [4, 5]}]}).status,
    'committed',
  );
  assert.equal(host.source(), source.replace('-2', '4').replace('+3', '5'));
  assert.equal(
    host.edit({kind: 'move', positions: [{id: 8, position: [4, 5]}]}).status,
    'committed',
  );
  assert.match(host.source(), /\[width \* 2, 5\]/);
  assert.equal(host.undo.length, 2);
});

test('coordinate permissions come from the AST and preserve each nonliteral axis verbatim', () => {
  const source =
    "[['point', 1, [width, height]], ['point', 2, [+2, /* keep */ height / 2]], ['point', 3, [getX(), -4]], ['point', 4, [(2), 2 + 2]]]";
  const host = setup(source);
  assert.deepEqual(
    [...analyzeSketchSource(source).editable],
    [
      [1, [false, false]],
      [2, [true, false]],
      [3, [false, true]],
      [4, [false, false]],
    ],
  );
  assert.equal(
    host.edit({kind: 'move', positions: [{id: 1, position: [8, 9]}]}).status,
    'unsupported',
  );
  assert.equal(host.source(), source);
  assert.equal(
    host.edit({
      kind: 'move',
      positions: [
        {id: 2, position: [8, 9]},
        {id: 3, position: [8, 9]},
      ],
    }).status,
    'committed',
  );
  assert.equal(host.source(), source.replace('+2', '8').replace('-4', '9'));
  assert.equal(host.undo.length, 1);
});

test('appending uses named upstream references and current local IDs without nextId metadata', () => {
  for (const source of [
    '[]',
    "[['point', 1, [0, 0]]]",
    "[['point', 1, [0, 0]], /* tail */]",
  ]) {
    const host = setup(source);
    const result = host.edit({
      kind: 'append',
      entries: [
        ['point', 2, [5, 6]],
        [
          'line',
          3,
          [
            {layer: 'base', id: 2},
            {layer: 'local', id: 2},
          ],
        ],
      ],
    });
    assert.equal(result.status, 'committed');
    assert.match(host.source(), /sketch1\.point\(2\), 2/);
    const parsed = analyzeSketchSource(host.source());
    assert.equal(parsed.reason, undefined);
    assert.equal(parsed.entries.get(3).kind, 'line');
    assert.equal(host.undo.length, 1);
    if (source.includes('tail')) assert.match(host.source(), /\/\* tail \*\//);
  }
});

test('deleting any tuple subset retains valid separators and surviving comments', () => {
  for (const trailing of ['', ',']) {
    for (const ids of [[1], [2], [3], [1, 2], [2, 3], [1, 3], [1, 2, 3]]) {
      const host = setup(
        `[['point', 1, [0,0]], /* keep 2 */ ['point', 2, [2,0]], ['point', 3, [3,0]]${trailing}]`,
      );
      assert.equal(host.edit({kind: 'delete', ids}).status, 'committed');
      const expected = [1, 2, 3].filter(id => !ids.includes(id));
      assert.deepEqual(
        [...analyzeSketchSource(host.source()).entries.keys()],
        expected,
      );
      // Evaluate the generated literal to catch holes or syntax damage too.
      assert.equal(
        Function(`return ${host.source()}`)().length,
        expected.length,
      );
      if (!ids.includes(2)) assert.match(host.source(), /keep 2/);
    }
  }
});

test('successive appends do not accumulate blank lines between generated tuples', () => {
  const host = setup('[]');
  for (let id = 1; id <= 3; id++) {
    assert.equal(
      host.edit({kind: 'append', entries: [['point', id, [id, 0]]]}).status,
      'committed',
    );
  }
  assert.doesNotMatch(host.source(), /\n[ \t]*\n/);
  assert.deepEqual(
    [...analyzeSketchSource(host.source()).entries.keys()],
    [1, 2, 3],
  );
});

test('stale gestures, dynamic tuples and inaccessible upstreams never rewrite source', () => {
  const host = setup("[['point', 1, [0,0]]]");
  assert.equal(
    host.edit({kind: 'move', positions: [{id: 1, position: [2, 3]}]}, '[]')
      .status,
    'conflict',
  );
  assert.equal(
    host.edit({
      kind: 'append',
      entries: [
        [
          'line',
          2,
          [
            {layer: 'unknown', id: 1},
            {layer: 'local', id: 1},
          ],
        ],
      ],
    }).status,
    'conflict',
  );
  assert.equal(host.undo.length, 0);
  assert.equal(
    host.edit({
      kind: 'append',
      entries: [['point', 2, [2, 3]]],
      constraints: [
        [
          'coincident',
          [
            {layer: 'unknown', id: 1},
            {layer: 'local', id: 2},
          ],
        ],
      ],
    }).status,
    'conflict',
  );
  assert.equal(host.undo.length, 0);
  for (const source of [
    '[...entries]',
    "[['point', id, [0,0]]]",
    '[makePoint()]',
  ]) {
    assert.ok(analyzeSketchSource(source).reason);
    const dynamic = setup(source);
    assert.equal(
      dynamic.edit({kind: 'append', entries: [['point', 2, [0, 0]]]}).status,
      'unsupported',
    );
    assert.equal(dynamic.source(), source);
  }
});

test('geometry and constraints append in one source edit without replacing existing options or expressions', () => {
  for (const source of [
    "[['point', 1, [0,0]]]",
    "[['point', 1, [0,0]]], {}",
    "[['point', 1, [0,0]]], {constraints: [/* keep */ ['x', [1, width]] /* end */]}",
  ]) {
    const host = setup(source);
    assert.equal(
      host.edit({
        kind: 'append',
        entries: [
          ['point', 2, [40, 0]],
          [
            'line',
            3,
            [
              {layer: 'local', id: 1},
              {layer: 'local', id: 2},
            ],
          ],
        ],
        constraints: [
          ['length', [3, 40]],
          ['horizontal', 3],
        ],
      }).status,
      'committed',
    );
    const [entries, options] = Function(
      'width',
      `return [${host.source()}]`,
    )(0);
    assert.equal(entries.length, 3);
    assert.deepEqual(options.constraints.slice(-2), [
      ['length', [3, 40]],
      ['horizontal', 3],
    ]);
    assert.equal(host.undo.length, 1);
    assert.ok(analyzeSketchSource(host.source()).constraints);
    if (source.includes('width'))
      assert.match(host.source(), /\/\* keep \*\/ \['x', \[1, width\]\]/);
  }
});

test('midpoint constraints retain three local or named upstream references in one transaction', () => {
  const host = setup("[['point', 1, [0,0]], ['point', 2, [20,0]]]");
  assert.equal(
    host.edit({
      kind: 'append',
      entries: [['point', 3, [10, 0]]],
      constraints: [
        [
          'midpoint',
          [
            {layer: 'local', id: 3},
            {layer: 'local', id: 1},
            {layer: 'base', id: 2},
          ],
        ],
      ],
    }).status,
    'committed',
  );
  assert.match(host.source(), /'midpoint', \[3, 1, sketch1\.point\(2\)\]/);
  assert.equal(host.undo.length, 1);
  const before = host.source();
  assert.equal(
    host.edit({
      kind: 'append',
      entries: [],
      constraints: [
        [
          'midpoint',
          [
            {layer: 'local', id: 3},
            {layer: 'local', id: 1},
            {layer: 'unknown', id: 2},
          ],
        ],
      ],
    }).status,
    'conflict',
  );
  assert.equal(host.source(), before);
});

test('solved multi-point movement is atomic and does not rewrite dimension expressions', () => {
  const source =
    "[['point', 1, [0,0]], ['point', 2, [40,0]], ['line', 3, [1,2]]], {constraints: [['length', [3, width]], ['horizontal', 3]]}";
  const host = setup(source);
  assert.equal(
    host.edit({
      kind: 'move',
      positions: [
        {id: 1, position: [10, 5]},
        {id: 2, position: [50, 5]},
      ],
    }).status,
    'committed',
  );
  assert.match(host.source(), /\[10,5\]/);
  assert.match(host.source(), /\[50,5\]/);
  assert.match(host.source(), /\['length', \[3, width\]\]/);
  assert.equal(host.undo.length, 1);
});

test('entity deletion removes its constraints in the same undo transaction while keeping others', () => {
  const host = setup(
    "[['point', 1, [0,0]], ['point', 2, [40,0]], ['line', 3, [1,2]]], {constraints: [['fixed', 1], ['horizontal', 3], /* width */ ['length', [3, width]]]}",
  );
  assert.equal(
    host.edit({kind: 'delete', ids: [3], constraints: [1, 2]}).status,
    'committed',
  );
  const [entries, options] = Function(`return [${host.source()}]`)();
  assert.equal(entries.length, 2);
  assert.deepEqual(options.constraints, [['fixed', 1]]);
  assert.equal(host.undo.length, 1);
});

test('computed options and constraints never get silently replaced by generated constraints', () => {
  for (const options of [
    'settings',
    '{...settings}',
    '{constraints: rules}',
    '{constraints: [...rules]}',
  ]) {
    const source = `[], ${options}`;
    const host = setup(source);
    assert.equal(
      host.edit({
        kind: 'append',
        entries: [['point', 1, [0, 0]]],
        constraints: [['fixed', {layer: 'local', id: 1}]],
      }).status,
      'unsupported',
    );
    assert.equal(host.source(), source);
  }
});
