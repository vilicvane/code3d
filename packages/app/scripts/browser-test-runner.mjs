import {spawn} from 'node:child_process';
import {mkdir, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export const appRoot = fileURLToPath(new URL('..', import.meta.url));
export const defaultBrowserTimingFile = fileURLToPath(
  new URL('../.cache/browser-test-timings.json', import.meta.url),
);

const portablePath = value => value.split(path.sep).join('/');

async function runFile(file, cwd, env) {
  const started = performance.now();
  let output = '';
  let errors = '';
  let spawnError;
  const childEnv = {...process.env, ...env};
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=tap', file],
    {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.setEncoding('utf8').on('data', chunk => (output += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (errors += chunk));
  child.once('error', error => (spawnError = error));
  const {code, signal} = await new Promise(resolve => {
    child.once('close', (code, signal) => resolve({code, signal}));
  });
  return {
    file: portablePath(file),
    passed: code === 0 && !spawnError,
    durationMs: performance.now() - started,
    output,
    errors: [errors, spawnError?.stack, signal && `Signal: ${signal}`]
      .filter(Boolean)
      .join('\n'),
  };
}

function writeTapFile(result, index) {
  if (result.skipped) {
    process.stdout.write(
      `ok ${index + 1} - ${result.file} # SKIP earlier browser test failed\n`,
    );
    return;
  }
  process.stdout.write(`# Subtest: ${result.file}\n`);
  for (const line of result.output.trimEnd().split('\n'))
    process.stdout.write(`    ${line}\n`);
  if (result.errors)
    for (const line of result.errors.trimEnd().split('\n'))
      process.stdout.write(`    # ${line}\n`);
  process.stdout.write(
    `${result.passed ? 'ok' : 'not ok'} ${index + 1} - ${result.file}\n` +
      `  ---\n  duration_ms: ${result.durationMs.toFixed(3)}\n  ...\n`,
  );
}

export async function runBrowserTestGroup({
  name,
  files,
  concurrency,
  failFast = true,
  cwd = appRoot,
  env = {},
}) {
  const started = performance.now();
  const results = Array(files.length);
  let next = 0;
  let nextToReport = 0;
  let failed = false;
  process.stdout.write('TAP version 13\n');
  function reportCompleted() {
    while (results[nextToReport]) {
      writeTapFile(results[nextToReport], nextToReport);
      nextToReport++;
    }
  }
  async function worker() {
    while (next < files.length && (!failed || !failFast)) {
      const index = next++;
      process.stderr.write(`Browser test started: ${files[index]}\n`);
      const result = await runFile(files[index], cwd, env);
      results[index] = result;
      if (!result.passed) {
        failed = true;
        process.stderr.write(`Browser test failed: ${files[index]}\n`);
      }
      reportCompleted();
    }
  }
  await Promise.all(
    Array.from({length: Math.min(concurrency, files.length)}, worker),
  );
  for (let index = next; index < files.length; index++)
    results[index] = {
      file: portablePath(files[index]),
      passed: false,
      skipped: true,
      durationMs: 0,
      output: '',
      errors: '',
    };
  reportCompleted();
  const passed = !failed;
  process.stdout.write(
    `1..${files.length}\n# files ${files.length}\n` +
      `# pass ${results.filter(result => result.passed).length}\n` +
      `# fail ${results.filter(result => !result.passed && !result.skipped).length}\n` +
      `# skip ${results.filter(result => result.skipped).length}\n`,
  );
  return {
    name,
    concurrency,
    passed,
    durationMs: performance.now() - started,
    files: results.map(({output, errors, ...result}) => result),
  };
}

export async function writeBrowserTimingReport(
  groups,
  file = process.env.CODE3D_BROWSER_TEST_TIMINGS || defaultBrowserTimingFile,
) {
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    passed: groups.every(group => group.passed),
    durationMs: groups.reduce((sum, group) => sum + group.durationMs, 0),
    groups,
  };
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(report, undefined, 2) + '\n');
  await rename(temporary, file);
  process.stderr.write(
    `Browser test timings: ${portablePath(path.relative(appRoot, file))}\n`,
  );
  return report;
}
