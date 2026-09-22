import assert from 'node:assert/strict';
import {test} from 'node:test';
import {align, box, cut, group, rectangle, union} from '@code3d/core';
import {createModelSnapshotter} from './model-test.ts';

test('metadata snapshots isolate symbol namespaces and updates across model branches', () => {
  const label = Symbol('label');
  const otherLabel = Symbol('label');
  const source = box(8, 6, 4);
  const values = {[label]: {name: 'part'}, [otherLabel]: 'another package'};
  const original = source.withMetadata(values);
  const shifted = original.originOffset(2, 3, 4).rotate(0, 25, 0).scaled(2);
  const edited = shifted.withMetadata({[label]: {name: 'updated'}});
  values[otherLabel] = 'changed input dictionary';

  assert.deepEqual(source.metadata, {});
  assert.deepEqual(original.metadata[label], {name: 'part'});
  assert.deepEqual(shifted.metadata[label], {name: 'part'});
  assert.deepEqual(edited.metadata[label], {name: 'updated'});
  assert.equal(edited.metadata[otherLabel], 'another package');
  assert.equal(shifted.metadata[label], original.metadata[label]);
  assert.deepEqual(original.bounds().size, [8, 6, 4]);
  assert.deepEqual(edited.bounds(), shifted.bounds());
});

test('relations, exposed references and group copies retain their own metadata', () => {
  const key = Symbol('owner');
  const source = box(8, 6, 4).withMetadata({[key]: 'part'});
  const target = box(1, 1, 1);
  const exposed = source.expose({attachment: source.origin});
  const related = exposed
    .relate(self => align(self.frame, target.frame))
    .material('#abc');
  assert.equal(related.metadata[key], 'part');
  assert.ok(related.attachment);
  const assembly = group([related]);
  assert.deepEqual(assembly.metadata, {});
  const taggedAssembly = assembly.withMetadata({[key]: 'assembly'});
  assert.equal(taggedAssembly.originOffset(1, 2, 3).metadata[key], 'assembly');
  assert.equal(related.metadata[key], 'part');

  // Arbitrary in-process values do not enter the render/Worker snapshot.
  const local = taggedAssembly.withMetadata({[Symbol('callback')]: () => 1});
  const snapshot = createModelSnapshotter()(local);
  assert.equal('metadata' in snapshot, false);
  assert.doesNotThrow(() => structuredClone(snapshot));
});

test('geometry derivations inherit the primary input without merging other packages data', () => {
  const key = Symbol('owner');
  const toolKey = Symbol('tool');
  const stock = box(8, 6, 4).withMetadata({[key]: 'stock'});
  const tool = box(2, 8, 2).withMetadata({[key]: 'tool', [toolKey]: true});
  const result = cut(stock, [tool]);
  assert.equal(result.metadata[key], 'stock');
  assert.equal(result.metadata[toolKey], undefined);
  assert.equal(union([tool, stock]).metadata[key], 'tool');
  const face = rectangle(4, 6).withMetadata({[key]: 'profile'});
  assert.equal(face.extrude(3).metadata[key], 'profile');
});
