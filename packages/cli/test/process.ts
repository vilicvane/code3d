import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import type {TestContext} from 'node:test';

const main = fileURLToPath(new URL('../bld/main.js', import.meta.url));

export async function runCli(args: string[], input = '', timeout = 130_000) {
  const child = spawn(process.execPath, [main, ...args], {
    stdio: 'pipe',
    timeout,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
  });
  child.stdin.on('error', () => {});
  const closed = once(child, 'close');
  child.stdin.end(input);
  const [code, signal] = await closed;
  return {code, signal, stdout, stderr};
}

export async function startServe(t: TestContext, file: string) {
  const child = spawn(process.execPath, [main, file, 'serve'], {
    stdio: 'pipe',
    timeout: 180_000,
  });
  let stdout = '';
  let stderr = '';
  let ready!: () => void;
  const listening = new Promise<void>(resolve => {
    ready = resolve;
  });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    if (stdout.includes('\n')) ready();
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
  });
  child.stdin.on('error', () => {});
  const closed = once(child, 'close');
  const stop = async (signal?: NodeJS.Signals) => {
    if (child.exitCode === null && child.signalCode === null) {
      if (signal) child.kill(signal);
      else child.stdin.end();
    }
    const [code, receivedSignal] = await closed;
    assert.equal(code, 0, stdout + stderr);
    assert.equal(receivedSignal, null, stderr);
  };
  t.after(() => stop());
  await Promise.race([listening, closed]);
  assert.equal(JSON.parse(stdout).event, 'listening', stdout + stderr);
  return {child, stop, stdout: () => stdout, stderr: () => stderr};
}
