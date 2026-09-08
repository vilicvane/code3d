import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {StoredReceipt} from '@code3d/agent';
import {AgentRenderHistory} from '../src/agent/render-history.ts';

const euler = {id: 'euler', name: 'Euler', color: 0};
const noether = {id: 'noether', name: 'Noether', color: 1};
const png = {name: 'render.png', mimeType: 'image/png', base64: 'aW1hZ2U'};
const receipt = (id: number): StoredReceipt => ({
  requestId: `render-${id}`,
  fingerprint: `fingerprint-${id}`,
  response: {
    ok: true,
    data: {
      observation: {
        snapshotId: 'reused-computation',
        createdAt: '2026-09-08T00:00:00.000Z',
        render: {
          capturedAt: new Date(Date.UTC(2026, 8, 8, 0, 0, id)).toISOString(),
        },
        cursor: {source: 'not kept in screenshot history'},
      },
    },
    artifacts: [png],
  },
});

test('history includes only successful render receipts with a capture timestamp', () => {
  const history = new AgentRenderHistory();
  const base = receipt(1);
  for (const response of [
    undefined,
    {ok: false, error: {code: 'model_failed', message: 'Failed'}},
    {ok: true, data: {observation: {type: 'Sketch'}}},
    {
      ok: true,
      data: {observation: {createdAt: '2026-09-08T00:00:00Z'}},
      artifacts: [png],
    },
    {
      ok: true,
      data: {observation: {render: {capturedAt: 'invalid'}}},
      artifacts: [png],
    },
    {ok: true, data: {path: '/render.png'}, artifacts: [png]},
    {...base.response, artifacts: []},
  ] as StoredReceipt['response'][])
    history.record(euler, {...base, response});
  assert.equal(history.items.length, 0);
  history.record(euler, base);
  assert.deepEqual(history.items, [
    {
      id: JSON.stringify([euler.id, base.requestId]),
      agent: euler,
      capturedAt: '2026-09-08T00:00:01.000Z',
      image: png,
    },
  ]);
});

test('request retries deduplicate per agent while new camera renders remain distinct', () => {
  const history = new AgentRenderHistory();
  history.record(euler, receipt(1));
  history.record(euler, receipt(1));
  history.record(noether, receipt(1));
  history.record(euler, receipt(2));
  assert.equal(history.items.length, 3);
  assert.deepEqual(
    history.items.map(item => item.agent.id),
    ['euler', 'noether', 'euler'],
  );
});

test('restore sorts capture times and retains the latest 100 images across agents', () => {
  const history = new AgentRenderHistory();
  for (let index = 149; index >= 0; index--)
    history.record(index % 2 ? euler : noether, receipt(index));
  assert.equal(history.items.length, 100);
  assert.equal(history.items[0].capturedAt, '2026-09-08T00:00:50.000Z');
  assert.equal(history.items.at(-1)!.capturedAt, '2026-09-08T00:02:29.000Z');
  history.remove(euler.id);
  assert.equal(history.items.length, 50);
  assert.ok(history.items.every(item => item.agent.id === noether.id));
  history.clear();
  assert.equal(history.items.length, 0);
});

test('receipt notifications run outside writes and coalesce restore and revoke batches', async () => {
  const history = new AgentRenderHistory();
  const sizes: number[] = [];
  const unsubscribe = history.subscribe(() => sizes.push(history.items.length));
  history.record(euler, receipt(1));
  history.record(noether, receipt(2));
  assert.deepEqual(sizes, []);
  await Promise.resolve();
  assert.deepEqual(sizes, [2]);
  history.record(euler, receipt(1));
  await Promise.resolve();
  assert.deepEqual(sizes, [2]);
  history.remove(euler.id);
  history.clear();
  await Promise.resolve();
  assert.deepEqual(sizes, [2, 0]);
  unsubscribe();
  history.record(euler, receipt(3));
  await Promise.resolve();
  assert.deepEqual(sizes, [2, 0]);
});
