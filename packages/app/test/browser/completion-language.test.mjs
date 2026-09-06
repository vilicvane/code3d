import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

async function createEditor(t) {
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
      document.querySelector('main'),
      project,
      '/model.ts',
    );
    let language;
    const compiler = new ModelCompilerClient(browserPackageFiles, next => {
      language = next;
      editor.setProjectLanguage(next);
    });
    try {
      await compiler.compile(project, '/model.ts');
    } finally {
      compiler.dispose();
    }
    const model = editor.editor.getModel();
    window.harness = {
      editor,
      model,
      language,
      worker: () => projectTypeScriptWorker('typescript', model.uri),
      complete: worker =>
        worker.getProjectCompletions(
          model.uri.toString(),
          model.getValueLength(),
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
        error => ({error: error.message}),
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
          files: [
            ...h.language.files,
            ...(source ? [{path: '/probe.d.ts', source}] : []),
          ],
        });
      h.setDeclaration('declare const external: {before: number};');
    });
    const hasCompletion = name =>
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
      harness.setDeclaration('declare const external: {after: number};'),
    );
    await hasCompletion('after');
    assert.equal(
      await page.evaluate(
        async () => (await harness.worker()) === harness.originalWorker,
      ),
      true,
    );
    await page.evaluate(() => harness.setDeclaration(undefined));
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
