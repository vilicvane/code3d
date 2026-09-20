import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observable, reaction, runInAction} from 'mobx';
import {ModelInputs} from '../src/model/inputs.ts';

test('input overrides survive declarations changing while unmodified defaults follow source', () => {
  const definitions = observable.box([
    {name: 'Width', defaultValue: 40, sourceRefs: []},
    {name: 'Height', defaultValue: 16, sourceRefs: []},
  ]);
  const inputs = new ModelInputs(() => definitions.get());
  let updates = 0;
  const stop = reaction(
    () => inputs.fields,
    () => updates++,
  );
  try {
    inputs.set('Width', 60);
    inputs.set('Height', 16);
    assert.deepEqual(inputs.values, {Width: 60});
    runInAction(() =>
      definitions.set(definitions.get().map(value => ({...value}))),
    );
    assert.equal(updates, 1, 'equivalent frames do not republish form values');
    runInAction(() =>
      definitions.set([
        {name: 'Width', defaultValue: 50, sourceRefs: []},
        {name: 'Height', defaultValue: 20, sourceRefs: []},
      ]),
    );
    assert.deepEqual(
      inputs.fields.map(field => field.value),
      [60, 20],
    );
    runInAction(() =>
      definitions.set([{name: 'Height', defaultValue: 20, sourceRefs: []}]),
    );
    inputs.set('Height', 24);
    assert.deepEqual(inputs.values, {Width: 60, Height: 24});
    inputs.reset();
    assert.deepEqual(inputs.values, {});
    assert.deepEqual(
      inputs.fields.map(field => field.value),
      [20],
    );
  } finally {
    stop();
  }
});

test('source input lookup uses rebased call locations and the smallest matching call', () => {
  const outer = {file: '/model.ts', start: 10, end: 100};
  const inner = {file: '/model.ts', start: 30, end: 60};
  const repeated = {file: '/other.ts', start: 0, end: 20};
  const inputs = new ModelInputs(() => [
    {name: 'Outer', defaultValue: 1, sourceRefs: [outer]},
    {name: 'Inner', defaultValue: 2, sourceRefs: [inner, repeated]},
  ]);
  const resolve = (ref: typeof outer) => ({
    ...ref,
    start: ref.start + 5,
    end: ref.end + 5,
  });
  assert.equal(
    inputs.atSource({file: '/model.ts', offset: 12}, resolve),
    undefined,
  );
  assert.equal(
    inputs.atSource({file: '/model.ts', offset: 35}, resolve),
    'Inner',
  );
  assert.equal(
    inputs.atSource({file: '/model.ts', offset: 90}, resolve),
    'Outer',
  );
  assert.equal(
    inputs.atSource({file: '/other.ts', offset: 10}, resolve),
    'Inner',
  );
  assert.equal(
    inputs.atSource({file: '/model.ts', offset: 35}, () => undefined),
    undefined,
  );
  const ambiguous = new ModelInputs(() => [
    {name: 'Width', defaultValue: 40, sourceRefs: [inner]},
    {name: 'Height', defaultValue: 16, sourceRefs: [inner]},
  ]);
  assert.equal(
    ambiguous.atSource({file: '/model.ts', offset: 35}, ref => ref),
    undefined,
  );
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test('live input executions keep running during edits and coalesce busy updates to the latest values', async () => {
  const inputs = new ModelInputs(() => [
    {name: 'Width', defaultValue: 40, sourceRefs: []},
    {name: 'Height', defaultValue: 16, sourceRefs: []},
  ]);
  const ready = observable.box(true);
  const runs: {values: typeof inputs.values; finish(value: boolean): void}[] =
    [];
  inputs.observeExecution(
    () => ready.get(),
    values => new Promise<boolean>(finish => runs.push({values, finish})),
  );
  try {
    inputs.set('Width', 50);
    assert.deepEqual(
      runs.map(run => run.values),
      [{Width: 50}],
    );
    inputs.set('Width', 60);
    inputs.set('Width', 70);
    inputs.set('Height', 20);
    assert.equal(
      runs.length,
      1,
      'new input does not restart an in-flight evaluation',
    );
    runs[0].finish(true);
    await settle();
    assert.deepEqual(runs[1].values, {Width: 70, Height: 20});
    inputs.set('Width', 80);
    inputs.reset();
    runs[1].finish(false);
    await settle();
    assert.deepEqual(
      runs[2].values,
      {},
      'reset replaces pending values even after a model error',
    );
    runs[2].finish(true);
    await settle();
    runInAction(() => ready.set(false));
    inputs.set('Width', 60);
    inputs.set('Width', 64);
    assert.equal(
      runs.length,
      3,
      'wait for playback or compilation without dropping edits',
    );
    runInAction(() => ready.set(true));
    assert.deepEqual(runs[3].values, {Width: 64});
    runs[3].finish(true);
    await settle();
    inputs.set('Width', 64);
    assert.equal(runs.length, 4, 'equivalent input does not re-evaluate');
  } finally {
    inputs.dispose();
  }
});

test('file changes and disposal discard queued live input work', async () => {
  const inputs = new ModelInputs(() => [
    {name: 'Width', defaultValue: 40, sourceRefs: []},
  ]);
  const runs: {finish(value: boolean): void}[] = [];
  inputs.observeExecution(
    () => true,
    () => new Promise<boolean>(finish => runs.push({finish})),
  );
  inputs.set('Width', 50);
  inputs.set('Width', 60);
  inputs.clear();
  runs[0].finish(true);
  await settle();
  assert.deepEqual(inputs.values, {});
  assert.equal(runs.length, 1);
  inputs.set('Width', 70);
  inputs.set('Width', 80);
  inputs.dispose();
  runs[1].finish(true);
  await settle();
  assert.equal(runs.length, 2);
});
