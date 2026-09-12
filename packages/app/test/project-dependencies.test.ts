import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {defined} from '../../../test/assert.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import type {ProjectLanguage} from '../src/project/project-language.ts';
import {
  assertModelDiagnosticError,
  buildTestDependencies,
  evaluateTestBundle,
  packageTestFiles,
  testEvaluatorClass,
} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectAssets: (typeof import('../src/project/project-assets.ts'))['ProjectAssets'];
let ProjectBuilder: (typeof import('../src/project/project-builder.ts'))['ProjectBuilder'];
let ProjectRuntime: (typeof import('../src/model/project-runtime.ts'))['ProjectRuntime'];
let TestModelPipeline: (typeof import('./model-pipeline.ts'))['TestModelPipeline'];
let Evaluator: Awaited<ReturnType<typeof testEvaluatorClass>>;
before(async () => {
  server = await createAppTestServer();
  ({ProjectAssets} = await server.ssrLoadModule<
    typeof import('../src/project/project-assets.ts')
  >('/src/project/project-assets.ts'));
  ({ProjectBuilder} = await server.ssrLoadModule<
    typeof import('../src/project/project-builder.ts')
  >('/src/project/project-builder.ts'));
  ({ProjectRuntime} = await server.ssrLoadModule<
    typeof import('../src/model/project-runtime.ts')
  >('/src/model/project-runtime.ts'));
  ({TestModelPipeline} = await server.ssrLoadModule<
    typeof import('./model-pipeline.ts')
  >('/test/model-pipeline.ts'));
  Evaluator = await testEvaluatorClass(server);
});
after(async () => server?.close());

test('cancellation after Core preparation retains the resources needed by the next execution', async () => {
  const pipeline = new TestModelPipeline(
    packageTestFiles,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = {
    files: [
      {
        path: '/model.ts',
        source:
          'import {box} from "@code3d/core"; export default box(3, 5, 7);',
      },
    ],
  };
  const cancelled = new Error('Cancelled after Core preparation');
  try {
    await assert.rejects(
      pipeline.compile(
        project,
        '/model.ts',
        undefined,
        undefined,
        undefined,
        () => {
          if (pipeline.compiler['dependencies'].prepared) throw cancelled;
        },
      ),
      error => error === cancelled,
    );
    assert.equal(pipeline.compiler['dependencies'].ready, false);
    const module = await pipeline.compile(project, '/model.ts');
    assert.equal(module.diagnostic, undefined);
    assert.ok(defined(defined(module.fallback).mesh).vertices.length > 0);
  } finally {
    await pipeline.dispose();
  }
});

function projectFiles(
  entries: Record<string, string>,
): ProjectFileReader & {files: Map<string, string>} {
  const files = new Map(Object.entries(entries));
  return {
    files,
    async readFile(path) {
      return files.has(path)
        ? new TextEncoder().encode(files.get(path))
        : packageTestFiles.readFile(path);
    },
    async stat(path) {
      if (files.has(path)) return {kind: 'file', version: files.get(path)!};
      if ([...files.keys()].some(file => file.startsWith(path + '/')))
        return {kind: 'directory', version: ''};
      return packageTestFiles.stat(path);
    },
  };
}

test('model analysis follows imports independently of which editor documents are loaded', async () => {
  const root = {
    path: '/model.ts',
    source: 'import {make} from "./helper.ts"; make(10);',
  };
  const helper = {
    path: '/helper.ts',
    source:
      'import {box} from "@code3d/core";\n/** @code3d.arguments [4] */\nexport function make(size: number) { return box(size, 6, 8); }',
  };
  const unrelated = {
    path: '/unrelated.ts',
    source:
      '/** @code3d.arguments nope */\nexport function unrelated() { return 1; }',
  };
  const files = projectFiles({
    [root.path]: root.source,
    [helper.path]: helper.source,
  });
  const compiler = new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  try {
    // No editor model is required for the entry or its dependencies.
    const first = await compiler.compile({files: []}, root.path);
    assert.equal(first.diagnostic, undefined);
    assert.deepEqual(
      first.designArguments.map(context => context.functionRef.file),
      [helper.path],
    );
    assert.ok(
      first.sourceTargets.some(
        target => target.sourceRef.file === helper.path && target.tool,
      ),
    );
    const opened = await compiler.compile(
      {files: [root, helper, unrelated]},
      root.path,
    );
    assert.equal(opened.diagnostic, undefined);
    assert.deepEqual(opened.designArguments, first.designArguments);
    assert.deepEqual(
      defined(opened.fallback).mesh,
      defined(first.fallback).mesh,
    );

    const edited = {...helper, source: helper.source.replace('6, 8', '20, 8')};
    const changed = await compiler.compile(
      {files: [root, edited, unrelated]},
      root.path,
    );
    assert.equal(changed.diagnostic, undefined);
    assert.notDeepEqual(
      defined(changed.fallback).mesh,
      defined(first.fallback).mesh,
    );
    const removed = await compiler.compile(
      {files: [{...root, source: ''}, edited, unrelated]},
      root.path,
    );
    assert.equal(removed.diagnostic, undefined);
    assert.deepEqual(removed.designArguments, []);
    assert.deepEqual(removed.sourceTargets, []);
    assert.equal(removed.objects.size, 0);

    await assert.rejects(
      compiler.compile(
        {files: [unrelated, {...root, source: 'import "./unrelated.ts";'}]},
        root.path,
      ),
      error => {
        assertModelDiagnosticError(error);
        assert.match(error.diagnostic.summary, /array expression/);
        assert.equal(error.diagnostic.sourceRef?.file, unrelated.path);
        return true;
      },
    );
  } finally {
    await compiler.dispose();
  }
});

test('explicit design calls load their file and dependencies without opening editor documents', async () => {
  const source =
    'import {box} from "@code3d/core";\nimport {height} from "./dimensions.ts";\n/** @code3d.arguments [4] */\nexport function design(size: number) { return box(size, height, 8); }';
  const files = projectFiles({
    '/model.ts': '',
    '/design.ts': source,
    '/dimensions.ts': 'export const height = 6;',
  });
  const compiler = new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  try {
    const preset = await compiler.compile({files: []}, '/model.ts', {
      file: '/design.ts',
      offset: source.indexOf('box(size'),
    });
    assert.equal(preset.diagnostic, undefined);
    const context = defined(preset.designArguments[0]);
    assert.equal(preset.activeDesignContextId, context.id);
    assert.ok(preset.objects.size > 0);
    const selected = await compiler.compile({files: []}, '/model.ts', {
      file: context.functionRef.file,
      id: context.id,
    });
    assert.equal(selected.diagnostic, undefined);
    assert.equal(selected.activeDesignContextId, context.id);
    const temporary = await compiler.compile({files: []}, '/model.ts', {
      file: '/design.ts',
      offset: source.indexOf('box(size'),
      arguments: '[12]',
    });
    assert.equal(temporary.diagnostic, undefined);
    assert.ok(temporary.activeDesignContextId?.endsWith(':temporary'));
    assert.ok(temporary.objects.size > 0);
    const rootOnly = await compiler.compile({files: []}, '/model.ts');
    assert.equal(rootOnly.objects.size, 0);
    assert.deepEqual(rootOnly.designArguments, []);
  } finally {
    await compiler.dispose();
  }
});

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
  const assets = new ProjectAssets(files);
  const builder = new ProjectBuilder(files, esbuild, assets);
  const artifact = await buildTestDependencies(
    server,
    files,
    builder,
    assets,
    'void import("first"); void import("second"); void import("shared");',
  );
  const runtime = await ProjectRuntime.create(artifact, new Evaluator());
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
    assets.dispose();
    await builder.dispose();
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
  const assets = new ProjectAssets(files);
  const builder = new ProjectBuilder(files, esbuild, assets);
  const artifact = await buildTestDependencies(
    server,
    files,
    builder,
    assets,
    'void import("clamp"); void import("clamp/data.json"); void import("consumer");',
  );
  const runtime = await ProjectRuntime.create(artifact, new Evaluator());
  const evaluator = new Evaluator();
  try {
    await runtime.importModule('/node_modules/clamp/index.cjs');
    await runtime.importModule('/node_modules/clamp/data.json');
    const source = 'import answer from "consumer"; export {answer};';
    await runtime.importModule('/node_modules/consumer/index.cjs');
    const bundle = await builder.build(source, {
      runtimeFiles: artifact.formats,
    });
    const value = await evaluateTestBundle(server, evaluator, bundle.source, {
      __code3dModules: runtime.modules,
    });
    assert.equal(value.answer, 41);
  } finally {
    runtime.dispose();
    assets.dispose();
    await builder.dispose();
    evaluator.dispose();
  }
});

test('reads installed declarations, reruns changed source, and preserves invalidation across cancelled preparation', async () => {
  const files = projectFiles({
    '/package.json':
      '{"type":"module","dependencies":{"@code3d/core":"*","custom-size":"1.0.0"}}',
    '/node_modules/custom-size/package.json':
      '{"type":"module","exports":{"types":"./index.d.ts","default":"./index.js"}}',
    '/node_modules/custom-size/index.js': 'export const width = 13;',
    '/node_modules/custom-size/index.d.ts': 'export declare const width: 13;',
  });
  const compiler = new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = (height: number) => ({
    files: [
      {
        path: '/model.ts',
        source:
          'import {box} from "@code3d/core"; import {width} from "custom-size"; import {height} from "./child.ts"; export default box(width, height, 3);',
      },
      {path: '/child.ts', source: 'export const height = ' + height + ';'},
    ],
  });
  let language: ProjectLanguage | undefined;
  try {
    const first = await compiler.compile(
      project(4),
      '/model.ts',
      undefined,
      value => (language = value),
    );
    assert.equal(first.diagnostic, undefined);
    const runtime = compiler['runtime'];
    const second = await compiler.compile(project(5), '/model.ts');
    assert.equal(second.diagnostic, undefined);
    assert.ok(compiler.runtime === runtime, 'source edits retain the runtime');
    assert.notDeepEqual(
      defined(defined(second.fallback).mesh).vertices,
      defined(defined(first.fallback).mesh).vertices,
    );
    assert.ok(
      defined(language).files.some(
        file =>
          file.path === '/node_modules/custom-size/index.d.ts' &&
          file.source.includes('13'),
      ),
    );
    assert.ok(
      !defined(language).files.some(
        file => file.path === '/node_modules/custom-size/index.js',
      ),
    );
    files.files.set(
      '/node_modules/custom-size/index.js',
      'export const width = 20;',
    );
    const packagePath = '/node_modules/custom-size/package.json';
    files.files.set(
      packagePath,
      JSON.stringify({
        ...JSON.parse(files.files.get(packagePath)!),
        version: '2.0.0',
      }),
    );
    let cancelled = false;
    const stat = files.stat;
    files.stat = async path => {
      const value = await stat(path);
      if (path === packagePath) cancelled = true;
      return value;
    };
    const stopped = new Error('Cancelled after detecting a dependency change');
    await assert.rejects(
      compiler.compile(
        project(5),
        '/model.ts',
        undefined,
        undefined,
        undefined,
        () => {
          if (cancelled) throw stopped;
        },
      ),
      error => error === stopped,
    );
    files.stat = stat;
    // Cancelling compilation leaves the displayed execution intact until a
    // complete replacement artifact is available. Compare identities without
    // expanding the runtime's WASM memory in an assertion failure.
    assert.ok(
      compiler.runtime === runtime,
      'cancelled compilation retains the previous runtime',
    );
    const third = await compiler.compile(project(5), '/model.ts');
    assert.equal(third.diagnostic, undefined);
    assert.ok(
      compiler.runtime !== runtime,
      'a completed dependency update replaces the runtime',
    );
    assert.notDeepEqual(
      defined(defined(third.fallback).mesh).vertices,
      defined(defined(second.fallback).mesh).vertices,
    );
  } finally {
    await compiler.dispose();
  }
});

test('uses installed just-range ESM and types with builtin core across cached model revisions', async () => {
  const files = projectFiles({
    '/package.json': '{"dependencies":{"just-range":"4.2.0"}}',
  });
  const compiler = new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  let runtime;
  let range;
  let language: ProjectLanguage | undefined;
  try {
    for (const count of [5, 3, 5] as const) {
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
                '    part.down.on(base.up).offset((i - 2) * 8, 0, 0),',
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
      assert.equal(defined(module.fallback).children.length, count + 1);
      runtime ??= compiler['runtime'];
      assert.ok(
        compiler.runtime === runtime,
        'the executor retains its initialized runtime',
      );
      const cachedRange: (count: number) => number[] = defined(
        defined(runtime).modules.get('/node_modules/just-range/index.mjs'),
      ).default;
      range ??= cachedRange;
      assert.equal(cachedRange, range);
      assert.deepEqual(cachedRange(3), [0, 1, 2]);
    }
    assert.ok(
      defined(language).files.some(
        file => file.path === '/node_modules/just-range/index.d.ts',
      ),
    );
  } finally {
    await compiler.dispose();
  }
});

test('does not substitute App packages when a project declares but has not installed core', async () => {
  const files: ProjectFileReader = {
    async readFile() {
      return undefined;
    },
    async stat() {
      return undefined;
    },
  };
  const compiler = new TestModelPipeline(
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
        assertModelDiagnosticError(error);
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
    await compiler.dispose();
  }
});

test('preserves top-level await, destructuring, cyclic source imports and literal dynamic imports during tracing', async () => {
  const compiler = new TestModelPipeline(
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
    await compiler.dispose();
  }
});

test('loads a static asset URL from the project and observes changed asset bytes', async () => {
  const files = projectFiles({'/size.json': '{"width":17}'});
  const compiler = new TestModelPipeline(
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
      defined(defined(first.fallback).mesh).vertices,
      defined(defined(second.fallback).mesh).vertices,
    );
  } finally {
    await compiler.dispose();
  }
});

test('keeps a model retained privately by an installed package valid across source evaluations', async () => {
  const files = projectFiles({
    '/node_modules/template/package.json':
      '{"type":"module","main":"index.js"}',
    '/node_modules/template/index.js':
      'import {box} from "@code3d/core"; const cached = box(12, 4, 8); export function template() { return cached; }',
  });
  const compiler = new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const source = (radius: number) =>
    'import {template} from "template"; export default template().fillet(' +
    radius +
    ');';
  try {
    for (const radius of [1, 1.1, 1.2] as const) {
      const module = await compiler.compile(
        {files: [{path: '/model.ts', source: source(radius)}]},
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
    }
  } finally {
    await compiler.dispose();
  }
});

test('does not execute a dynamically imported source module before its branch is reached', async () => {
  const compiler = new TestModelPipeline(
    packageTestFiles,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = (enabled: boolean) => ({
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
    assert.equal(defined(second.diagnostic).summary, 'lazy module executed');
  } finally {
    await compiler.dispose();
  }
});

test('does not inherit old source offsets when an installed package returns the same model after edits', async () => {
  const files = projectFiles({
    '/node_modules/template/package.json':
      '{"type":"module","main":"index.js"}',
    '/node_modules/template/index.js':
      'import {box} from "@code3d/core"; const cached = box(12, 4, 8); export function template() { return cached; }',
  });
  const compiler = new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const body = 'import {template} from "template"; export default template();';
  try {
    let nodeId;
    for (const prefix of ['', '\n\n// shifted source\n', '\n'] as const) {
      const source = prefix + body;
      const module = await compiler.compile(
        {files: [{path: '/model.ts', source}]},
        '/model.ts',
      );
      assert.equal(module.diagnostic, undefined);
      const model = module.objects.get(defined(module.exports.get('default')));
      nodeId ??= defined(model).nodeId;
      assert.equal(defined(model).nodeId, nodeId);
      assert.equal(
        defined(defined(model).operation.sourceRef).start,
        source.indexOf('template()'),
      );
      assert.ok(defined(model).sourceRefs.length > 0);
      assert.ok(
        defined(model).sourceRefs.every(ref => ref.start >= prefix.length),
      );
    }
  } finally {
    await compiler.dispose();
  }
});

for (const throughSource of [false, true] as const) {
  test(`initializes a lazy package only on demand and retains it across edits (${throughSource ? 'through source' : 'direct import'})`, async () => {
    const files = projectFiles({
      '/node_modules/template/package.json':
        '{"type":"module","main":"index.js"}',
      '/node_modules/template/index.js':
        'import {box} from "@code3d/core"; export default box(12, 4, 8);',
    });
    const compiler = new TestModelPipeline(
      files,
      packageTestFiles,
      esbuild,
      () => new Evaluator(),
    );
    const project = (enabled: boolean) => ({
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
        defined(compiler['runtime']).modules.has(
          '/node_modules/template/index.js',
        ),
        false,
      );
      const second = await compiler.compile(project(true), '/model.ts');
      assert.equal(second.diagnostic, undefined);
      assert.equal(
        defined(compiler['runtime']).modules.has(
          '/node_modules/template/index.js',
        ),
        true,
      );
      const third = await compiler.compile(project(true), '/model.ts');
      assert.equal(third.diagnostic, undefined);
      assert.equal(third.exports.get('default'), second.exports.get('default'));
    } finally {
      await compiler.dispose();
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
  const assets = new ProjectAssets(files);
  const builder = new ProjectBuilder(files, esbuild, assets);
  const artifact = await buildTestDependencies(
    server,
    files,
    builder,
    assets,
    'void import("failure"); void import("consumer"); void import("ok");',
  );
  const runtime = await ProjectRuntime.create(artifact, new Evaluator());
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
    assets.dispose();
    await builder.dispose();
  }
});

test('locates installed tooling initialization failures at the author import', async () => {
  const files = projectFiles({
    '/package.json': '{"type":"module","dependencies":{"@code3d/core":"*"}}',
    '/node_modules/@code3d/core/bld/tooling/index.js':
      'throw new Error("broken installed core");',
  });
  const compiler = new TestModelPipeline(
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
        assertModelDiagnosticError(error);
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
    await compiler.dispose();
  }
});

test('locates a missing relative asset in the original author source', async () => {
  const compiler = new TestModelPipeline(
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
        assertModelDiagnosticError(error);
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
    await compiler.dispose();
  }
});

test('synchronous font assets invalidate on file edits and batch text operations retain source tools', async () => {
  let path = '/packages/core/test/fonts/DejaVuSans.ttf';
  let revision = 1;
  const files: ProjectFileReader = {
    readFile: file =>
      packageTestFiles.readFile(file === '/font.ttf' ? path : file),
    async stat(file) {
      return file === '/font.ttf'
        ? {kind: 'file', version: String(revision)}
        : packageTestFiles.stat(file);
    },
  };
  const compiler = new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = {
    files: [
      {
        path: '/font.ts',
        source:
          'import {font} from "@code3d/core"; export const sans = font(new URL("./font.ttf", import.meta.url));',
      },
      {
        path: '/model.ts',
        source:
          'import {text, extrude, group} from "@code3d/core"; import {sans} from "./font.ts"; const profiles = text("B8i", sans, 10); export const lettering = group(extrude(profiles, 2));',
      },
    ],
  };
  try {
    const first = await compiler.compile(project, '/model.ts');
    assert.equal(first.diagnostic, undefined);
    const solids = [...first.objects.values()].filter(
      object => object.operation.kind === 'extrude',
    );
    assert.equal(solids.length, 4);
    const output = defined(
      first.sourceTargets.find(
        target =>
          target.kind === 'operation-output' &&
          target.sourceRef.file === '/model.ts' &&
          project.files[1].source.slice(
            target.sourceRef.start,
            target.sourceRef.end,
          ) === 'extrude(profiles, 2)',
      ),
    );
    assert.equal(output.evaluations[0].nodeIds.length, 4);
    assert.equal(
      defined(output.tool).signature.parameters.find(
        parameter => parameter.name === 'distance',
      )?.kind,
      'length',
    );
    assert.equal(
      defined(output.evaluations[0].parameters).find(
        parameter => parameter.argument === 'distance',
      )?.value,
      2,
    );
    const before = compiler.kernelCacheStats;
    const second = await compiler.compile(project, '/model.ts');
    assert.equal(second.diagnostic, undefined);
    assert.ok(
      defined(compiler.kernelCacheStats.memory).hits >
        defined(before.memory).hits,
    );
    path = '/packages/core/test/fonts/NotoSansCJK-subset.otf';
    revision++;
    const changed = await compiler.compile(project, '/model.ts');
    assert.equal(changed.diagnostic, undefined);
    assert.notDeepEqual(
      solids.map(solid => solid.mesh),
      [...changed.objects.values()]
        .filter(object => object.operation.kind === 'extrude')
        .map(solid => solid.mesh),
    );
    path = '/packages/core/test/fonts/DejaVuSans.ttf';
    revision++;
    const restored = await compiler.compile(project, '/model.ts');
    assert.equal(restored.diagnostic, undefined);
    assert.deepEqual(
      solids.map(solid => solid.mesh),
      [...restored.objects.values()]
        .filter(object => object.operation.kind === 'extrude')
        .map(solid => solid.mesh),
    );
  } finally {
    await compiler.dispose();
  }
});
