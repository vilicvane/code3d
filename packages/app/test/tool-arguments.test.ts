import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SourceTarget} from '../src/model/compiler.ts';
import {sourceParameterAt} from '../src/model/tool-arguments.ts';

const target: SourceTarget = {
  id: 'call',
  kind: 'tool',
  sourceRef: {file: '/model.ts', start: 0, end: 30},
  evaluations: [],
  contextTargetIds: [],
  tool: {
    callId: 'box',
    signature: {
      id: 'box',
      name: 'box',
      parameters: ['x', 'y'].map((name, index) => ({
        name,
        index,
        optional: false,
        label: name,
        actions: [],
        kind: 'length',
      })),
    },
    arguments: ['x', 'y'].map((name, index) => {
      const sourceRef = {
        file: '/model.ts',
        start: 10 + index * 4,
        end: 12 + index * 4,
      };
      return {
        name,
        index,
        presence: 'present',
        target: {kind: 'present', sourceRef, removalSourceRef: sourceRef},
      };
    }),
  },
};

test('argument boundaries distinguish occurrences and files', () => {
  assert.equal(sourceParameterAt(target, '/model.ts', 10)?.name, 'x');
  assert.equal(sourceParameterAt(target, '/model.ts', 12)?.name, 'x');
  assert.equal(sourceParameterAt(target, '/model.ts', 13), undefined);
  assert.equal(sourceParameterAt(target, '/model.ts', 14)?.name, 'y');
  assert.equal(sourceParameterAt(target, '/other.ts', 14), undefined);
  assert.equal(sourceParameterAt(target, '/model.ts', 1), undefined);
});

test('focus follows tracked argument ranges and rejects invalidated source', () => {
  assert.equal(
    sourceParameterAt(target, '/model.ts', 34, ref => ({
      ...ref,
      start: ref.start + 20,
      end: ref.end + 20,
    }))?.name,
    'y',
  );
  assert.equal(
    sourceParameterAt(target, '/model.ts', 14, () => undefined),
    undefined,
  );
});

test('an available omitted argument has a caret position while unknown spreads do not', () => {
  const omitted: SourceTarget = {
    ...target,
    tool: {
      ...target.tool!,
      arguments: [
        {
          name: 'x',
          index: 0,
          presence: 'omitted',
          target: {
            kind: 'omitted',
            sourceRef: {file: '/model.ts', start: 11, end: 11},
            needsComma: false,
          },
        },
        {name: 'y', index: 1, presence: 'unknown'},
      ],
    },
  };
  assert.equal(sourceParameterAt(omitted, '/model.ts', 11)?.name, 'x');
  assert.equal(sourceParameterAt(omitted, '/model.ts', 12), undefined);
});
