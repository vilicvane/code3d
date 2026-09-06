import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server,
  DrawingDimensions,
  SketchLineDrawing,
  snapSketchPointer,
  sketchGridStep;
before(async () => {
  server = await createAppTestServer();
  ({DrawingDimensions} = await server.ssrLoadModule(
    '/src/tools/drawing-dimensions.ts',
  ));
  ({SketchLineDrawing} = await server.ssrLoadModule(
    '/src/tools/sketch-drawing.ts',
  ));
  ({snapSketchPointer, sketchGridStep} = await server.ssrLoadModule(
    '/src/tools/sketch-snap.ts',
  ));
});
after(async () => server?.close());

const context = {points: [], scale: 10, gridStep: 10, enabled: true};
const free = {kind: 'cartesian'};
const position = result =>
  result.endpoint.point?.position ?? result.endpoint.position;
const near = (actual, expected) =>
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-9,
      `${actual} != ${expected}`,
    ),
  );

test('the grid uses dense 1/2/5 subdivisions at every zoom level', () => {
  for (let scale = 0.05; scale <= 1000; scale *= 1.03) {
    const step = sketchGridStep(scale);
    assert.ok(step * scale >= 8 - 1e-9 && step * scale <= 20 + 1e-9);
    const normalized = step / 10 ** Math.floor(Math.log10(step));
    assert.ok([1, 2, 5].some(value => Math.abs(value - normalized) < 1e-9));
  }
  assert.equal(sketchGridStep(6), 2);
  assert.equal(sketchGridStep(20), 0.5);
});

test('direction snapping also aligns the free axis to the grid', () => {
  const result = snapSketchPointer(
    [10.2, 3.2],
    {kind: 'polar', origin: [1, 3]},
    {
      ...context,
      gridStep: 1,
    },
  );
  assert.equal(result.hint, 'Horizontal');
  assert.deepEqual(position(result), [10, 3]);
});

test('numeric drafts preserve partial text and the last valid preview, while blank unlocks', () => {
  const fields = new DrawingDimensions([
    {id: 'length', label: 'Length', positive: true},
  ]);
  fields.set('length', '2.50');
  assert.equal(fields.value('length'), 2.5);
  for (const text of [
    '-',
    '3e',
    'NaN',
    'Infinity',
    '0x20',
    '2+3',
    '1e999',
    '0',
    '-1',
  ]) {
    fields.set('length', text);
    assert.equal(fields.text('length'), text);
    assert.ok(fields.error('length'));
    assert.equal(fields.value('length'), 2.5);
  }
  fields.set('length', '1.');
  assert.equal(fields.text('length'), '1.');
  assert.equal(fields.value('length'), 1);
  fields.set('length', '1e-4');
  assert.equal(fields.value('length'), 0.0001);
  fields.set('length', '');
  assert.equal(fields.value('length'), undefined);
  assert.equal(fields.error('length'), undefined);
  assert.equal(fields.edited, false);
});

test('snapping prioritizes real point identity, including coincident local/upstream points', () => {
  const local = {layer: 'local', id: 1, position: [10, 10]};
  const upstream = {layer: 'base', id: 1, position: [10, 10]};
  assert.equal(
    snapSketchPointer([10.2, 10.2], free, {
      ...context,
      points: [local, upstream],
    }).endpoint.point,
    local,
  );
  assert.equal(
    snapSketchPointer([10.2, 10.2], free, {...context, points: [upstream]})
      .endpoint.point,
    upstream,
  );
  assert.equal(snapSketchPointer([0.3, 0.1], free, context).hint, 'Origin');
});

test('snap tolerance is in screen pixels, with an explicit bypass', () => {
  for (const scale of [2, 10, 200]) {
    const options = {...context, scale};
    assert.equal(
      snapSketchPointer([100 + 8 / scale, 100], free, options).hint,
      'Grid',
    );
    assert.equal(
      snapSketchPointer([100 + 10 / scale, 100], free, options).hint,
      undefined,
    );
    const pointer = [100 + 8 / scale, 100];
    assert.deepEqual(
      position(snapSketchPointer(pointer, free, {...options, enabled: false})),
      pointer,
    );
  }
});

test('entered coordinates are never replaced by nearby points, even far from the origin', () => {
  const point = {layer: 'base', id: 4, position: [1e12, 20]};
  const result = snapSketchPointer(
    [1e12, 20],
    {kind: 'cartesian', x: 1e12 + 0.25, y: 20},
    {...context, points: [point]},
  );
  assert.equal(result.endpoint.point, undefined);
  assert.deepEqual(position(result), [1e12 + 0.25, 20]);
  assert.deepEqual(
    position(
      snapSketchPointer([3, 9.8], {kind: 'cartesian', x: 1.25}, context),
    ),
    [1.25, 10],
  );
});

test('length and angle project the pointer before considering compatible snaps', () => {
  const geometry = {
    kind: 'polar',
    origin: [4, 5],
    length: 10,
    direction: {kind: 'angle', degrees: 90},
  };
  assert.deepEqual(
    position(snapSketchPointer([300, 400], geometry, context)),
    [4, 15],
  );
  const incompatible = {layer: 'local', id: 1, position: [4.2, 15.2]};
  assert.equal(
    snapSketchPointer([4, 15], geometry, {...context, points: [incompatible]})
      .endpoint.point,
    undefined,
  );
  const compatible = {...incompatible, position: [4, 15]};
  assert.equal(
    snapSketchPointer([4, 15], geometry, {...context, points: [compatible]})
      .endpoint.point,
    compatible,
  );
  const horizontal = snapSketchPointer(
    [14, 5.3],
    {...geometry, direction: undefined},
    context,
  );
  assert.equal(horizontal.hint, 'Horizontal');
  assert.deepEqual(position(horizontal), [14, 5]);
  const diagonal = snapSketchPointer(
    [30, 40],
    {...geometry, origin: [0, 0], direction: {kind: 'angle', degrees: 45}},
    context,
  );
  near(position(diagonal), [Math.sqrt(50), Math.sqrt(50)]);
});

test('axis locks project onto both directions, independently of snapping and optional length', () => {
  const origin = [4, 5];
  for (const axis of ['x', 'y']) {
    const geometry = {kind: 'polar', origin, direction: {kind: 'axis', axis}};
    const options = {...context, enabled: false};
    for (const sign of [-1, 1]) {
      const pointer = [4 + sign * 30, 5 + sign * 40];
      assert.deepEqual(
        position(snapSketchPointer(pointer, geometry, options)),
        axis === 'x' ? [pointer[0], 5] : [4, pointer[1]],
      );
      assert.deepEqual(
        position(
          snapSketchPointer(pointer, {...geometry, length: 12}, options),
        ),
        axis === 'x' ? [4 + sign * 12, 5] : [4, 5 + sign * 12],
      );
    }
  }
});

test('axis locks snap the free coordinate and only reuse compatible point identities', () => {
  const geometry = {
    kind: 'polar',
    origin: [1, 2.5],
    direction: {kind: 'axis', axis: 'x'},
  };
  const grid = snapSketchPointer([10.2, 100], geometry, context);
  assert.equal(grid.hint, 'Grid');
  assert.deepEqual(position(grid), [10, 2.5]);
  const point = {layer: 'base', id: 1, position: [10, 2.5]};
  const offAxis = {layer: 'base', id: 2, position: [10.2, 2.5 + 1e-11]};
  assert.equal(
    snapSketchPointer([10.2, 100], geometry, {
      ...context,
      points: [offAxis, point],
    }).endpoint.point,
    point,
  );
  assert.equal(
    snapSketchPointer(
      [10.2, 100],
      {...geometry, length: 9.25},
      {...context, points: [point]},
    ).endpoint.point,
    undefined,
  );
  const far = {...geometry, origin: [1e12, 1e12 + 0.25]};
  assert.deepEqual(
    position(
      snapSketchPointer([1e12 + 10, 1e12], far, {
        ...context,
        points: [{...offAxis, position: [1e12 + 10, 1e12]}],
      }),
    ),
    [1e12 + 10, 1e12 + 0.25],
  );
});

test('axis toggles and angle input share one direction, keeping length and rejected drafts intact', () => {
  const draft = new SketchLineDrawing();
  draft.place({position: [0, 0]}, 'local', 1, () =>
    assert.fail('start is a preview'),
  );
  draft.pointer = [20, 30];
  draft.dimensions.set('length', '12');
  draft.dimensions.set('angle', '45');
  draft.toggleAxis('x');
  assert.equal(draft.dimensions.text('angle'), '');
  assert.equal(draft.dimensions.text('length'), '12');
  assert.deepEqual(position(draft.resolve(context)), [12, 0]);
  draft.toggleAxis('y');
  assert.deepEqual(position(draft.resolve(context)), [0, 12]);
  draft.toggleAxis('y');
  assert.equal(draft.axis, undefined);
  draft.toggleAxis('x');
  draft.dimensions.set('angle', '90');
  assert.equal(draft.axis, undefined, 'numeric angle replaces the axis lock');
  assert.deepEqual(position(draft.resolve(context)), [0, 12]);
  draft.toggleAxis('x');
  const endpoint = draft.resolve(context).endpoint;
  assert.match(
    draft.place(endpoint, 'local', 1, () => false),
    /not applied/,
  );
  assert.equal(draft.axis, 'x');
  assert.equal(
    draft.place(endpoint, 'local', 1, () => true),
    undefined,
  );
  assert.equal(
    draft.axis,
    undefined,
    'a new segment starts with no direction lock',
  );
  draft.toggleAxis('y');
  draft.reset();
  assert.equal(draft.axis, undefined, 'canceling clears the axis lock');
});

test('the two-click line draft commits new endpoints and line as one transaction', () => {
  const draft = new SketchLineDrawing();
  const edits = [];
  const commit = change => {
    edits.push(change);
    return true;
  };
  draft.dimensions.set('x', '1.5');
  draft.dimensions.set('y', '-2');
  assert.equal(
    draft.place(draft.resolve(context).endpoint, 'local', 10, commit),
    undefined,
  );
  assert.equal(edits.length, 0);
  draft.dimensions.set('length', '12');
  draft.dimensions.set('angle', '90');
  draft.pointer = [500, -600];
  assert.equal(
    draft.place(draft.resolve(context).endpoint, 'local', 10, commit),
    undefined,
  );
  assert.deepEqual(edits, [
    {
      kind: 'append',
      constraints: [
        ['x', [{layer: 'local', id: 10}, 1.5]],
        ['y', [{layer: 'local', id: 10}, -2]],
        ['length', [12, 12]],
        ['angle', [12, 90]],
      ],
      entries: [
        ['point', 10, [1.5, -2]],
        ['point', 11, [1.5, 10]],
        [
          'line',
          12,
          [
            {layer: 'local', id: 10},
            {layer: 'local', id: 11},
          ],
        ],
      ],
    },
  ]);
  assert.deepEqual(draft.start, {
    point: {layer: 'local', id: 11, position: [1.5, 10]},
  });
  assert.equal(draft.dimensions.edited, false);
  assert.deepEqual(
    draft.dimensions.definitions.map(field => field.id),
    ['length', 'angle'],
  );
  assert.equal(
    draft.place({position: [20, 10]}, 'local', 13, commit),
    undefined,
  );
  assert.deepEqual(edits[1], {
    kind: 'append',
    constraints: [],
    entries: [
      ['point', 13, [20, 10]],
      [
        'line',
        14,
        [
          {layer: 'local', id: 11},
          {layer: 'local', id: 13},
        ],
      ],
    ],
  });
  assert.deepEqual(draft.start, {
    point: {layer: 'local', id: 13, position: [20, 10]},
  });
  draft.reset();
  assert.equal(draft.start, undefined);
  assert.equal(
    edits.length,
    2,
    'ending the chain never changes completed segments',
  );
});

test('rejected edits and invalid values leave the draft editable without consuming IDs', () => {
  const draft = new SketchLineDrawing();
  const first = {point: {layer: 'base', id: 9, position: [0, 0]}};
  draft.place(first, 'local', 1, () => assert.fail('start is only a preview'));
  draft.dimensions.set('length', '-');
  assert.match(
    draft.place({position: [4, 0]}, 'local', 1, () =>
      assert.fail('invalid input'),
    ),
    /finite/,
  );
  draft.dimensions.set('length', '4');
  const edits = [];
  assert.match(
    draft.place({position: [4, 0]}, 'local', 1, change => {
      edits.push(change);
      return false;
    }),
    /not applied/,
  );
  assert.equal(draft.start, first);
  assert.equal(draft.dimensions.text('length'), '4');
  draft.place({position: [4, 0]}, 'local', 1, change => {
    edits.push(change);
    return true;
  });
  assert.deepEqual(edits[0], edits[1]);
  assert.equal(edits[0].entries[0][1], 1);
  assert.equal(edits[0].entries[1][2][0].layer, 'base');
});

test('zero-length and non-finite geometry cannot enter a source transaction', () => {
  const commit = () => assert.fail('not a valid edit');
  const line = new SketchLineDrawing();
  assert.match(
    line.place({position: [Infinity, 0]}, 'local', 1, commit),
    /finite/,
  );
  line.place({position: [0, 0]}, 'local', 1, commit);
  assert.match(
    line.place({position: [0, 0]}, 'local', 1, commit),
    /different end/,
  );
  line.reset();
  assert.equal(line.hasDraft, false);
  assert.deepEqual(
    line.dimensions.definitions.map(field => field.id),
    ['x', 'y'],
  );
});

test('only the final explicit axis or angle becomes a constraint and cancellation leaves none', () => {
  for (const axes of [['x'], ['x', 'y'], ['x', 'x'], ['y', 'x', 'x']]) {
    const draft = new SketchLineDrawing();
    const edits = [];
    draft.place({position: [0, 0]}, 'local', 1, () => true);
    draft.dimensions.set('length', '10');
    draft.dimensions.set('angle', '45');
    for (const axis of axes) draft.toggleAxis(axis);
    draft.pointer = [10, 10];
    const finalAxis = draft.axis;
    draft.place(draft.resolve(context).endpoint, 'local', 1, change => {
      edits.push(change);
      return true;
    });
    assert.deepEqual(edits[0].constraints, [
      ['length', [3, 10]],
      ...(finalAxis
        ? [[finalAxis === 'x' ? 'horizontal' : 'vertical', 3]]
        : []),
    ]);
    assert.equal(draft.axis, undefined);
    draft.toggleAxis('y');
    draft.reset();
    assert.equal(edits.length, 1);
  }
});
