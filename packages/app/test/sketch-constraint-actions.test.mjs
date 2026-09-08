import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server, sketchConstraintActions, sketchSegments;
before(async () => {
  server = await createAppTestServer();
  ({sketchConstraintActions} = await server.ssrLoadModule(
    '/src/tools/sketch-constraint-actions.ts',
  ));
  ({sketchSegments} = await server.ssrLoadModule(
    '/src/tools/sketch-segments.ts',
  ));
});
after(async () => server?.close());

const ref = (id, layer = 'local') => ({layer, id});
const point = (id, position) => ({kind: 'point', id, position});
const snapshot = (entities, constraints = [], id = 'local') => ({
  id,
  entities,
  constraints,
  degreesOfFreedom: 0,
  redundant: [],
});
const lines = () =>
  snapshot([
    point(1, [0, 0]),
    point(2, [20, 0]),
    point(3, [0, 10]),
    point(4, [20, 10]),
    point(7, [10, 0]),
    {kind: 'line', id: 5, points: [ref(1), ref(2)]},
    {kind: 'line', id: 6, points: [ref(3), ref(4)]},
  ]);
const segments = layers =>
  sketchSegments(
    layers,
    layers.flatMap(l =>
      l.entities
        .filter(e => e.kind === 'point')
        .map(p => ({...p, layer: l.id})),
    ),
  );
const actions = (
  layers,
  selected,
  editable = new Map(),
  references = new Set(),
  data = layers
    .at(-1)
    .entities.filter(e => e.kind === 'point' && !e.alias)
    .map(e => ({id: e.id, parameters: e.position})),
) => sketchConstraintActions(layers, selected, editable, references, data);

test('point, line, mixed and circular selections expose only applicable existing constraints', () => {
  const local = lines(),
    picks = segments([local]);
  assert.deepEqual(
    actions([local], [ref(1)]).map(a => a.kind),
    ['fixed', 'x', 'y'],
  );
  assert.deepEqual(
    actions([local], [ref(1), ref(3)]).map(a => a.kind),
    ['fixed', 'x', 'y', 'coincident'],
  );
  assert.deepEqual(
    actions([local], [picks[0]]).map(a => a.kind),
    ['horizontal', 'vertical', 'length', 'angle'],
  );
  assert.deepEqual(
    actions([local], [ref(7), picks[0]]).map(a => a.kind),
    ['midpoint'],
  );
  assert.deepEqual(actions([local], [ref(1), picks[0]]), []);
  const circle = snapshot([
    point(1, [0, 0]),
    {kind: 'circle', id: 2, center: ref(1), radius: 10},
  ]);
  assert.deepEqual(
    actions([circle], segments([circle])).map(a => a.kind),
    ['radius'],
  );
});

test('multiple intervals of one source line constrain it once and selected lines batch in one transaction', () => {
  const local = lines(),
    picks = segments([local]);
  const selected = actions([local], picks);
  const horizontal = selected.find(a => a.kind === 'horizontal').create();
  assert.deepEqual(horizontal, {
    kind: 'constrain',
    data: [],
    constraints: [
      ['horizontal', 5],
      ['horizontal', 6],
    ],
  });
  assert.deepEqual(
    selected.find(a => a.kind === 'length').create(30).constraints,
    [
      ['length', 5, 30],
      ['length', 6, 30],
    ],
  );
  const constrained = {...local, constraints: [['horizontal', 5]]};
  assert.deepEqual(
    actions([constrained], picks)
      .find(a => a.kind === 'horizontal')
      .create().constraints,
    [['horizontal', 6]],
  );
  assert.equal(
    actions([constrained], [picks[0]]).find(a => a.kind === 'horizontal')
      .disabled,
    false,
  );
  assert.equal(
    actions([constrained], picks).find(a => a.kind === 'horizontal').active,
    'mixed',
  );
  const remove = actions([constrained], [picks[0]]).find(
    a => a.kind === 'horizontal',
  );
  assert.equal(remove.active, true);
  assert.deepEqual(remove.create(), {
    kind: 'constrain',
    constraints: [],
    data: [],
    removedConstraints: [0],
  });
});

test('coordinate actions name the constrained axis and midpoint selections retain their center-first relationship', () => {
  const local = lines();
  const xy = actions([local], [ref(1)]);
  assert.equal(xy.find(a => a.kind === 'x').name, 'X coordinate');
  assert.equal(xy.find(a => a.kind === 'y').dimension.label, 'Y coordinate');
  const midpoint = ['midpoint', [ref(7), ref(1), ref(2)]];
  const selected = actions([{...local, constraints: [midpoint]}], midpoint[1]);
  const action = selected.find(a => a.kind === 'midpoint');
  assert.equal(action.active, true);
  assert.deepEqual(action.create().removedConstraints, [0]);
});

test('removing dimensions preserves current editable geometry, expressions and unrelated constraints', () => {
  const local = snapshot(
    [
      point(1, [10, 0]),
      point(2, [40, 0]),
      {kind: 'line', id: 3, points: [ref(1), ref(2)]},
      {kind: 'circle', id: 4, center: ref(1), radius: 12},
    ],
    [
      ['length', 3, 30],
      ['x', ref(1), 10],
      ['length', 3, 30],
    ],
  );
  const action = actions(
    [local],
    [segments([local]).find(s => s.id === 3)],
    new Map([
      [1, [false, true]],
      [2, [true, true]],
      [4, [true]],
    ]),
    new Set(),
    [
      {id: 1, parameters: [0, 0]},
      {id: 2, parameters: [20, 0]},
      {id: 4, parameters: [10]},
    ],
  ).find(a => a.kind === 'length');
  assert.equal(action.active, true);
  assert.deepEqual(action.create(), {
    kind: 'constrain',
    constraints: [],
    removedConstraints: [0, 2],
    data: [
      {id: 1, parameters: [0, 0]},
      {id: 2, parameters: [40, 0]},
      {id: 4, parameters: [12]},
    ],
  });
});

test('fixed captures solved positions through local aliases and never rewrites expression axes', () => {
  const local = snapshot([
    point(1, [10, 4]),
    {...point(2, [10, 4]), alias: ref(1)},
  ]);
  const fixed = actions(
    [local],
    [ref(1), ref(2)],
    new Map([[1, [false, true]]]),
  )
    .find(a => a.kind === 'fixed')
    .create();
  assert.deepEqual(fixed, {
    kind: 'constrain',
    constraints: [['fixed', ref(1)]],
    data: [{id: 1, parameters: [10, 4]}],
  });
});

test('upstream selections are read-only but named upstream points can participate in a local relation', () => {
  const base = snapshot([point(1, [0, 0])], [], 'base');
  const local = snapshot([point(1, [20, 0])]);
  assert.deepEqual(
    actions([base, local], [ref(1, 'base')], new Map(), new Set(['base'])),
    [],
  );
  assert.deepEqual(actions([base, local], [ref(1), ref(1, 'base')]), []);
  assert.deepEqual(
    actions(
      [base, local],
      [ref(1), ref(1, 'base')],
      new Map(),
      new Set(['base']),
    )
      .find(a => a.kind === 'coincident')
      .create().constraints,
    [['coincident', [ref(1), ref(1, 'base')]]],
  );
});

test('Fixed cannot silently jump a solved expression coordinate back to its authored seed', () => {
  const local = snapshot([point(1, [10, 4])]);
  const selected = actions(
    [local],
    [ref(1)],
    new Map([[1, [false, true]]]),
    new Set(),
    [{id: 1, parameters: [20, 0]}],
  );
  assert.equal(selected.find(a => a.kind === 'fixed').disabled, true);
  assert.match(selected.find(a => a.kind === 'fixed').title, /use X\/Y/);
  assert.equal(selected.find(a => a.kind === 'x').disabled, false);
});
