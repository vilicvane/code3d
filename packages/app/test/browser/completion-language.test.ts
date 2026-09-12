import {appIsolationHeaders} from '../../build/isolation.ts';
import type {ProjectTypeScriptWorker} from '../../src/monaco/typescript-protocol.ts';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

interface CompletionHarness {
  editor: import('../../src/editor.ts').CodeEditor;
  model: import('monaco-editor/editor').editor.ITextModel;
  language: import('../../src/project/project-language.ts').ProjectLanguage;
  worker(): Promise<ProjectTypeScriptWorker>;
  complete(
    worker: ProjectTypeScriptWorker,
  ): ReturnType<ProjectTypeScriptWorker['getProjectCompletions']>;
  originalWorker?: ProjectTypeScriptWorker;
  setDeclaration?: (source: string | undefined) => void;
}
declare const harness: CompletionHarness;
declare const window: Window & {harness: CompletionHarness};

async function createEditor(t: TestContext) {
  assert.ok(
    process.env.CODE3D_TEST_URL,
    'Set CODE3D_TEST_URL to the task server',
  );
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    {timeout: 15_000},
  );
  t.after(() => browser.close());
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const url = new URL(
    '/__completion-language-test__',
    process.env.CODE3D_TEST_URL,
  ).href;
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: appIsolationHeaders,
      body: '<main style="height:600px"></main>',
    }),
  );
  await page.goto(url);
  await page.evaluate(async () => {
    const {CodeEditor} = await import('/src/editor.ts');
    const {ModelCompilerClient} = await import('/src/model/compiler-client.ts');
    const {browserPackageFiles} =
      await import('/src/project/browser-packages.ts');
    const {projectTypeScriptWorker} =
      await import('/src/monaco/typescript-worker-client.ts');
    const project = {
      files: [
        {
          path: '/model.ts',
          source: "import {box} from '@code3d/core';\nbox(100, 100, 100).up;",
        },
      ],
    };
    const editor = new CodeEditor(
      document.querySelector('main')!,
      project,
      '/model.ts',
    );
    let language:
      | import('../../src/project/project-language.ts').ProjectLanguage
      | undefined;
    const compiler = new ModelCompilerClient(browserPackageFiles, next => {
      language = next;
      editor.setProjectLanguage(next);
    });
    try {
      await compiler.compile(project, '/model.ts');
    } finally {
      compiler.dispose();
    }
    const model = editor.editor.getModel()!;
    window.harness = {
      editor,
      model,
      language: language!,
      worker: () => projectTypeScriptWorker('typescript', model!.uri),
      complete: worker =>
        worker.getProjectCompletions(
          model!.uri.toString(),
          model!.getValueLength(),
        ),
    };
  });
  return page;
}

test(
  'equivalent compilation language snapshots preserve in-flight member completions',
  {timeout: 60_000},
  async t => {
    const page = await createEditor(t);
    const result = await page.evaluate(async () => {
      const h = window.harness;
      h.model.setValue(h.model.getValue().replace(/;$/, '.'));
      const worker = await h.worker();
      const pending = h.complete(worker).then(
        info => info?.entries.map(entry => entry.name),
        (error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      h.editor.setProjectLanguage(structuredClone(h.language));
      const current = await h.worker();
      return {
        sameWorker: current === worker,
        entries: current === worker ? await pending : [],
      };
    });
    assert.equal(
      result.sameWorker,
      true,
      'ordinary model recompilation must not terminate the language worker',
    );
    assert.ok(Array.isArray(result.entries), JSON.stringify(result.entries));
    assert.ok(result.entries.includes('on'));
  },
);

test(
  'declaration changes update completions while compiler-option changes restart the worker',
  {timeout: 60_000},
  async t => {
    const page = await createEditor(t);
    await page.evaluate(async () => {
      const h = window.harness;
      h.originalWorker = await h.worker();
      h.model.setValue('external.');
      h.setDeclaration = source =>
        h.editor.setProjectLanguage({
          ...h.language,
          rootPaths: [
            ...h.language.rootPaths,
            ...(source ? ['/probe.d.ts'] : []),
          ],
          files: [
            ...h.language.files,
            ...(source ? [{path: '/probe.d.ts', source}] : []),
          ],
        });
      h.setDeclaration('declare const external: {before: number};');
    });
    const hasCompletion = (name: string) =>
      page.waitForFunction(
        async name => {
          const h = window.harness;
          return (await h.complete(await h.worker()))?.entries.some(
            entry => entry.name === name,
          );
        },
        name,
        {timeout: 10_000},
      );
    await hasCompletion('before');
    await page.evaluate(() =>
      harness.setDeclaration!('declare const external: {after: number};'),
    );
    await hasCompletion('after');
    assert.equal(
      await page.evaluate(
        async () => (await harness.worker()) === harness.originalWorker,
      ),
      true,
    );
    await page.evaluate(() => harness.setDeclaration!(undefined));
    await page.waitForFunction(
      async () =>
        !(await harness.complete(await harness.worker()))?.entries.some(
          entry => entry.name === 'after',
        ),
      null,
      {timeout: 10_000},
    );
    const result = await page.evaluate(async () => {
      const h = window.harness;
      const before = await h.worker();
      h.model.setValue('const n: number = null;');
      const strict = await before.getSemanticDiagnostics(
        h.model.uri.toString(),
      );
      h.editor.setProjectLanguage({
        ...h.language,
        compilerOptions: {
          ...h.language.compilerOptions,
          strictNullChecks: false,
        },
      });
      const after = await h.worker();
      return {
        restarted: before !== after,
        strict: strict.length,
        relaxed: (await after.getSemanticDiagnostics(h.model.uri.toString()))
          .length,
      };
    });
    assert.equal(result.restarted, true);
    assert.equal(result.strict, 1);
    assert.equal(result.relaxed, 0);
  },
);

test(
  'declaration-map navigation cannot inject roots, globals, or diagnostics into the project',
  {timeout: 60_000},
  async t => {
    const page = await createEditor(t);
    const result = await page.evaluate(async () => {
      const h = window.harness;
      const source =
        "import {api} from 'boundary-fixture'; api('bad'); ''.ghostNavigationMember;";
      const implementation =
        'export function api(value: number) { const bad: number = "wrong"; return value; }\ndeclare global { interface String { ghostNavigationMember: number; } }';
      h.language = {
        ...h.language,
        rootPaths: ['/model.ts'],
        toolingFile: undefined,
        files: [
          {
            path: '/node_modules/boundary-fixture/package.json',
            source: '{"name":"boundary-fixture","types":"index.d.ts"}',
          },
          {
            path: '/node_modules/boundary-fixture/index.d.ts',
            source:
              'export declare function api(value: number): number;\nexport type Hidden = MissingDeclarationType;\n//# sourceMappingURL=index.d.ts.map',
          },
        ],
        navigationFiles: [
          {
            path: '/node_modules/boundary-fixture/index.d.ts.map',
            source: JSON.stringify({
              version: 3,
              sources: ['../../reference.ts'],
              names: [],
              mappings: 'AAAA',
            }),
          },
          {path: '/reference.ts', source: implementation},
        ],
      };
      h.model.setValue(source);
      h.editor.setProjectLanguage(h.language);
      const worker = await h.worker();
      const before = await worker.getSemanticDiagnostics(
        h.model.uri.toString(),
      );
      const declaration = await worker.getSemanticDiagnostics(
        'file:///workspace/node_modules/boundary-fixture/index.d.ts',
      );
      const position = source.indexOf("api('bad')") + 1;
      const definition = await worker.getDefinitionAtPosition(
        h.model.uri.toString(),
        position,
      );
      h.editor.editor.setPosition(h.model.getPositionAt(position));
      await h.editor.openFile(
        new URL(definition![0].fileName).pathname.replace(/^\/workspace/, ''),
      );
      const file = h.editor.currentFile();
      const navUri = 'file:///workspace/reference.ts';
      const navWorker = await h.worker();
      const navigationDiagnostics = await Promise.all([
        navWorker.getSemanticDiagnostics(navUri),
        navWorker.getSyntacticDiagnostics(navUri),
        navWorker.getSuggestionDiagnostics(navUri),
      ]);
      const quickInfo = await navWorker.getQuickInfoAtPosition(
        navUri,
        implementation.indexOf('api') + 1,
      );
      const nestedDefinition = await navWorker.getDefinitionAtPosition(
        navUri,
        implementation.indexOf('return value') + 8,
      );
      const after = await navWorker.getSemanticDiagnostics(
        h.model.uri.toString(),
      );
      const roots = await (
        navWorker as typeof navWorker & {
          getScriptFileNames(): Promise<string[]>;
        }
      ).getScriptFileNames();
      const navigationInProject = h.editor
        .project()
        .files.some(file => file.path === '/reference.ts');
      const navigationModelFile = h.editor.isModelFile('/reference.ts');
      const navigationReadOnly = h.editor.editor.getRawOptions().readOnly;
      h.model.setValue(
        'import {api} from "./reference.ts"; api(1); "".ghostNavigationMember;',
      );
      const direct = await navWorker.getSemanticDiagnostics(navUri);
      const directMain = await navWorker.getSemanticDiagnostics(
        h.model.uri.toString(),
      );
      h.editor.setProjectLanguage({
        ...h.language,
        files: [
          ...h.language.files,
          {path: '/reference.ts', source: implementation},
        ],
        navigationFiles: h.language.navigationFiles.filter(
          file => file.path !== '/reference.ts',
        ),
      });
      const importedReadOnly = h.editor.editor.getRawOptions().readOnly;
      h.model.setValue(source);
      h.editor.setProjectLanguage(h.language);
      const restoredReadOnly = h.editor.editor.getRawOptions().readOnly;
      const removed = await navWorker.getSemanticDiagnostics(navUri);
      return {
        before: before.map(d => d.code),
        after: after.map(d => d.code),
        declaration,
        definition,
        file,
        navigationDiagnostics,
        quickInfo: !!quickInfo,
        nestedDefinition: !!nestedDefinition?.length,
        roots,
        navigationInProject,
        navigationModelFile,
        navigationReadOnly,
        importedReadOnly,
        restoredReadOnly,
        direct: direct.map(d => d.code),
        directMain: directMain.map(d => d.code),
        removed,
      };
    });
    assert.deepEqual(result.before.sort(), [2339, 2345]);
    assert.deepEqual(result.declaration, []);
    assert.equal(result.file, '/reference.ts');
    assert.match(result.definition![0].fileName, /\/reference\.ts$/);
    assert.deepEqual(result.navigationDiagnostics, [[], [], []]);
    assert.ok(result.quickInfo);
    assert.ok(result.nestedDefinition);
    assert.deepEqual(result.after.sort(), result.before.sort());
    assert.deepEqual(result.roots, ['/workspace/model.ts']);
    assert.equal(result.navigationInProject, false);
    assert.equal(result.navigationModelFile, false);
    assert.equal(result.navigationReadOnly, true);
    assert.equal(result.importedReadOnly, false);
    assert.equal(result.restoredReadOnly, true);
    assert.ok(result.direct.includes(2322));
    assert.deepEqual(result.directMain, []);
    assert.deepEqual(result.removed, []);
    await page.waitForFunction(
      () => !window.harness.editor.errorCounts.has('/reference.ts'),
    );
  },
);
