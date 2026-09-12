import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reaction, observable, runInAction} from 'mobx';
import type {CompilationPhase} from '../src/model/compilation-progress.ts';
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
  state.activate('/model.ts');
  const first = state.begin(1);
  assert.equal(state.isCurrent(first, 1), true);
  assert.equal(state.isCurrent(first, 2), false);
  const second = state.begin(1);
  assert.equal(state.isCurrent(first, 1), false);
  assert.equal(state.isCurrent(second, 1), true);
  state.activate('/other.ts');
  state.activate('/model.ts');
  assert.equal(state.isCurrent(second, 1), false);
  const reloaded = state.begin(1);
  state.activate('/model.ts', true);
  assert.equal(state.isCurrent(reloaded, 1), false);
});

test('same-file failure retains the display while empty success replaces it', () => {
  const state = new ModelPreviewState();
  state.activate('/model.ts');
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

test('file handovers retain presentation without exposing another file as an editable result', () => {
  const state = new ModelPreviewState();
  const displays: boolean[] = [];
  const stop = reaction(
    () => state.empty,
    value => displays.push(value),
    {fireImmediately: true},
  );
  state.activate('/model.ts');
  state.accept(state.begin(1), emptyModule);
  state.observeTarget(true);
  state.presented(false);
  state.activate('/next/other.ts');
  assert.equal(state.module, null);
  assert.equal(state.sourceVersion, undefined);
  assert.equal(state.retainingView, true);
  state.observeTarget(true);
  assert.equal(
    state.hasPreviewedTarget,
    false,
    'the old view does not dismiss the new file hint',
  );
  state.activate('/next/third.ts');
  assert.equal(
    state.retainingView,
    true,
    'rapid switches retain the original view',
  );
  state.accept(state.begin(1), emptyModule);
  assert.equal(
    state.retainingView,
    true,
    'presentation remains until the replacement is rendered',
  );
  state.presented(false);
  assert.equal(
    state.empty,
    true,
    'an empty result releases the old presentation',
  );
  assert.deepEqual(displays, [true, false, true]);
  state.showStatus('ready', 'Ready');
  assert.equal(state.showHint, true);
  stop();
});

test('file failure, closing the last file and project reset discard retained presentation', () => {
  const state = new ModelPreviewState();
  for (const end of ['failure', 'close', 'reset']) {
    state.activate('/model.ts');
    state.accept(state.begin(1), emptyModule);
    state.observeTarget(true);
    state.presented(false);
    state.activate('/broken.ts');
    assert.equal(state.retainingView, true);
    if (end === 'failure')
      state.fail({kind: 'syntax', summary: 'Incomplete statement'});
    else if (end === 'close') state.activate(undefined);
    else state.activate('/broken.ts', true);
    assert.equal(state.module, null);
    assert.equal(state.retainingView, false);
    assert.equal(state.hasPreviewedTarget, false);
  }
});

test('an evaluated tool failure remains editable and source transactions suspend its version', () => {
  const state = new ModelPreviewState();
  state.activate('/model.ts');
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

test('pending input stays busy without a visible label; compilation derives current phases', () => {
  const phase = observable.box<CompilationPhase | undefined>(undefined);
  const state = new ModelPreviewState(() => phase.get());
  state.showStatus('busy');
  assert.equal(state.busy, true);
  assert.equal(state.presentation.label, undefined);
  assert.equal(state.showHint, false);
  const labels: (string | undefined)[] = [];
  const stop = reaction(
    () => state.presentation.label,
    label => labels.push(label),
  );
  state.beginCompilation();
  runInAction(() => phase.set('reading-files'));
  assert.equal(state.presentation.label, 'Reading files');
  runInAction(() => phase.set('preparing-preview'));
  assert.equal(state.presentation.label, 'Preparing preview');
  assert.equal(state.presentation.delay, 200);
  state.showStatus('ready', 'Ready');
  runInAction(() => phase.set('resolving-imports'));
  assert.equal(state.presentation.label, 'Ready');
  assert.equal(state.presentation.delay, 0);
  state.beginCompilation('center');
  assert.equal(state.presentation.label, 'Resolving imports · center');
  state.showStatus('busy');
  runInAction(() => phase.set('preparing-preview'));
  assert.equal(state.presentation.label, undefined);
  stop();
  assert.ok(labels.includes('Preparing preview'));
});
