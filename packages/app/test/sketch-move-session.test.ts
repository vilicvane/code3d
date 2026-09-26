import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {observable, reaction, runInAction} from 'mobx';
import type {SketchPosition, SketchSnapshot} from '@code3d/core/tooling';
import type {SketchDragPreview} from '../src/model/sketch-drag.ts';
import type {SketchMoveSolve} from '../src/tools/sketch-move-session.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let SketchMoveSession: typeof import('../src/tools/sketch-move-session.ts').SketchMoveSession;
before(async () => {
  server = await createAppTestServer();
  ({SketchMoveSession} = await server.ssrLoadModule<
    typeof import('../src/tools/sketch-move-session.ts')
  >('/src/tools/sketch-move-session.ts'));
});
after(() => server.close());
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const ref = (id: number) => ({layer: 'local', id});
const initial: SketchSnapshot = {
  id: 'local',
  entities: [
    {kind: 'point', id: 1, position: [-20, 0]},
    {kind: 'point', id: 2, position: [20, 0]},
    {kind: 'line', id: 3, points: [ref(1), ref(2)]},
    {kind: 'point', id: 4, position: [10, 10]},
  ],
  constraints: [],
  redundant: [],
  degreesOfFreedom: 8,
};
function setup(layers: readonly SketchSnapshot[] = [initial]) {
  const settings = observable({enabled: true, scale: 100, gridStep: 1});
  const calls: {
    args: Parameters<SketchMoveSolve>;
    resolve: (result: SketchDragPreview) => void;
    reject: (error: Error) => void;
  }[] = [];
  const session = new SketchMoveSession(
    {...ref(4), position: [10, 10]},
    'point',
    [10, 10],
    layers,
    new Set(),
    () => ({...settings}),
    (...args) =>
      new Promise((resolve, reject) => calls.push({args, resolve, reject})),
  );
  const preview = (
    position: SketchPosition,
    constraints: SketchSnapshot['constraints'] = [],
  ): SketchDragPreview => ({
    snapshot: {
      ...initial,
      constraints,
      entities: initial.entities.map(e =>
        e.kind === 'point' && e.id === 4 ? {...e, position} : e,
      ),
    },
    data: [{id: 4, parameters: position}],
    reference: initial,
    constraints,
  });
  return {session, settings, calls, preview};
}

test('superseded successes and errors publish neither geometry nor diagnostics', async () => {
  for (const fail of [false, true]) {
    const {session, calls, preview} = setup();
    const seen: Array<SketchDragPreview | undefined> = [];
    const errors: Array<string | undefined> = [];
    const stop = reaction(
      () => session.preview,
      value => seen.push(value),
    );
    const stopError = reaction(
      () => session.error,
      value => errors.push(value),
    );
    session.move([7, 0.02]);
    session.move([8, 5.3]);
    assert.equal(calls.length, 1, 'solves are serialized');
    if (fail) calls[0].reject(new Error('old conflict'));
    else calls[0].resolve(preview([7, 0], [['pointOn', [ref(4), 3]]]));
    await flush();
    assert.equal(calls.length, 2);
    assert.equal(session.preview, undefined);
    assert.equal(session.error, undefined);
    assert.equal(
      calls[1].args[2],
      undefined,
      'obsolete relation previews never become continuation seeds',
    );
    assert.deepEqual(calls[1].args[4], []);
    const result = preview([8, 5.3]);
    calls[1].resolve(result);
    await flush();
    assert.deepEqual(seen, [result]);
    assert.deepEqual(errors, []);
    assert.equal(session.pending, false);
    stop();
    stopError();
    session.dispose();
  }
});

test('release freezes the final pointer and modifier together while awaiting the latest solve', async () => {
  const {session, settings, calls, preview} = setup();
  session.move([7, 0.02]);
  assert.equal(session.snap?.hint, 'On curve');
  let finished = false;
  let completion!: Promise<void>;
  runInAction(() => {
    settings.enabled = false;
    completion = session.release([8, 0.02]).then(() => {
      finished = true;
    });
  });
  runInAction(() => {
    settings.enabled = true;
    settings.scale = 2;
  });
  assert.equal(session.snap?.hint, undefined);
  calls[0].resolve(preview([7, 0], [['pointOn', [ref(4), 3]]]));
  await flush();
  assert.equal(finished, false);
  assert.equal(calls.length, 2);
  assert.ok(
    calls[1].args[1].every(
      (coordinate, axis) => Math.abs(coordinate - [8, 0.02][axis]) < 1e-12,
    ),
  );
  assert.deepEqual(calls[1].args[4], []);
  const result = preview([8, 0.02]);
  calls[1].resolve(result);
  await completion;
  assert.equal(session.preview, result);
  assert.equal(calls.length, 2);
  session.dispose();
});

test('release without movement remains selection when canvas changes alter its world position', async () => {
  const {session, calls} = setup();
  await session.release([8, 0.02]);
  assert.equal(calls.length, 0);
  assert.equal(session.snap, undefined);
  assert.equal(session.preview, undefined);
  assert.equal(session.pending, false);
  assert.equal(session.released, true);
  session.dispose();
});

test('snapping and zoom update the same candidate without pointer movement', async () => {
  const {session, settings, calls, preview} = setup();
  session.move([7, 0.2]);
  assert.equal(session.snap?.hint, undefined);
  calls[0].resolve(preview([7, 0.2]));
  await flush();
  runInAction(() => {
    settings.scale = 20;
  });
  assert.equal(session.snap?.hint, 'On curve');
  assert.deepEqual(calls[1].args[4], [['pointOn', [session.target, 3]]]);
  calls[1].resolve(preview([7, 0], [['pointOn', [ref(4), 3]]]));
  await flush();
  runInAction(() => {
    settings.enabled = false;
  });
  assert.equal(session.snap?.hint, undefined);
  calls[2].resolve(preview([7, 0.2]));
  await flush();
  const completion = session.release([7, 0.2]);
  await completion;
  assert.equal(calls.length, 3);
  session.dispose();
});

test('disposing pending or released gestures rejects late publication and unsubscribes settings', async () => {
  for (const released of [false, true]) {
    const {session, settings, calls, preview} = setup();
    session.move([7, 0.02]);
    const completion = released ? session.release([7, 0.02]) : undefined;
    session.dispose();
    runInAction(() => {
      settings.enabled = false;
    });
    calls[0].resolve(preview([7, 0]));
    await completion;
    await flush();
    assert.equal(session.preview, undefined);
    assert.equal(session.error, undefined);
    assert.equal(session.pending, false);
    assert.equal(calls.length, 1);
  }
});

test('candidate origin and targets share the gesture-start scene, independent of previews', async () => {
  const layer: SketchSnapshot = {
    ...initial,
    entities: [
      ...initial.entities.filter(entity => entity.id !== 3),
      {kind: 'line', id: 5, points: [ref(2), ref(4)]},
    ],
  };
  const {session, calls, preview} = setup([layer]);
  session.move([8, 0.01]);
  assert.equal(session.snap?.hint, 'Horizontal');
  const moved = preview([8, 0]);
  calls[0].resolve({
    ...moved,
    snapshot: {
      ...layer,
      entities: layer.entities.map(e =>
        e.id === 2 && e.kind === 'point' ? {...e, position: [20, 5]} : e,
      ),
    },
  });
  await flush();
  assert.equal(
    calls.length,
    1,
    'publishing a preview never queues another solve',
  );
  session.move([9, 0.01]);
  assert.equal(session.snap?.hint, 'Horizontal');
  assert.deepEqual(calls[1].args[1], [9, 0]);
  assert.deepEqual(calls[1].args[4], [['horizontal', 5]]);
  calls[1].resolve(preview([9, 0]));
  await flush();
  session.dispose();
});

test('a current rejected request retains the last valid geometry and releases with its error', async () => {
  const {session, calls, preview} = setup();
  session.move([7, 3]);
  const valid = preview([7, 3]);
  calls[0].resolve(valid);
  await flush();
  session.move([7, 0.02]);
  const completion = session.release([7, 0.02]);
  calls[1].reject(new Error('new conflict'));
  await completion;
  assert.equal(session.preview, valid);
  assert.equal(session.error, 'new conflict');
  session.dispose();
});

test('a request in the drain completion microtask starts a new solve and release waits for it', async () => {
  const {session, calls, preview} = setup();
  session.move([7, 3]);
  calls[0].resolve(preview([7, 3]));
  let completion!: Promise<void>;
  queueMicrotask(() => {
    completion = session.release([8, 3]);
  });
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(session.pending, true);
  let finished = false;
  void completion.then(() => {
    finished = true;
  });
  await flush();
  assert.equal(finished, false);
  const result = preview([8, 3]);
  calls[1].resolve(result);
  await completion;
  assert.equal(session.preview, result);
  assert.equal(session.pending, false);
  session.dispose();
});
