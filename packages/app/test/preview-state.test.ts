import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ModelModule} from '../src/model/compiler.ts';
import {ModelPreviewState} from '../src/model/preview-state.ts';

const emptyModule: ModelModule = {
  sketches: new Map(),
  warnings: [],
  objects: new Map(),
  operations: new Map(),
  toolNodeIds: new Set(),
  exports: new Map(),
  catalog: [],
  sourceTargets: [],
  evaluationContexts: [],
  designArguments: [],
};

test('requests expire on source changes, superseding runs, and switching away and back', () => {
  const state = new ModelPreviewState();
  state.activate('/model.ts', () => {});
  const first = state.begin(1);
  assert.equal(state.isCurrent(first, 1), true);
  assert.equal(state.isCurrent(first, 2), false);
  const second = state.begin(1);
  assert.equal(state.isCurrent(first, 1), false);
  assert.equal(state.isCurrent(second, 1), true);
  state.activate('/other.ts', () => {});
  state.activate('/model.ts', () => {});
  assert.equal(state.isCurrent(second, 1), false);
  const reloaded = state.begin(1);
  state.activate('/model.ts', () => {}, true);
  assert.equal(state.isCurrent(reloaded, 1), false);
});

test('same-file failure retains the display while empty success replaces it', () => {
  const state = new ModelPreviewState();
  state.activate('/model.ts', () => {});
  const warning = {
    kind: 'evaluation',
    summary: 'Warning',
    severity: 'warning',
  } as const;
  const previous = {...emptyModule, warnings: [warning]};
  state.accept(state.begin(1), previous);
  state.observeTarget(true);
  state.begin(2);
  state.fail({kind: 'syntax', summary: 'Incomplete statement'});
  assert.equal(state.module, previous);
  assert.equal(state.sourceVersion, undefined);
  assert.equal(state.status, 'error');
  assert.deepEqual(state.warnings, []);
  assert.equal(state.hasPreviewedTarget, true);
  state.accept(state.begin(3), emptyModule);
  assert.equal(state.module, emptyModule);
  assert.equal(state.sourceVersion, 3);
  assert.equal(state.status, 'ready');
  assert.equal(state.diagnostic, undefined);
  assert.equal(state.hasPreviewedTarget, true);
});

test('a new file clears old results and ignores targets reported while disposing the old view', () => {
  const state = new ModelPreviewState();
  state.activate('/model.ts', () => {});
  state.accept(state.begin(1), emptyModule);
  state.observeTarget(true);
  state.activate('/broken.ts', () => {
    assert.equal(state.module, null);
    state.observeTarget(true);
  });
  state.begin(1);
  state.fail({kind: 'syntax', summary: 'Incomplete statement'});
  assert.equal(state.module, null);
  assert.equal(state.hasPreviewedTarget, false);
  state.activate(undefined, () => state.observeTarget(true));
  state.observeTarget(true);
  assert.equal(state.status, 'ready');
  assert.equal(state.diagnostic, undefined);
  assert.equal(state.hasPreviewedTarget, false);
});

test('an evaluated tool failure remains editable and source transactions suspend its version', () => {
  const state = new ModelPreviewState();
  state.activate('/model.ts', () => {});
  state.accept(state.begin(1), {
    ...emptyModule,
    diagnostic: {kind: 'evaluation', summary: 'Invalid parameter'},
  });
  assert.equal(state.status, 'error');
  assert.equal(state.sourceVersion, 1);
  assert.throws(
    () =>
      state.editSource(() => {
        assert.equal(state.sourceVersion, undefined);
        throw new Error('Edit failed');
      }),
    /Edit failed/,
  );
  assert.equal(state.sourceVersion, 1);
});
