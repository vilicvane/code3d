import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as esbuild from 'esbuild';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestEvaluator, packageTestFiles} from './project-test-files.mjs';

let server;
let ProjectBuilder;
let ProjectRuntime;
let ProjectCompiler;
let Evaluator;
before(async () => {
  server = await createAppTestServer();
  ({ProjectBuilder} = await server.ssrLoadModule(
    '/src/project/project-builder.ts',
  ));
  ({ProjectRuntime} = await server.ssrLoadModule(
    '/src/model/project-runtime.ts',
  ));
  ({ProjectCompiler} = await server.ssrLoadModule(
    '/src/model/project-compiler.ts',
  ));
  Evaluator = (await createTestEvaluator(server)).constructor;
});
after(async () => server?.close());

function projectFiles(entries) {
  const files = new Map(Object.entries(entries));
  return {
    files,
    async readFile(path) {
      return files.has(path)
        ? new TextEncoder().encode(files.get(path))
        : packageTestFiles.readFile(path);
    },
    async stat(path) {
      if (files.has(path)) return {kind: 'file', version: files.get(path)};
      if ([...files.keys()].some(file => file.startsWith(path + '/')))
        return {kind: 'directory', version: ''};
      return packageTestFiles.stat(path);
    },
  };
}

test('shares a dependency across concurrent imports and a nested top-level dynamic import', async () => {
  const files = projectFiles({
    '/node_modules/shared/package.json': '{"type":"module","main":"index.js"}',
    '/node_modules/shared/index.js':
      'await new Promise(resolve => setTimeout(resolve, 50)); export const identity = {}; export let count = 0; export function increment() { count++; }',
    '/node_modules/first/package.json': '{"type":"module","main":"index.js"}',
    '/node_modules/first/index.js':
      'import {identity} from "shared"; export {identity}; export const nested = await import("second");',
    '/node_modules/second/package.json': '{"type":"module","main":"index.js"}',
    '/node_modules/second/index.js':
      'export {identity, count, increment} from "shared";',
  });
  const builder = new ProjectBuilder(files, esbuild);
  const runtime = await ProjectRuntime.create(files, builder, new Evaluator());
  try {
    const [first, second, shared] = await Promise.all([
      runtime.importModule('/node_modules/first/index.js'),
      runtime.importModule('/node_modules/second/index.js'),
      runtime.importModule('/node_modules/shared/index.js'),
    ]);
    assert.equal(first.identity, shared.identity);
    assert.equal(second.identity, shared.identity);
    assert.equal(first.nested, second);
    second.increment();
    assert.equal(shared.count, 1);
    assert.equal(second.count, 1);
    assert.equal(
      await runtime.importModule('/node_modules/shared/index.js'),
      shared,
    );
  } finally {
    runtime.dispose();
  }
});

test('retains callable CommonJS exports and JSON values when a later dependency requires cached modules', async () => {
  const files = projectFiles({
    '/node_modules/clamp/package.json': '{"main":"index.cjs"}',
    '/node_modules/clamp/index.cjs': 'module.exports = (n) => n + 1;',
    '/node_modules/clamp/data.json': '{"value":40}',
    '/node_modules/consumer/package.json': '{"main":"index.cjs"}',
    '/node_modules/consumer/index.cjs':
      'module.exports = require("clamp")(require("clamp/data.json").value);',
  });
  const builder = new ProjectBuilder(files, esbuild);
  const runtime = await ProjectRuntime.create(files, builder, new Evaluator());
  const evaluator = new Evaluator();
  try {
    await runtime.loadDependencies(
      builder,
      'import clamp from "clamp"; import data from "clamp/data.json"; export const first = clamp(data.value);',
    );
    const source = 'import answer from "consumer"; export {answer};';
    await runtime.loadDependencies(builder, source);
    const bundle = await builder.build(source, {runtimeFiles: runtime.formats});
    const value = await evaluator.evaluate('model.js', bundle.source, {
      __code3dModules: runtime.modules,
    });
    assert.equal(value.answer, 41);
  } finally {
    runtime.dispose();
    evaluator.dispose();
  }
});

test('reads installed declarations, reruns changed child source, and invalidates changed package implementations', async () => {
  const files = projectFiles({
    '/package.json':
      '{"type":"module","dependencies":{"@code3d/core":"*","custom-size":"1.0.0"}}',
    '/node_modules/custom-size/package.json':
      '{"type":"module","exports":{"types":"./index.d.ts","default":"./index.js"}}',
    '/node_modules/custom-size/index.js': 'export const width = 13;',
    '/node_modules/custom-size/index.d.ts': 'export declare const width: 13;',
  });
  const compiler = new ProjectCompiler(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = height => ({
    files: [
      {
        path: '/model.ts',
        source:
          'import {box} from "@code3d/core"; import {width} from "custom-size"; import {height} from "./child.ts"; export default box(width, height, 3);',
      },
      {path: '/child.ts', source: 'export const height = ' + height + ';'},
    ],
  });
  let language;
  try {
    const first = await compiler.compile(
      project(4),
      '/model.ts',
      undefined,
      value => (language = value),
    );
    assert.equal(first.diagnostic, undefined);
    const runtime = compiler.runtime;
    const second = await compiler.compile(project(5), '/model.ts');
    assert.equal(second.diagnostic, undefined);
    assert.equal(compiler.runtime, runtime);
    assert.notDeepEqual(
      second.fallback.mesh.vertices,
      first.fallback.mesh.vertices,
    );
    assert.ok(
      language.files.some(
        file =>
          file.path === '/node_modules/custom-size/index.d.ts' &&
          file.source.includes('13'),
      ),
    );
    assert.ok(
      !language.files.some(
        file => file.path === '/node_modules/custom-size/index.js',
      ),
    );
    files.files.set(
      '/node_modules/custom-size/index.js',
      'export const width = 20;',
    );
    const third = await compiler.compile(project(5), '/model.ts');
    assert.equal(third.diagnostic, undefined);
    assert.notEqual(compiler.runtime, runtime);
    assert.notDeepEqual(
      third.fallback.mesh.vertices,
      second.fallback.mesh.vertices,
    );
  } finally {
    compiler.dispose();
  }
});

test('uses installed just-range ESM and types with builtin core across cached model revisions', async () => {
  const files = projectFiles({
    '/package.json': '{"dependencies":{"just-range":"4.2.0"}}',
  });
  const compiler = new ProjectCompiler(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  let runtime;
  let range;
  let language;
  try {
    for (const count of [5, 3, 5]) {
      const module = await compiler.compile(
        {
          files: [
            {
              path: '/just-range.ts',
              source: [
                'import range from "just-range";',
                'import {box, group} from "@code3d/core";',
                'const base = box(44, 2, 10);',
                `const bars = range(${count}).map(i =>`,
                '  box(4, 4 + i * 3, 4).relate(part =>',
                '    part.bottom.on(base.top).offset((i - 2) * 8, 0, 0),',
                '  ),',
                ');',
                'export default group([base, ...bars]);',
              ].join('\n'),
            },
          ],
        },
        '/just-range.ts',
        undefined,
        value => {
          language = value;
        },
      );
      assert.equal(module.diagnostic, undefined);
      assert.equal(module.fallback.children.length, count + 1);
      runtime ??= compiler.runtime;
      assert.equal(compiler.runtime, runtime);
      const cachedRange = runtime.modules.get(
        '/node_modules/just-range/index.mjs',
      ).default;
      range ??= cachedRange;
      assert.equal(cachedRange, range);
      assert.deepEqual(cachedRange(3), [0, 1, 2]);
    }
    assert.ok(
      language.files.some(
        file => file.path === '/node_modules/just-range/index.d.ts',
      ),
    );
  } finally {
    compiler.dispose();
  }
});

test('does not substitute App packages when a project declares but has not installed core', async () => {
  const files = {async readFile() {}, async stat() {}};
  const compiler = new ProjectCompiler(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  try {
    await assert.rejects(
      compiler.compile(
        {
          files: [
            {
              path: '/package.json',
              source: '{"type":"module","dependencies":{"@code3d/core":"*"}}',
            },
            {
              path: '/model.ts',
              source: 'import {box} from "@code3d/core"; box(1,2,3);',
            },
          ],
        },
        '/model.ts',
      ),
      error => {
        assert.match(error.diagnostic.summary, /@code3d\/core/);
        assert.deepEqual(error.diagnostic.sourceRef, {
          file: '/model.ts',
          start: 18,
          end: 32,
        });
        return true;
      },
    );
  } finally {
    compiler.dispose();
  }
});

test('preserves top-level await, destructuring, cyclic source imports and literal dynamic imports during tracing', async () => {
  const compiler = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  try {
    const module = await compiler.compile(
      {
        files: [
          {
            path: '/model.ts',
            source: [
              'import {box} from "@code3d/core";',
              'import {height} from "./cyclic.ts";',
              'export function width() { return 12; }',
              'const {size, ...rest} = await import("./dimensions.ts");',
              'if (size !== 20 || rest.other !== 3) throw new Error("stale source");',
              'export default box(size, height(), rest.other);',
            ].join('\n'),
          },
          {
            path: '/cyclic.ts',
            source:
              'import {width} from "./model.ts"; export function height() {return width() / 2;}',
          },
          {
            path: '/dimensions.ts',
            source:
              'export const size = await Promise.resolve(20); export const other = 3;',
          },
        ],
      },
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    assert.ok(module.exports.has('default'));
  } finally {
    compiler.dispose();
  }
});

test('loads a static asset URL from the project and observes changed asset bytes', async () => {
  const files = projectFiles({'/size.json': '{"width":17}'});
  const compiler = new ProjectCompiler(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = {
    files: [
      {
        path: '/model.ts',
        source: [
          'import {box} from "@code3d/core";',
          'const data = await fetch(new URL("./size.json", import.meta.url)).then(response => response.json());',
          'export default box(data.width, 2, 3);',
        ].join('\n'),
      },
    ],
  };
  try {
    const first = await compiler.compile(project, '/model.ts');
    assert.equal(first.diagnostic, undefined);
    files.files.set('/size.json', '{"width":23}');
    const second = await compiler.compile(project, '/model.ts');
    assert.equal(second.diagnostic, undefined);
    assert.notDeepEqual(
      first.fallback.mesh.vertices,
      second.fallback.mesh.vertices,
    );
  } finally {
    compiler.dispose();
  }
});

test('keeps a model retained privately by an installed package valid across source evaluations', async () => {
  const files = projectFiles({
    '/node_modules/template/package.json':
      '{"type":"module","main":"index.js"}',
    '/node_modules/template/index.js':
      'import {box} from "@code3d/core"; const cached = box(12, 4, 8); export function template() { return cached; }',
  });
  const compiler = new ProjectCompiler(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const source = radius =>
    'import {template} from "template"; export default template().fillet(' +
    radius +
    ');';
  try {
    for (const radius of [1, 1.1, 1.2]) {
      const module = await compiler.compile(
        {files: [{path: '/model.ts', source: source(radius)}]},
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
    }
  } finally {
    compiler.dispose();
  }
});

test('does not execute a dynamically imported source module before its branch is reached', async () => {
  const compiler = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = enabled => ({
    files: [
      {
        path: '/model.ts',
        source: [
          'import {box} from "@code3d/core";',
          'const enabled = await Promise.resolve(' + enabled + ');',
          'if (enabled) await import("./lazy.ts");',
          'export default box(4, 5, 6);',
        ].join('\n'),
      },
      {path: '/lazy.ts', source: 'throw new Error("lazy module executed");'},
    ],
  });
  try {
    const first = await compiler.compile(project(false), '/model.ts');
    assert.equal(first.diagnostic, undefined);
    const second = await compiler.compile(project(true), '/model.ts');
    assert.equal(second.diagnostic.summary, 'lazy module executed');
  } finally {
    compiler.dispose();
  }
});

test('does not inherit old source offsets when an installed package returns the same model after edits', async () => {
  const files = projectFiles({
    '/node_modules/template/package.json':
      '{"type":"module","main":"index.js"}',
    '/node_modules/template/index.js':
      'import {box} from "@code3d/core"; const cached = box(12, 4, 8); export function template() { return cached; }',
  });
  const compiler = new ProjectCompiler(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const body = 'import {template} from "template"; export default template();';
  try {
    let nodeId;
    for (const prefix of ['', '\n\n// shifted source\n', '\n']) {
      const source = prefix + body;
      const module = await compiler.compile(
        {files: [{path: '/model.ts', source}]},
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
      const model = module.objects.get(module.exports.get('default'));
      nodeId ??= model.nodeId;
      assert.equal(model.nodeId, nodeId);
      assert.equal(
        model.operation.sourceRef.start,
        source.indexOf('template()'),
      );
      assert.ok(model.sourceRefs.length > 0);
      assert.ok(model.sourceRefs.every(ref => ref.start >= prefix.length));
    }
  } finally {
    compiler.dispose();
  }
});

for (const throughSource of [false, true]) {
  test(`initializes a lazy package only on demand and retains it across edits (${throughSource ? 'through source' : 'direct import'})`, async () => {
    const files = projectFiles({
      '/node_modules/template/package.json':
        '{"type":"module","main":"index.js"}',
      '/node_modules/template/index.js':
        'import {box} from "@code3d/core"; export default box(12, 4, 8);',
    });
    const compiler = new ProjectCompiler(
      files,
      packageTestFiles,
      esbuild,
      () => new Evaluator(),
    );
    const project = enabled => ({
      files: [
        {
          path: '/model.ts',
          source: [
            'import {box} from "@code3d/core";',
            'const enabled = await Promise.resolve(' + enabled + ');',
            `export default enabled ? (await import(${JSON.stringify(throughSource ? './lazy.ts' : 'template')})).default : box(1, 2, 3);`,
          ].join('\n'),
        },
        {path: '/lazy.ts', source: 'export {default} from "template";'},
      ],
    });
    try {
      const first = await compiler.compile(project(false), '/model.ts');
      assert.equal(first.diagnostic, undefined);
      assert.equal(
        compiler.runtime.modules.has('/node_modules/template/index.js'),
        false,
      );
      const second = await compiler.compile(project(true), '/model.ts');
      assert.equal(second.diagnostic, undefined);
      assert.equal(
        compiler.runtime.modules.has('/node_modules/template/index.js'),
        true,
      );
      const third = await compiler.compile(project(true), '/model.ts');
      assert.equal(third.diagnostic, undefined);
      assert.equal(third.exports.get('default'), second.exports.get('default'));
    } finally {
      compiler.dispose();
    }
  });
}

test('releases concurrent waiters on failed dependency evaluation and can load unrelated modules', async () => {
  const files = projectFiles({
    '/node_modules/failure/package.json': '{"type":"module","main":"index.js"}',
    '/node_modules/failure/index.js':
      'await new Promise(resolve=>setTimeout(resolve,20)); throw new Error("dependency failed");',
    '/node_modules/consumer/package.json':
      '{"type":"module","main":"index.js"}',
    '/node_modules/consumer/index.js':
      'import "failure"; export const value=1;',
    '/node_modules/ok/package.json': '{"type":"module","main":"index.js"}',
    '/node_modules/ok/index.js': 'export const value=42;',
  });
  const builder = new ProjectBuilder(files, esbuild);
  const runtime = await ProjectRuntime.create(files, builder, new Evaluator());
  try {
    const failures = await Promise.allSettled([
      runtime.importModule('/node_modules/failure/index.js'),
      runtime.importModule('/node_modules/consumer/index.js'),
      runtime.importModule('/node_modules/failure/index.js'),
    ]);
    assert.ok(
      failures.every(
        result =>
          result.status === 'rejected' &&
          result.reason.message === 'dependency failed',
      ),
    );
    await assert.rejects(
      runtime.importModule('/node_modules/consumer/index.js'),
      /dependency failed/,
    );
    assert.equal(
      (await runtime.importModule('/node_modules/ok/index.js')).value,
      42,
    );
  } finally {
    runtime.dispose();
  }
});

test('locates installed tooling initialization failures at the author import', async () => {
  const files = projectFiles({
    '/package.json': '{"type":"module","dependencies":{"@code3d/core":"*"}}',
    '/node_modules/@code3d/core/bld/tooling/index.js':
      'throw new Error("broken installed core");',
  });
  const compiler = new ProjectCompiler(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const source = 'import {box} from "@code3d/core"; export default box(1,2,3);';
  try {
    await assert.rejects(
      compiler.compile({files: [{path: '/model.ts', source}]}, '/model.ts'),
      error => {
        assert.match(error.diagnostic.summary, /broken installed core/);
        assert.deepEqual(error.diagnostic.sourceRef, {
          file: '/model.ts',
          start: 18,
          end: 32,
        });
        return true;
      },
    );
  } finally {
    compiler.dispose();
  }
});

test('locates a missing relative asset in the original author source', async () => {
  const compiler = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const expression = 'new URL("./missing-dimensions.json", import.meta.url)';
  const source =
    'import {box} from "@code3d/core"; const asset=' +
    expression +
    '; export default box(1,2,3);';
  try {
    await assert.rejects(
      compiler.compile({files: [{path: '/model.ts', source}]}, '/model.ts'),
      error => {
        assert.match(error.diagnostic.summary, /Project asset not found/);
        assert.deepEqual(error.diagnostic.sourceRef, {
          file: '/model.ts',
          start: source.indexOf(expression),
          end: source.indexOf(expression) + expression.length,
        });
        return true;
      },
    );
  } finally {
    compiler.dispose();
  }
});
