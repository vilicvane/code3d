import {defined} from '../../../test/assert.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

test('watches published package bytes without linking them into the App module graph', async () => {
  const server = await createAppTestServer();
  try {
    const client = server.environments.client;
    const result = await client.transformRequest(
      'virtual:code3d-browser-packages',
    );
    assert.match(
      defined(result).code,
      /\/node_modules\/@code3d\/core\/bld\/tooling\/index\.js/,
    );
    assert.match(defined(result).code, /\/__code3d-packages\/[a-f0-9]+\.js/);
    const module = client.moduleGraph.getModuleById(
      '\0virtual:code3d-browser-packages',
    );
    // Vite associates load-hook watch files only after the module node exists.
    // Exercise a rebuild, not just the initial cold request.
    client.moduleGraph.invalidateModule(defined(module));
    await client.transformRequest('virtual:code3d-browser-packages');
    assert.deepEqual(
      [...defined(module).importedModules].map(dependency => dependency.id),
      [],
    );
  } finally {
    await server.close();
  }
});

test('watches before the first package snapshot and invalidates newly created published files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'code3d-package-watch-'));
  const server = await createAppTestServer();
  try {
    const {browserPackages} = await server.ssrLoadModule<
      typeof import('../build/browser-packages.ts')
    >('/build/browser-packages.ts');
    const core = path.join(root, 'node_modules/@code3d/core');
    const screws = path.join(root, 'node_modules/@code3d/screws');
    for (const [name, disk] of [
      ['core', core],
      ['screws', screws],
    ] as const) {
      await mkdir(disk, {recursive: true});
      await writeFile(
        path.join(disk, 'package.json'),
        JSON.stringify({
          name: '@code3d/' + name,
          version: '1.0.0',
          files: ['*.js'],
        }),
      );
      await writeFile(path.join(disk, 'index.js'), 'export const version = 1;');
    }
    const plugin = browserPackages(root);
    const context = {} as ThisParameterType<typeof plugin.load>;
    plugin.configResolved.call(context, {command: 'serve'} as Parameters<
      typeof plugin.configResolved
    >[0]);
    let changed = false;
    let reloads = 0;
    const updates = {
      environment: {
        config: {consumer: 'client'},
        moduleGraph: {getModuleById() {}},
        hot: {
          send() {
            reloads++;
          },
        },
      },
    } as unknown as ThisParameterType<typeof plugin.hotUpdate>;
    const hotUpdate = (file: string) =>
      plugin.hotUpdate.call(updates, {file} as Parameters<
        typeof plugin.hotUpdate
      >[0]);
    plugin.configureServer.call(context, {
      watcher: {
        add() {
          if (changed) return;
          changed = true;
          // Change the first package exactly as its watcher is being registered.
          // Registering only after collection would cache its earlier bytes.
          writeFileSync(
            path.join(core, 'index.js'),
            'export const version = 2;',
          );
          hotUpdate(path.join(core, 'index.js'));
        },
      },
      middlewares: {use() {}},
    } as unknown as Parameters<typeof plugin.configureServer>[0]);
    const first = defined(
      await plugin.load.call(context, '\0virtual:code3d-browser-packages'),
    );
    const hash = (bytes: Uint8Array) =>
      createHash('sha256').update(bytes).digest('hex');
    assert.ok(
      first.includes(hash(await readFile(path.join(core, 'index.js')))),
    );
    assert.ok(reloads > 0);
    const extra = path.join(core, 'extra.js');
    await writeFile(extra, 'export const extra = true;');
    const before = reloads;
    hotUpdate(extra);
    assert.equal(reloads, before + 1);
    const second = defined(
      await plugin.load.call(context, '\0virtual:code3d-browser-packages'),
    );
    assert.match(second, /\/node_modules\/@code3d\/core\/extra\.js/);
    // Clean/recreate keeps watching the package directory, not deleted handles.
    await rm(extra);
    hotUpdate(extra);
    assert.doesNotMatch(
      defined(
        await plugin.load.call(context, '\0virtual:code3d-browser-packages'),
      ),
      /extra\.js/,
    );
  } finally {
    await server.close();
    await rm(root, {recursive: true, force: true});
  }
});
