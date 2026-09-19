import assert from 'node:assert/strict';
import {test} from 'node:test';
import {exampleEntries} from '../render-samples/catalog.ts';
import {
  assignExampleShards,
  estimatedExampleShardLoads,
} from './browser/example-shards.ts';

const files = exampleEntries.map(({file}) => file);

test('one shard runs every example in catalog order', () => {
  assert.deepEqual(
    assignExampleShards(files, 1),
    files.map(() => 0),
  );
});

test('four shards cover the current example catalog', () => {
  const assignment = assignExampleShards(files, 4);
  assert.equal(assignment.length, files.length);
  assert.ok(assignment.every(shard => shard >= 0 && shard < 4));
  assert.equal(new Set(assignment).size, 4);
});

test('measured costs balance a fixed workload including unmeasured and standalone checks', () => {
  // Catalog additions can improve modulo scheduling by coincidence. Keep the
  // cost comparison independent of the current catalog's membership and order.
  const workload = [
    'assemblies/screw-box/model.ts',
    'operations/cut.ts',
    'operations/group.ts',
    'operations/union.ts',
    'packages/screws.ts',
    'operations/origin.ts',
    'operations/rotate.ts',
    'operations/distance.ts',
    'unmeasured-example.ts',
  ];
  const assignment = assignExampleShards(workload, 4);
  assert.deepEqual(assignment, [0, 2, 1, 2, 1, 2, 3, 2, 2]);
  const loads = estimatedExampleShardLoads(workload, assignment, 4);
  assert.deepEqual(loads, [327, 303, 269, 283]);
  const moduloLoads = estimatedExampleShardLoads(
    workload,
    workload.map((_, index) => index % 4),
    4,
  );
  assert.ok(Math.max(...loads) < Math.max(...moduloLoads));
});
