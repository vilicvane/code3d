import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {runBrowserTestGroup} from '../scripts/browser-test-runner.mjs';

test('a failed browser file stops unstarted files without losing its result', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'code3d-browser-runner-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const failed = join(directory, 'failed.test.mjs');
  const skipped = join(directory, 'skipped.test.mjs');
  const marker = join(directory, 'marker.txt');
  await writeFile(
    failed,
    "import {test} from 'node:test'; test('failure', () => { throw Error('expected failure'); });\n",
  );
  await writeFile(
    skipped,
    `import {writeFile} from 'node:fs/promises'; import {test} from 'node:test'; test('would run', async () => writeFile(${JSON.stringify(marker)}, 'ran'));\n`,
  );
  const group = await runBrowserTestGroup({
    name: 'diagnostic',
    files: [failed, skipped],
    concurrency: 1,
    cwd: directory,
  });
  assert.equal(group.passed, false);
  assert.equal(group.files[0].passed, false);
  assert.equal(group.files[1].skipped, true);
  await assert.rejects(readFile(marker), {code: 'ENOENT'});
  const diagnostic = await runBrowserTestGroup({
    name: 'complete-diagnostic',
    files: [failed, skipped],
    concurrency: 1,
    failFast: false,
    cwd: directory,
  });
  assert.equal(diagnostic.passed, false);
  assert.equal(diagnostic.files[0].passed, false);
  assert.equal(diagnostic.files[1].passed, true);
  assert.equal(await readFile(marker, 'utf8'), 'ran');
});
