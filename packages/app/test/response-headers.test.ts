import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appHeaderRules} from '../build/response-headers.ts';

const rulePatterns = (rules: string) =>
  rules.split('\n').filter(line => line && !/^\s/.test(line));

test('App header rules isolate, cache hashed assets and compress sources', () => {
  const rules = appHeaderRules('/app');
  assert.deepEqual(rulePatterns(rules), [
    '/app/*',
    '/app/assets/*',
    '/app/assets/*.ts',
    '/app/assets/*.mts',
    '/app/assets/*.cts',
    '/app/assets/*.cjs',
  ]);
  assert.ok(
    rules.includes(
      '/app/*\n' +
        '  Cross-Origin-Opener-Policy: same-origin\n' +
        '  Cross-Origin-Embedder-Policy: require-corp\n',
    ),
  );
  assert.ok(
    rules.includes(
      '/app/assets/*\n' +
        '  Cache-Control: public, max-age=31536000, immutable\n',
    ),
  );
  for (const extension of ['ts', 'mts', 'cts'])
    assert.ok(
      rules.includes(
        `/app/assets/*.${extension}\n` +
          '  Content-Type: text/plain; charset=utf-8\n',
      ),
      `Missing text content type for .${extension}`,
    );
  assert.ok(
    rules.includes(
      '/app/assets/*.cjs\n  Content-Type: text/javascript; charset=utf-8\n',
    ),
  );
});

test('standalone App header rules stay at the deployment root', () => {
  assert.deepEqual(rulePatterns(appHeaderRules('')), [
    '/*',
    '/assets/*',
    '/assets/*.ts',
    '/assets/*.mts',
    '/assets/*.cts',
    '/assets/*.cjs',
  ]);
});
