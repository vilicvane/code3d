import {spawnSync} from 'node:child_process';
import {chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('..', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: directory,
    stdio: 'inherit',
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.env.EMCMAKE ?? 'emcmake', [
  'cmake',
  '-S',
  'native',
  '-B',
  '.cache/wasm',
  '-DCMAKE_BUILD_TYPE=Release',
  ...process.argv.slice(2),
]);
run('cmake', ['--build', '.cache/wasm', '--parallel', '4']);
chmodSync(new URL('../wasm/solver.wasm', import.meta.url), 0o644);
