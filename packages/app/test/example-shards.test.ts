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

test('measured-cost assignment covers examples and reduces the CI tail', () => {
  const assignment = assignExampleShards(files, 4);
  assert.equal(assignment.length, files.length);
  assert.ok(assignment.every(shard => shard >= 0 && shard < 4));
  const loads = estimatedExampleShardLoads(files, assignment, 4);
  const moduloLoads = estimatedExampleShardLoads(
    files,
    files.map((_, index) => index % 4),
    4,
  );
  assert.ok(Math.max(...loads) < Math.max(...moduloLoads) * 0.8);
  assert.ok(Math.max(...loads) - Math.min(...loads) < 60);
});
