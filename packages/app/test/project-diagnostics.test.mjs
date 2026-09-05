import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as esbuild from 'esbuild';
import {createAppTestServer} from './vite-test-server.mjs';
import {importTestModule} from './project-test-files.mjs';

let server, ProjectBuilder, ModuleEvaluator;
before(async () => {
  server = await createAppTestServer();
  ({ProjectBuilder} = await server.ssrLoadModule(
    '/src/project/project-builder.ts',
  ));
  ({ModuleEvaluator} = await server.ssrLoadModule(
    '/src/model/module-evaluator.ts',
  ));
});
after(async () => server?.close());

function builder(source, extra = {}) {
  const files = new Map(
    Object.entries({
      '/package.json': '{"type":"module"}',
      '/src/child.ts': source,
      ...extra,
    }),
  );
  return new ProjectBuilder(
    {
      async readFile(path) {
        if (files.has(path)) return new TextEncoder().encode(files.get(path));
      },
      async stat(path) {
        if (files.has(path)) return {kind: 'file', version: files.get(path)};
        if ([...files.keys()].some(file => file.startsWith(path + '/')))
          return {kind: 'directory', version: ''};
      },
    },
    esbuild,
  );
}

for (const [name, statement, span, message, extra] of [
  [
    'missing package',
    'import "missing-package";',
    '"missing-package"',
    /resolve.*missing-package/,
    {},
  ],
  [
    'Node builtin',
    'import "node:fs";',
    '"node:fs"',
    /Node built-in node:fs.*browser/,
    {},
  ],
  [
    'bare Node builtin',
    'import "fs";',
    '"fs"',
    /Node built-in fs.*browser/,
    {},
  ],
  [
    'blocked export',
    'import "private-package/hidden";',
    '"private-package/hidden"',
    /not exported/,
    {
      '/node_modules/private-package/package.json':
        '{"exports":{"./hidden":null}}',
    },
  ],
  [
    'missing extension',
    'import "./dimensions";',
    '"./dimensions"',
    /resolve/,
    {'/src/dimensions.ts': 'export const width=2;'},
  ],
  [
    'dynamic missing package',
    'await import("missing-package");',
    'import("missing-package")',
    /resolve.*missing-package/,
    {},
  ],
  [
    'computed dynamic import',
    'const specifier="./child.ts"; await import(specifier);',
    'import(specifier)',
    /string literal/,
    {},
  ],
  [
    'native addon',
    'import "native-addon";',
    '"native-addon"',
    /Native Node addon.*browser/,
    {
      '/node_modules/native-addon/package.json': '{"main":"index.node"}',
      '/node_modules/native-addon/index.node': 'native bytes',
    },
  ],
  ['syntax', 'export const width = ;', ';', /Unexpected/, {}],
]) {
  test(`locates ${name} in the original multi-file source, including UTF-8 columns`, async () => {
    const prefix = '// child module\r\nconst 中文 = "🧱"; ';
    const source = prefix + statement;
    await assert.rejects(
      builder(source, extra).build('import "/src/child.ts";'),
      error => {
        assert.match(error.diagnostic.summary, message);
        assert.deepEqual(error.diagnostic.sourceRef, {
          file: '/src/child.ts',
          start: source.indexOf(span, prefix.length),
          end: source.indexOf(span, prefix.length) + span.length,
        });
        return true;
      },
    );
  });
}

test('keeps Node dynamic branches conditional and rejects reached branches explicitly', async () => {
  const evaluator = new ModuleEvaluator(importTestModule);
  try {
    const bundle = await builder(
      'export const value=1; if(globalThis.__notEnabled) await import("node:fs"); export function load(){return import("node:fs")}',
    ).build('export * from "/src/child.ts";');
    const module = await evaluator.evaluate('test.js', bundle.source);
    assert.equal(module.value, 1);
    await assert.rejects(module.load(), /Node built-in node:fs.*browser/);
  } finally {
    evaluator.dispose();
  }
});
