import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

test('live context preserves one capture even for repeated lines, special characters and empty selections', async t => {
  const server = await createAppTestServer();
  t.after(() => server.close());
  const {contextCursor} = await server.ssrLoadModule<
    typeof import('../src/agent/context.ts')
  >('/src/agent/context.ts');
  const {resolveAgentCursor} = await server.ssrLoadModule<
    typeof import('../src/agent/cursor.ts')
  >('/src/agent/cursor.ts');
  const source =
    '\nconst a = box(10, 6, 8);\r\nconst a = box(10, 6, 8);\r\n/* (.$) */';
  for (const [start, end] of [
    [0, 0],
    [1, 1],
    [11, 25],
    [source.indexOf('const', 2), source.indexOf('/*')],
    [source.length, source.length],
  ]) {
    const cursor = contextCursor(source, {file: '/model.ts', start, end});
    const resolved = resolveAgentCursor(source, cursor);
    assert.equal(resolved.start, start);
    assert.equal(resolved.end, end);
  }
});
