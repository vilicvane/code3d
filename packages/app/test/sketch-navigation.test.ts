import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {reaction} from 'mobx';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let SketchNavigation: typeof import('../src/ui/sketch-navigation.ts').SketchNavigation;
before(async () => {
  server = await createAppTestServer();
  ({SketchNavigation} = await server.ssrLoadModule<
    typeof import('../src/ui/sketch-navigation.ts')
  >('/src/ui/sketch-navigation.ts'));
});
after(() => server.close());

function navigation() {
  let time = 0;
  let next = 0;
  const frames = new Map<number, (time: number) => void>();
  const clock = {
    reduce: false,
    now: () => time,
    reducedMotion: () => clock.reduce,
    requestFrame(callback: (time: number) => void) {
      frames.set(++next, callback);
      return next;
    },
    cancelFrame: (id: number) => {
      frames.delete(id);
    },
  };
  return {
    view: new SketchNavigation(clock),
    clock,
    frames,
    tick(value: number) {
      time = value;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(time));
    },
  };
}

test('sketch views interpolate scale geometrically and retain independent pan/zoom through updates', () => {
  const {view, tick} = navigation();
  const grids: Array<number | undefined> = [];
  const stop = reaction(
    () => view.gridStep,
    value => grids.push(value),
    {fireImmediately: true},
  );
  view.activate('file-a:execution-1', {center: [0, 0], scale: 2});
  view.activate('file-a:execution-2', {center: [30, 60], scale: 8});
  tick(150);
  assert.deepEqual(view.pose, {center: [15, 30], scale: 4});
  tick(300);
  view.pan([31, 62]);
  view.activate('file-a:execution-2', {center: [500, 600], scale: 99});
  assert.deepEqual(
    view.pose,
    {center: [31, 62], scale: 8},
    'geometry updates keep the view',
  );
  view.activate('file-a:execution-1', {center: [100, 100], scale: 30});
  tick(600);
  assert.deepEqual(view.pose, {center: [0, 0], scale: 2});
  view.activate('file-a:execution-2', {center: [100, 100], scale: 30});
  tick(900);
  assert.deepEqual(view.pose, {center: [31, 62], scale: 8});
  assert.deepEqual(grids.slice(0, 4), [undefined, 5, 2, 1]);
  stop();
  view.reset();
});

test('rapid switches start from the displayed pose and remember interrupted destinations', () => {
  const {view, tick} = navigation();
  view.activate('a', {center: [0, 0], scale: 2});
  view.activate('b', {center: [30, 60], scale: 8});
  tick(150);
  const displayed = view.pose;
  view.activate('c', {center: [-10, -20], scale: 0.5});
  assert.deepEqual(view.pose, displayed);
  tick(450);
  view.activate('b', {center: [0, 0], scale: 99});
  tick(750);
  assert.deepEqual(view.pose, {center: [30, 60], scale: 8});
});

test('wheel and pan take over mid-transition without later animation writes', () => {
  const {view, tick, frames} = navigation();
  view.activate('a', {center: [0, 0], scale: 2});
  view.activate('b', {center: [30, 60], scale: 8});
  tick(150);
  view.zoom(2, [25, 40]);
  assert.deepEqual(view.pose, {center: [20, 35], scale: 8});
  assert.equal(frames.size, 0);
  tick(400);
  assert.deepEqual(view.pose, {center: [20, 35], scale: 8});
  view.fit({center: [0, 0], scale: 2});
  tick(550);
  view.interrupt();
  view.pan([5, -5]);
  tick(900);
  assert.deepEqual(view.pose, {center: [5, -5], scale: 4});
});

test('hidden views stop frames and restore immediately; reset separates project lifetimes', () => {
  const {view, tick, frames} = navigation();
  view.activate('a', {center: [0, 0], scale: 2});
  view.activate('b', {center: [30, 60], scale: 8});
  tick(150);
  view.hide();
  assert.equal(view.gridStep, undefined);
  assert.equal(frames.size, 0);
  view.activate('b', {center: [0, 0], scale: 99});
  assert.deepEqual(view.pose, {center: [30, 60], scale: 8});
  assert.equal(frames.size, 0, 'no same-type view was visible');
  view.reset();
  view.activate('b', {center: [1, 2], scale: 3});
  assert.deepEqual(view.pose, {center: [1, 2], scale: 3});
});

test('reduced motion skips transitions and takes effect during an active animation', () => {
  const {view, tick, frames, clock} = navigation();
  view.activate('a', {center: [0, 0], scale: 2});
  view.activate('b', {center: [30, 60], scale: 8});
  clock.reduce = true;
  tick(50);
  assert.deepEqual(view.pose, {center: [30, 60], scale: 8});
  assert.equal(frames.size, 0);
  view.activate('c', {center: [4, 5], scale: 6});
  assert.deepEqual(view.pose, {center: [4, 5], scale: 6});
  assert.equal(frames.size, 0);
});
