import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reaction} from 'mobx';
import {ModelAnimation} from '../src/model/animation.ts';

const settle = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let now = 0;
  let frame: (() => void) | undefined;
  const executions: {time: number; finish(value: boolean): void}[] = [];
  const animation = new ModelAnimation(
    time => new Promise(resolve => executions.push({time, finish: resolve})),
    {
      now: () => now,
      request: callback => {
        frame = callback;
        return 1;
      },
      cancel: () => {
        frame = undefined;
      },
    },
  );
  return {
    animation,
    executions,
    tick(time: number) {
      now = time;
      const callback = frame;
      frame = undefined;
      callback?.();
    },
  };
}

test('playback waits for each result, pauses at the accepted frame and resumes without a time jump', async () => {
  const {animation, executions, tick} = harness();
  const observed: number[] = [];
  const stop = reaction(
    () => animation.time,
    time => observed.push(time),
  );
  animation.play();
  tick(100);
  tick(700);
  assert.equal(executions.length, 1);
  assert.equal(animation.time, 0);
  executions[0].finish(true);
  await settle();
  tick(800);
  assert.equal(executions[1].time, 0.8);
  animation.pause();
  executions[1].finish(true);
  await settle();
  tick(10_000);
  assert.equal(executions.length, 2);
  animation.play();
  tick(10_100);
  assert.equal(executions[2].time, 0.9);
  executions[2].finish(true);
  await settle();
  assert.deepEqual(observed, [0.1, 0.8, 0.9]);
  animation.stop();
  stop();
});

test('reset during execution runs zero next, while source changes discard old frames and queued resets', async () => {
  const {animation, executions, tick} = harness();
  animation.play();
  tick(100);
  animation.reset();
  animation.reset();
  assert.equal(executions.length, 1);
  executions[0].finish(true);
  await settle();
  assert.equal(executions[1].time, 0);
  executions[1].finish(true);
  await settle();
  assert.equal(animation.time, 0);
  assert.equal(animation.playing, false);
  animation.play();
  tick(200);
  animation.reset();
  animation.stop(true);
  executions[2].finish(true);
  await settle();
  tick(500);
  assert.equal(executions.length, 3);
  assert.equal(animation.time, 0);
  assert.equal(animation.pending, false);
});

test('failed execution stops playback at the last accepted time', async () => {
  const {animation, executions, tick} = harness();
  animation.play();
  tick(100);
  executions[0].finish(true);
  await settle();
  tick(200);
  executions[1].finish(false);
  await settle();
  tick(300);
  assert.equal(animation.time, 0.1);
  assert.equal(animation.playing, false);
  assert.equal(executions.length, 2);
});
