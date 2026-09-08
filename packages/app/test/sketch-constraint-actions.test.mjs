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

test('line relations check the whole selection, deduplicate intervals, and distinguish orientation from relative angle', () => {
  const local = lines();
  const picks = segments([local]);
  const selected = actions([local], picks);
  assert.deepEqual(
    selected.find(a => a.kind === 'parallel').create().constraints,
    [['parallel', [5, 6]]],
  );
  assert.deepEqual(
    selected.find(a => a.kind === 'perpendicular').create().constraints,
    [['perpendicular', [5, 6]]],
  );
  assert.deepEqual(
    selected.find(a => a.kind === 'angle').create(-45).constraints,
    [['angle', [5, 6], -45]],
  );
  assert.deepEqual(
    selected.find(a => a.kind === 'orientation').create(45).constraints,
    [
      ['angle', 5, 45],
      ['angle', 6, 45],
    ],
  );
  const three = {
    ...local,
    entities: [
      ...local.entities,
      point(8, [0, 20]),
      point(9, [20, 20]),
      {kind: 'line', id: 10, points: [ref(8), ref(9)]},
    ],
  };
  const multi = actions([three], segments([three]).reverse());
  assert.deepEqual(
    multi.find(a => a.kind === 'parallel').create().constraints,
    [
      ['parallel', [5, 6]],
      ['parallel', [5, 10]],
    ],
  );
  assert.ok(!multi.some(a => a.kind === 'perpendicular' || a.kind === 'angle'));
  const mixed = actions([three], [...segments([three]), ref(1)]);
  assert.ok(
    !mixed.some(
      a =>
        a.kind === 'parallel' ||
        a.kind === 'perpendicular' ||
        a.kind === 'angle',
    ),
  );
});

test('one selected line removes touching pair constraints separately from orientation and highlights both partners', () => {
  const local = {
    ...lines(),
    constraints: [
      ['parallel', [6, 5]],
      ['angle', [5, 6], 0],
      ['angle', 5, 0],
    ],
  };
  const selected = actions([local], [segments([local])[0]]);
  for (const [kind, index] of [
    ['parallel', 0],
    ['angle', 1],
    ['orientation', 2],
  ]) {
    const action = selected.find(a => a.kind === kind);
    assert.deepEqual(action.create().removedConstraints, [index]);
    assert.equal(action.active, true);
    if (kind !== 'orientation') assert.ok(action.related.some(p => p.id === 6));
  }
  assert.equal(selected.find(a => a.kind === 'angle').dimension, undefined);
  const pair = actions([local], segments([local]));
  assert.equal(
    pair.find(a => a.kind === 'angle').dimension.label,
    'Angle between lines',
  );
});

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
    ['horizontal', 'vertical', 'length', 'orientation'],
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
      .create().removedConstraints,
    [0],
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

test('mixed geometry removes the union of existing kinds without adding to a filtered subset', () => {
  const local = {
    ...lines(),
    constraints: [
      ['horizontal', 5],
      ['length', 6, 20],
      ['fixed', ref(7)],
      ['midpoint', [ref(7), ref(1), ref(2)]],
    ],
  };
  const selected = actions([local], [ref(7), ...segments([local])]);
  assert.deepEqual(
    new Set(selected.map(a => a.kind)),
    new Set(['horizontal', 'length', 'fixed', 'midpoint']),
  );
  for (const [kind, index] of [
    ['horizontal', 0],
    ['length', 1],
    ['fixed', 2],
    ['midpoint', 3],
  ]) {
    const action = selected.find(a => a.kind === kind);
    assert.equal(action.active, 'mixed');
    assert.equal(action.disabled, false);
    assert.deepEqual(action.create().constraints, []);
    assert.deepEqual(action.create().removedConstraints, [index]);
    assert.match(action.title, /^Remove/);
  }
  const center = actions([local], [ref(7)]).find(a => a.kind === 'midpoint');
  assert.deepEqual(center.related, [ref(7), ref(1), ref(2)]);
});

test('unselected relation partners and unrelated selected upstream elements do not prevent local removal', () => {
  const base = snapshot(
    [point(1, [0, 0])],
    [['fixed', ref(1, 'base')]],
    'base',
  );
  const local = snapshot(
    [point(2, [0, 0]), point(3, [10, 0])],
    [
      ['coincident', [ref(2), ref(1, 'base')]],
      ['x', ref(3), 10],
    ],
  );
  const selected = actions([base, local], [ref(2), ref(3), ref(1, 'base')]);
  assert.deepEqual(
    new Set(selected.map(a => a.kind)),
    new Set(['coincident', 'x']),
  );
  assert.deepEqual(
    selected.find(a => a.kind === 'coincident').create().removedConstraints,
    [0],
  );
  assert.equal(
    selected.some(a => a.kind === 'fixed'),
    false,
  );
  const named = actions(
    [base, local],
    [ref(2), ref(1, 'base')],
    new Map(),
    new Set(['base']),
  );
  assert.deepEqual(
    named.map(a => a.kind),
    ['coincident'],
  );
});
