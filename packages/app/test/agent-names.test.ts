import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomAgentName} from '../src/agent/names.ts';

test('agent name suggestions exhaust people before using the first free numbered name', () => {
  const used: string[] = [];
  for (let i = 0; i < 12; i++) {
    const name = randomAgentName(used);
    assert.ok(!name.startsWith('Agent '));
    assert.ok(!used.includes(name.toLowerCase()));
    // Matching must ignore case even when the user changes a suggested name.
    used.push(name.toLowerCase());
  }
  assert.equal(randomAgentName(used), 'Agent 1');
  used.push('AGENT 1', 'Agent 3');
  assert.equal(randomAgentName(used), 'Agent 2');
});
