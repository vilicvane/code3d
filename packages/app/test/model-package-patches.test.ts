import {applyPatch, parsePatch, reversePatch} from 'diff';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let patchModelPackages: (typeof import('../src/project/model-package-patches.ts'))['patchModelPackages'];
let original: string;
let patched: string;
before(async () => {
  server = await createAppTestServer();
  ({patchModelPackages} = await server.ssrLoadModule<
    typeof import('../src/project/model-package-patches.ts')
  >('/src/project/model-package-patches.ts'));
  patched = await readFile(
    new URL('../../../node_modules/squares-rng/node/index.js', import.meta.url),
    'utf8',
  );
  const patch = parsePatch(
    await readFile(
      new URL('../../../patches/squares-rng+2.0.4.patch', import.meta.url),
      'utf8',
    ),
  )[0];
  const restored = applyPatch(patched, reversePatch(patch), {
    compareLine: (_number, line, _operation, content) =>
      line?.replace(/\r$/, '') === content.replace(/\r$/, ''),
  });
  assert.notEqual(restored, false);
  original = restored as string;
  assert.match(original, /Buffer\.from/);
});
after(async () => server?.close());

function fixture(
  root: string,
  source: string,
  name = 'squares-rng',
  version = '2.0.4',
) {
  const files = new Map([
    [root + '/node/index.js', new TextEncoder().encode(source)],
    [
      root + '/package.json',
      new TextEncoder().encode(JSON.stringify({name, version})),
    ],
  ]);
  const reader: ProjectFileReader = {
    async readFile(path) {
      return files.get(path);
    },
    async stat(path) {
      return files.has(path) ? {kind: 'file', version: path} : undefined;
    },
  };
  return {
    files,
    reader: patchModelPackages(reader),
    entry: root + '/node/index.js',
  };
}

test('applies the existing Worker patch to raw npm bytes at root and nested package paths', async () => {
  for (const root of [
    '/node_modules/squares-rng',
    '/project/node_modules/parent/node_modules/squares-rng',
    '/node_modules/.code3d/squares-rng@2.0.4/node_modules/squares-rng',
  ]) {
    const {files, reader, entry} = fixture(root, original);
    assert.equal(
      new TextDecoder().decode(await reader.readFile(entry)),
      patched,
    );
    assert.equal(
      new TextDecoder().decode(files.get(entry)),
      original,
      'installed bytes remain untouched',
    );
    assert.deepEqual(await reader.statMany!([entry, '/missing']), [
      {kind: 'file', version: entry},
      undefined,
    ]);
  }
});

test('preserves already patched packages and leaves other names, versions and files unchanged', async () => {
  for (const [source, name, version] of [
    [patched, 'squares-rng', '2.0.4'],
    [original, 'squares-rng', '2.0.5'],
    [original, 'another-package', '2.0.4'],
  ]) {
    const {files, reader, entry} = fixture(
      '/node_modules/squares-rng',
      source,
      name,
      version,
    );
    assert.equal(await reader.readFile(entry), files.get(entry));
  }
  const {files, reader} = fixture('/node_modules/squares-rng', original);
  const unrelated = '/node_modules/squares-rng/node/unrelated.js';
  files.set(unrelated, new TextEncoder().encode(original));
  assert.equal(await reader.readFile(unrelated), files.get(unrelated));
  assert.equal(await reader.readFile('/missing'), undefined);
});

test('reports a changed upstream implementation instead of silently compiling an unpatched package', async () => {
  const {reader, entry} = fixture(
    '/node_modules/squares-rng',
    'export const changed = true;',
  );
  await assert.rejects(
    reader.readFile(entry),
    /Unable to apply.*Worker compatibility patch/,
  );
});
