import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let drawing: typeof import('../src/tools/sketch-drawing.ts');
let history: typeof import('../src/tools/sketch-drawing-history.ts');
before(async () => {
  server = await createAppTestServer();
  drawing = await server.ssrLoadModule('/src/tools/sketch-drawing.ts');
  history = await server.ssrLoadModule('/src/tools/sketch-drawing-history.ts');
});
after(async () => server?.close());

test('rejected placements do not consume history or overwrite the last valid numeric draft', () => {
  const line = new drawing.SketchLineDrawing();
  const steps = new history.SketchDrawingHistory();
  let version = 10;
  const place = (x: number, accepted = true) =>
    steps.place(
      line,
      {version: () => version, checkpoint: () => () => {}},
      () =>
        line.place({position: [x, 0]}, 'local', 1, () => {
          if (accepted) version++;
          return accepted;
        }),
    );
  place(0);
  line.dimensions.set('length', '12');
  assert.match(place(12, false)!, /not applied/);
  assert.equal(line.dimensions.text('length'), '12');
  line.dimensions.set('length', '1e');
  assert.match(place(12)!, /finite/);
  assert.equal(line.dimensions.value('length'), 12);
  assert.equal(steps.run('undo'), true);
  assert.equal(line.title, 'Start point');
  assert.equal(version, 10);
  assert.equal(steps.run('redo'), true);
  assert.equal(line.title, 'Next point');
  assert.equal(line.dimensions.text('length'), '');
});

test('source history identity survives grouped formatting and rejects unrelated transactions', () => {
  const line = new drawing.SketchLineDrawing();
  const steps = new history.SketchDrawingHistory();
  let version = 10;
  let geometry = 'empty';
  const place = (x: number) =>
    steps.place(
      line,
      {
        version: () => version,
        checkpoint: () => {
          const saved = geometry;
          return () => {
            geometry = saved;
          };
        },
      },
      () =>
        line.place({position: [x, 0]}, 'local', 1, () => {
          version++;
          geometry = 'line';
          return true;
        }),
    );
  place(0);
  line.toggleAxis('x');
  line.dimensions.set('length', '12');
  place(12);
  version = 15; // Formatting / safe geometry repair belongs to the same source group.
  assert.equal(steps.run('undo'), false);
  assert.equal(steps.sourceChanged('undo', {before: version, after: 9}), false);
  assert.equal(geometry, 'line');
  assert.equal(steps.sourceChanged('undo', {before: version, after: 10}), true);
  assert.equal(geometry, 'empty');
  assert.equal(line.axis, 'x');
  assert.equal(line.dimensions.text('length'), '12');
  assert.deepEqual(line.start, {position: [0, 0]});
  assert.equal(steps.sourceChanged('redo', {before: 10, after: 15}), true);
  assert.equal(geometry, 'line');
  assert.equal(version, 15, 'view checkpoints never perform source edits');
  assert.deepEqual(line.start, {
    point: {layer: 'local', id: 2, position: [12, 0]},
  });
  steps.clear();
  assert.equal(steps.sourceChanged('undo', {before: 15, after: 10}), false);
});

test('starting a replacement draft discards its old source redo without creating another source edit', () => {
  const line = new drawing.SketchLineDrawing();
  const steps = new history.SketchDrawingHistory();
  let version = 1;
  const place = (x: number) =>
    steps.place(
      line,
      {version: () => version, checkpoint: () => () => {}},
      () =>
        line.place({position: [x, 0]}, 'local', 1, () => {
          version++;
          return true;
        }),
    );
  place(0);
  place(10);
  steps.sourceChanged('undo', {before: 2, after: 1});
  version = 1;
  steps.run('undo');
  place(20);
  assert.equal(
    steps.run('redo'),
    true,
    'old source redo must not replace the new anchor',
  );
  assert.deepEqual(line.start, {position: [20, 0]});
  assert.equal(version, 1);
});
