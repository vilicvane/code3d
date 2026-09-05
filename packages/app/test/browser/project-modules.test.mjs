import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';

let browser;
before(async () => {
  assert.ok(
    process.env.CODE3D_TEST_URL,
    'Set CODE3D_TEST_URL to the task server',
  );
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

async function fixture(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const url = new URL('/__project-modules-test__', process.env.CODE3D_TEST_URL)
    .href;
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main>Project modules</main>',
    }),
  );
  await page.goto(url);
  await page.evaluate(async () => {
    const {ModelCompilerClient} = await import('/src/model/compiler-client.ts');
    window.files = new Map();
    window.client = new ModelCompilerClient({
      async readFile(path) {
        if (files.has(path)) return new TextEncoder().encode(files.get(path));
      },
      async stat(path) {
        if (files.has(path)) return {kind: 'file', version: files.get(path)};
        if ([...files.keys()].some(file => file.startsWith(path + '/')))
          return {kind: 'directory', version: ''};
      },
    });
    window.compile = source =>
      client.compile({files: [{path: '/model.ts', source}]}, '/model.ts');
  });
  return page;
}

test(
  'actual Worker shares concurrent async dependency graphs and keeps them across source edits',
  {timeout: 120000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      for (const [name, source] of Object.entries({
        shared:
          'await new Promise(resolve=>setTimeout(resolve,50)); export const identity={}; export const size=5;',
        first:
          'export {identity} from "shared"; export const nested=await import("second");',
        second: 'export {identity,size} from "shared";',
      })) {
        files.set(
          `/node_modules/${name}/package.json`,
          '{"type":"module","main":"index.js"}',
        );
        files.set(`/node_modules/${name}/index.js`, source);
      }
      const source =
        'import {box} from "@code3d/core"; const [a,b,c]=await Promise.all([import("first"),import("second"),import("shared")]); if(a.identity!==b.identity || b.identity!==c.identity || a.nested!==b) throw new Error("module identity mismatch"); export default box(c.size,4,3);';
      try {
        const first = await compile(source);
        const second = await compile('\n\n' + source);
        return {
          diagnostics: [first.diagnostic, second.diagnostic],
          sameSize:
            JSON.stringify(first.fallback.mesh.vertices) ===
            JSON.stringify(second.fallback.mesh.vertices),
          exportable: client.canExport(second),
        };
      } finally {
        client.dispose();
      }
    });
    assert.deepEqual(result.diagnostics, [undefined, undefined]);
    assert.equal(result.sameSize, true);
    assert.equal(result.exportable, true);
  },
);

test(
  'actual Worker delivers located build failures and recovers on the next edit',
  {timeout: 120000},
  async t => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const source = 'const 中文="🧱";\nimport "node:fs";';
      try {
        let diagnostic;
        try {
          await compile(source);
        } catch (error) {
          diagnostic = error.diagnostic;
        }
        const model = await compile(
          'import {box} from "@code3d/core"; export default box(4,5,6);',
        );
        return {
          diagnostic,
          start: source.indexOf('"node:fs"'),
          recovered: !model.diagnostic && model.exports.has('default'),
        };
      } finally {
        client.dispose();
      }
    });
    assert.match(result.diagnostic.summary, /Node built-in node:fs.*browser/);
    assert.deepEqual(result.diagnostic.sourceRef, {
      file: '/model.ts',
      start: result.start,
      end: result.start + 9,
    });
    assert.equal(result.recovered, true);
  },
);
