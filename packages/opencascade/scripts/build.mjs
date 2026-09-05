import {spawnSync} from 'node:child_process';
import {copyFileSync, cpSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('..', import.meta.url));
const scratch = fileURLToPath(new URL('../.cache/build/', import.meta.url));
const image =
  'ghcr.io/taucad/opencascade.js@sha256:deb9be8470038652c060b47f2d2e7e2e46d899bb896ecabb007bf60307ee2d54';
mkdirSync(scratch, {recursive: true});
cpSync(new URL('../native/', import.meta.url), scratch, {recursive: true});
for (const file of ['patch-generator.py', 'compile-bindings.py', 'build.sh']) {
  copyFileSync(new URL(file, import.meta.url), `${scratch}/${file}`);
}

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--cpus',
    '6',
    '--memory',
    '12g',
    '--env',
    'OCJS_COMPILE_WORKERS=6',
    '--env',
    'OCJS_OUTPUT_DIR=/src',
    '--env',
    `CODE3D_BUILD_UID=${process.getuid?.() ?? 0}`,
    '--env',
    `CODE3D_BUILD_GID=${process.getgid?.() ?? 0}`,
    '--volume',
    `${scratch}:/src`,
    '--entrypoint',
    '/bin/bash',
    image,
    '/src/build.sh',
  ],
  {cwd: directory, stdio: 'inherit', timeout: 2_100_000},
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const output = new URL('../wasm/', import.meta.url);
mkdirSync(output, {recursive: true});
for (const extension of ['js', 'wasm', 'provenance.json']) {
  const file = `replicad_single.${extension}`;
  copyFileSync(`${scratch}/${file}`, new URL(file, output));
}
