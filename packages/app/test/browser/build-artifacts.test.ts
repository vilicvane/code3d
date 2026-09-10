import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium, type Browser} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';
import {normalizedModelSnapshot} from '../model-snapshot.ts';

let browser: Browser;
before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL);
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

test(
  'clearing build caches removes all project entries and preserves another workspace',
  {timeout: 120_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__build-artifacts-test__',
      process.env.CODE3D_TEST_URL,
    );
    await context.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Clear build cache</main>',
      }),
    );
    await page.goto(url.href);
    const results = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const files = {
        readFile: async () => undefined,
        stat: async () => undefined,
      };
      const create = (identity: string) =>
        new ModelCompilerClient(files, undefined, undefined, identity);
      const source =
        'import {box} from "@code3d/core"; export default box(3, 4, 5);';
      const project = {
        files: [
          {path: '/a.ts', source},
          {path: '/nested/b.ts', source},
          {path: '/nested/package.json', source: '{"type":"module"}'},
        ],
      };
      const a = create('clear-project');
      const b = create('clear-project-extra');
      try {
        await a.compile(project, '/a.ts');
        await a.compile(project, '/nested/b.ts');
        await b.compile(project, '/a.ts');
        await a.clearBuildCache();
        // A new compiler request can arrive before the asynchronous disk reset completes.
        const clearing = a.clearBuildCache();
        const phases: string[] = [];
        const rebuilding = a.compile(project, '/a.ts', undefined, phase =>
          phases.push(phase),
        );
        const [, rebuilt] = await Promise.all([clearing, rebuilding]);
        if (rebuilt.diagnostic) throw new Error(rebuilt.diagnostic.summary);
        await a.clearBuildCache();
        return {phases};
      } finally {
        a.dispose();
        b.dispose();
      }
    });
    assert.ok(
      results.phases.includes('loading-runtime'),
      'cleared dependency builds are rebuilt',
    );
    await page.reload();
    const restored = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const results = [];
      for (const [identity, path] of [
        ['clear-project', '/a.ts'],
        ['clear-project', '/nested/b.ts'],
        ['clear-project-extra', '/a.ts'],
      ]) {
        const client = new ModelCompilerClient(
          {readFile: async () => undefined, stat: async () => undefined},
          undefined,
          undefined,
          identity,
        );
        try {
          await client
            .compile({files: [{path, source: 'export const broken = ;'}]}, path)
            .catch(() => {});
          results.push({identity, path, restored: !!client.restored});
        } finally {
          client.dispose();
        }
      }
      return results;
    });
    assert.deepEqual(
      restored.map(result => result.restored),
      [false, false, true],
    );
  },
);

test(
  'clearing during compilation cancels old work and allows the next build',
  {timeout: 90_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__build-artifacts-test__',
      process.env.CODE3D_TEST_URL,
    );
    await context.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Clear while compiling</main>',
      }),
    );
    await page.goto(url.href);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const client = new ModelCompilerClient(
        {readFile: async () => undefined, stat: async () => undefined},
        undefined,
        undefined,
        'clear-running',
      );
      let started!: () => void;
      const preparing = new Promise<void>(resolve => {
        started = resolve;
      });
      const project = {
        files: [
          {
            path: '/model.ts',
            source:
              'import {box} from "@code3d/core"; export default box(2, 3, 4);',
          },
        ],
      };
      try {
        const first = client
          .compile(project, '/model.ts', undefined, phase => {
            if (phase === 'loading-runtime') started();
          })
          .then(
            () => false,
            () => true,
          );
        await preparing;
        await client.clearBuildCache();
        const module = await client.compile(project, '/model.ts');
        return {
          cancelled: await first,
          objects: module.objects.size,
          diagnostic: module.diagnostic,
        };
      } finally {
        client.dispose();
      }
    });
    assert.equal(result.cancelled, true);
    assert.equal(result.diagnostic, undefined);
    assert.ok(result.objects > 0);
  },
);

test(
  'each entry restores its successful artifact after reload, even when the new source fails',
  {timeout: 120_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__build-artifacts-test__',
      process.env.CODE3D_TEST_URL,
    );
    await context.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Build artifacts</main>',
      }),
    );
    await page.goto(url.href);
    const initial = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const files = {
        readFile: async () => undefined,
        stat: async () => undefined,
      };
      const client = new ModelCompilerClient(
        files,
        undefined,
        undefined,
        'build-artifacts-test',
      );
      try {
        const a = await client.compile(
          {
            files: [
              {
                path: '/a.ts',
                source:
                  'import {box} from "@code3d/core"; export default box(3, 4, 5);',
              },
            ],
          },
          '/a.ts',
        );
        const b = await client.compile(
          {files: [{path: '/b.ts', source: 'export const value = 7;'}]},
          '/b.ts',
        );
        // A third entry gives the compiler time to durably confirm B while doing useful work.
        await client.compile({files: [{path: '/c.ts', source: ''}]}, '/c.ts');
        return {
          a: a.objects.size,
          snapshot: JSON.stringify([...a.objects]),
          b: b.objects.size,
          diagnostic: a.diagnostic ?? b.diagnostic,
        };
      } finally {
        client.dispose();
      }
    });
    assert.equal(initial.diagnostic, undefined);
    assert.ok(initial.a > 0);
    assert.equal(initial.b, 0);
    await page.reload();
    // Make background compilation finish before the cached result is delivered.
    await page.route('**/src/model/executor.worker.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `
const originalPostMessage = self.postMessage.bind(self);
self.postMessage = (data, ...rest) => {
  if (data.kind === 'result') setTimeout(() => originalPostMessage(data, ...rest), 3000);
  else originalPostMessage(data, ...rest);
};`,
      });
    });
    const restored = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const mobxUrl = '/node_modules/.vite/deps/mobx.js';
      const {when}: typeof import('mobx') = await import(mobxUrl);
      const files = {
        readFile: async () => undefined,
        stat: async () => undefined,
      };
      const results = [];
      for (const [path, source] of [
        [
          '/a.ts',
          'import {box} from "@code3d/core"; export default box(8, 4, 5); throw new Error("new execution failed");',
        ],
        ['/b.ts', 'export const value = ;'],
      ]) {
        const client = new ModelCompilerClient(
          files,
          undefined,
          undefined,
          'build-artifacts-test',
        );
        const start = performance.now();
        const preview = when(() => !!client.restored, {timeout: 30_000});
        // Observe both promises immediately: a compiler failure can precede restoration.
        try {
          const [current] = await Promise.allSettled([
            client.compile({files: [{path, source}]}, path),
            preview,
          ]);
          const old = client.restored;
          results.push({
            path,
            restoredPath: old?.rootPath,
            objects: old?.module.objects.size,
            snapshot: old ? JSON.stringify([...old.module.objects]) : undefined,
            exportable: old ? client.canExport(old.module) : undefined,
            failed: current.status === 'rejected' || !!current.value.diagnostic,
            ms: performance.now() - start,
          });
        } finally {
          client.dispose();
        }
      }
      return results;
    });
    assert.ok(restored.every(value => value.failed));
    assert.deepEqual(
      restored.map(value => value.restoredPath),
      ['/a.ts', '/b.ts'],
    );
    assert.ok(restored[0].objects! > 0);
    assert.equal(restored[1].objects, 0);
    assert.ok(restored.every(value => value.exportable === false));
    assert.equal(restored[0].snapshot, initial.snapshot);
    t.diagnostic(JSON.stringify(restored.map(({path, ms}) => ({path, ms}))));
  },
);

test(
  'directory handles update workspace sources and refresh an installed dependency as a whole',
  {timeout: 120_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__directory-build-test__',
      process.env.CODE3D_TEST_URL,
    );
    await context.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Directory build</main>',
      }),
    );
    await page.goto(url.href);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {DirectoryFileReader} = await import('/src/project/file-reader.ts');
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('directory-fixture', {create: true});
      async function write(path: string, contents: string) {
        const parts = path.split('/');
        let directory = root;
        for (const name of parts.slice(0, -1))
          directory = await directory.getDirectoryHandle(name, {create: true});
        const stream = await (
          await directory.getFileHandle(parts.at(-1)!, {create: true})
        ).createWritable();
        await stream.write(contents);
        await stream.close();
      }
      await write(
        'model.ts',
        'import {box} from "@code3d/core"; import {size} from "./size.ts"; import width from "width"; export default box(size, width, 5);',
      );
      await write('size.ts', 'export const size = 2;');
      await write(
        'node_modules/width/package.json',
        JSON.stringify({
          name: 'width',
          version: '1.0.0',
          type: 'module',
          exports: './index.js',
        }),
      );
      await write('node_modules/width/index.js', 'export default 3;');
      const files = new DirectoryFileReader(root);
      let client = new ModelCompilerClient(
        files,
        undefined,
        undefined,
        'directory-fixture',
      );
      const snapshots: string[] = [];
      async function compile() {
        const module = await client.compile({files: []}, '/model.ts');
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        snapshots.push(JSON.stringify([...module.objects]));
      }
      try {
        await compile();
        await write('size.ts', 'export const size = 4;');
        await compile();
        await write('size.ts', 'export const size = 2;');
        await compile();
        await write('node_modules/width/index.js', 'export default 6;');
        await compile();
        client.refreshDependencies();
        await compile();
        await write(
          'node_modules/width/package.json',
          JSON.stringify({
            name: 'width',
            version: '2.0.0',
            type: 'module',
            exports: './index.js',
          }),
        );
        await write('node_modules/width/index.js', 'export default 9;');
        await compile();
        client.dispose();
        client = new ModelCompilerClient(
          files,
          undefined,
          undefined,
          'directory-fixture',
        );
        await compile();
        return snapshots;
      } finally {
        client.dispose();
      }
    });
    const snapshots = result.map(normalizedModelSnapshot);
    assert.notEqual(snapshots[0], snapshots[1]);
    assert.equal(snapshots[0], snapshots[2]);
    assert.equal(
      snapshots[2],
      snapshots[3],
      'same-version installed bytes remain immutable until manual refresh',
    );
    assert.notEqual(snapshots[3], snapshots[4]);
    assert.notEqual(snapshots[4], snapshots[5]);
    assert.equal(snapshots[5], snapshots[6]);
  },
);

test(
  'switching cached entries reuses the current dependency superset without restarting the kernel',
  {timeout: 120_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__build-artifacts-test__',
      process.env.CODE3D_TEST_URL,
    );
    await context.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Switch entries</main>',
      }),
    );
    await page.goto(url.href);
    const results = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const client = new ModelCompilerClient(
        {readFile: async () => undefined, stat: async () => undefined},
        undefined,
        undefined,
        'switch-entries',
      );
      const project = {
        files: [
          {
            path: '/a.ts',
            source:
              'import {box} from "@code3d/core"; export default box(3, 4, 5);',
          },
          {
            path: '/b.ts',
            source:
              'import {box} from "@code3d/core"; import {plastic} from "@code3d/materials"; export const material = plastic(); export default box(5, 6, 7);',
          },
        ],
      };
      const results: {
        path: string;
        phases: string[];
        objects: number;
        diagnostic?: unknown;
      }[] = [];
      try {
        for (const path of ['/a.ts', '/b.ts', '/a.ts', '/b.ts']) {
          const phases: string[] = [];
          const module = await client.compile(project, path, undefined, phase =>
            phases.push(phase),
          );
          results.push({
            path,
            phases,
            objects: module.objects.size,
            diagnostic: module.diagnostic,
          });
        }
        return results;
      } finally {
        client.dispose();
      }
    });
    results.forEach(result => {
      assert.equal(result.diagnostic, undefined);
      assert.ok(result.objects > 0);
    });
    assert.ok(
      results[1].phases.includes('loading-runtime'),
      'first use expands the dependency bundle',
    );
    for (const result of results.slice(2)) {
      assert.ok(
        !result.phases.includes('loading-runtime'),
        result.path + ' repackaged dependencies',
      );
      assert.ok(
        !result.phases.includes('initializing-runtime'),
        result.path + ' restarted the kernel',
      );
    }
  },
);

test(
  'new entries reuse their dependency directory after switching scopes and restarting workers',
  {timeout: 120_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL(
      '/__build-artifacts-test__',
      process.env.CODE3D_TEST_URL,
    );
    await context.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Dependency scopes</main>',
      }),
    );
    await page.goto(url.href);
    const results = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const files = {
        readFile: async () => undefined,
        stat: async () => undefined,
      };
      const project = {
        files: [
          {
            path: '/a.ts',
            source:
              'import {box} from "@code3d/core"; export default box(3, 4, 5);',
          },
          {path: '/nested/a.ts', source: 'export const answer = 42;'},
          {
            path: '/nested/package.json',
            source: '{"name":"nested","type":"module"}',
          },
          {path: '/new.ts', source: 'export const answer = 41;'},
          {path: '/fresh.ts', source: 'export const answer = 40;'},
        ],
      };
      let client = new ModelCompilerClient(
        files,
        undefined,
        undefined,
        'dependency-scopes',
      );
      const results: {path: string; phases: string[]; diagnostic?: unknown}[] =
        [];
      try {
        for (const path of ['/a.ts', '/nested/a.ts', '/new.ts', '/fresh.ts']) {
          if (path === '/fresh.ts') {
            client.dispose();
            client = new ModelCompilerClient(
              files,
              undefined,
              undefined,
              'dependency-scopes',
            );
          }
          const phases: string[] = [];
          const module = await client.compile(project, path, undefined, phase =>
            phases.push(phase),
          );
          results.push({path, phases, diagnostic: module.diagnostic});
        }
      } finally {
        client.dispose();
      }
      return results;
    });
    results.forEach(result => assert.equal(result.diagnostic, undefined));
    results
      .slice(2)
      .forEach(result =>
        assert.equal(
          result.phases.includes('loading-runtime'),
          false,
          result.path,
        ),
      );
  },
);
