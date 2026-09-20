import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {chromium} from './browser-connection.ts';
import {appIsolationHeaders} from '../../build/response-headers.ts';

declare const window: Window & {
  inspectionApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
    resumeInspection?: () => void;
  };
};

test(
  'gear array member carets draw only the assembled gears on screen and in exports',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[mobx\]/i.test(message.text())) errors.push(message.text());
    });
    const url = new URL(
      '/__gear-inspection-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main style="width:900px;height:700px"></main>',
      }),
    );
    await page.goto(url);
    const source = await readFile(
      new URL('../../examples/packages/gears/assembly.ts', import.meta.url),
      'utf8',
    );
    const samples = await page.evaluate(async source => {
      const path = '/test/browser/relation-focus-fixture.ts';
      const fixture: typeof import('./relation-focus-fixture.ts') =
        await import(path);
      return fixture.measureGearAssemblyFocus(source);
    }, source);
    for (const sample of samples) {
      const focused = ['pinion', 'wheel', 'idler'].indexOf(sample.focus);
      for (const draws of [sample.onscreen, sample.exported]) {
        assert.equal(
          draws.length,
          3,
          `${sample.focus}: an input gear must not reappear outside the inspector scene`,
        );
        draws.sort((a, b) => a.position[0] - b.position[0]);
        const positions = [
          [0, 0, 0],
          [50.2, 0, 0],
          [75.3, 0, (50.2 * Math.sqrt(3)) / 2],
        ];
        draws.forEach((draw, index) => {
          draw.position.forEach((value, axis) =>
            assert.ok(Math.abs(value - positions[index][axis]) < 1e-6),
          );
          assert.equal(
            draw.opacity,
            focused < 0 || focused === index ? 0.82 : 0.4,
            sample.focus,
          );
        });
      }
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'the App inspects failed calls and preserves the modeling diagnostic through inspection and repair',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[mobx\]/i.test(message.text())) errors.push(message.text());
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.inspectionApp = {viewport, codeEditor, compiler, previewState};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(() => {
      const source = `import {box, captureInspectData} from '@code3d/core';
      /** @code3d.inspect broken.inspect */
      function broken(width: number) { captureInspectData(box(width, 2, 3)); throw new Error('Model failed'); }
      namespace broken {
        export function inspect(_args, context) {
          if (context.return !== undefined) throw new Error('Expected a failed call');
          return {target: [context.data]};
        }
      }
      broken(7);`;
      const editor = window.inspectionApp.codeEditor.editor;
      editor.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.lastIndexOf('broken(7)') + 7),
      );
    });
    await page.waitForFunction(
      () =>
        window.inspectionApp.viewport['inspectionScene']?.target.length === 1 &&
        window.inspectionApp.previewState.diagnostic?.summary ===
          'Model failed',
    );
    const failed = await page.evaluate(() => {
      const {viewport, previewState} = window.inspectionApp;
      return {
        diagnostic: previewState.diagnostic?.summary,
        inspectionError: previewState.inspectionDiagnostic,
        meshes: [...viewport['occurrences'].values()].filter(
          value => value.node.mesh,
        ).length,
      };
    });
    assert.deepEqual(failed, {
      diagnostic: 'Model failed',
      inspectionError: undefined,
      meshes: 1,
    });
    for (const displaced of [true, false]) {
      await page.evaluate(displaced => {
        const source = `import {box, intersect} from '@code3d/core';
        const a = box(4,4,4), b = box(6,6,6)${displaced ? '.originOffset(-20,0,0)' : ''};
        export default intersect([a,b]);`;
        const editor = window.inspectionApp.codeEditor.editor;
        editor.setValue(source);
        editor.setPosition(
          editor.getModel()!.getPositionAt(source.lastIndexOf('[a,b]') + 1),
        );
      }, displaced);
      await page.waitForFunction(displaced => {
        const {viewport, previewState} = window.inspectionApp;
        const scene = viewport['inspectionScene'];
        return (
          !previewState.inspecting &&
          scene?.ambient.length === 1 &&
          scene.target.length === (displaced ? 1 : 2) &&
          scene.target[0].focused &&
          !!previewState.diagnostic === displaced
        );
      }, displaced);
      const state = await page.evaluate(() => ({
        diagnostic: window.inspectionApp.previewState.diagnostic?.summary,
        inspectionError: window.inspectionApp.previewState.inspectionDiagnostic,
      }));
      assert.equal(state.inspectionError, undefined);
      if (displaced) assert.match(state.diagnostic!, /no common solid volume/);
      else assert.equal(state.diagnostic, undefined);
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'inspection snapshots cross the real Worker boundary and superseded requests cannot publish',
  {timeout: 90_000},
  async t => {
    assert.ok(
      process.env.CODE3D_TEST_URL,
      'Set CODE3D_TEST_URL to the task server',
    );
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(
      '/__source-inspection-test__',
      process.env.CODE3D_TEST_URL,
    );
    await page.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Source inspection</main>',
      }),
    );
    await page.goto(url.href);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const source = `import {box, dimension, boundsAnnotation, captureInspectData} from '@code3d/core';
      /** @code3d.inspect size part.inspect */
      function part(size: number) {
        captureInspectData({size});
        return box(size, 2, 3);
      }
      namespace part {
        export function inspect(_args, context) {
          const {size} = context.data;
          if (size === 3) throw new Error('Invalid inspection');
          const model = box(size * 2, 2, 3);
          return {target: [model, dimension({owner: model, start: [0, 0, 0], end: [size, 0, 0], value: size}), boundsAnnotation({owner: model, size: [size, 2, 3], frame: {position: [1, 2, 3], quaternion: [0, 0, 0, 1]}})]};
        }
      }
      const first = part(5);
      const failed = part(3);
      export default part(7);`;
      const compile = (source: string) =>
        client.compile({files: [{path: '/model.ts', source}]}, '/model.ts');
      try {
        const module = await compile(source);
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        const at = (text: string) => ({
          file: '/model.ts',
          offset: source.lastIndexOf(text) + 'part('.length,
        });
        const first = client.inspect(module, at('part(5)')).then(
          () => 'published',
          error => error.message,
        );
        const second = await client.inspect(module, at('part(7)'));
        const superseded = await first;
        const invalid = await client.inspect(module, at('part(3)')).then(
          () => undefined,
          error => ({
            kind: error.diagnostic?.kind,
            summary: error.diagnostic?.summary,
          }),
        );
        const afterError = await client.inspect(module, at('part(7)'));
        const changing = client.inspect(module, at('part(5)')).then(
          () => 'published',
          error => error.message,
        );
        const next = await compile(
          `import {box} from '@code3d/core'; export default box(9, 2, 3);`,
        );
        const duringCompile = await changing;
        const obsolete = await client.inspect(module, at('part(7)')).then(
          () => 'published',
          error => error.message,
        );
        return {
          superseded,
          second,
          invalid,
          afterError,
          duringCompile,
          obsolete,
          nextDiagnostic: next.diagnostic,
        };
      } finally {
        client.dispose();
      }
    });
    assert.equal(result.superseded, 'Inspection superseded.');
    assert.equal(result.duringCompile, 'Inspection superseded.');
    assert.equal(
      result.obsolete,
      'The inspected model execution is no longer available.',
    );
    assert.deepEqual(result.invalid, {
      kind: 'inspect',
      summary: 'Invalid inspection',
    });
    assert.equal(result.nextDiagnostic, undefined);
    const marker = result.second?.target[1];
    assert.equal(marker?.kind, 'dimension');
    if (marker?.kind !== 'dimension') return;
    assert.ok('start' in marker);
    assert.equal(marker.value, 7);
    assert.deepEqual(marker.end, [7, 0, 0]);
    assert.equal(result.afterError?.target[1].kind, 'dimension');
    const bounds = result.second?.target[2];
    assert.equal(bounds?.kind, 'bounds');
    if (bounds?.kind === 'bounds') {
      assert.deepEqual(bounds.size, [7, 2, 3]);
      assert.deepEqual(bounds.frame.position, [1, 2, 3]);
      assert.equal(bounds.model.nodeId, marker.model.nodeId);
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'the App retains its complete scene while inspecting and reports inspector errors without replacing it',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000},
    });
    t.after(() => context.close());
    t.after(() => browser.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[MobX\]/i.test(message.text())) errors.push(message.text());
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.inspectionApp = {viewport, codeEditor, compiler, previewState};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(() => {
      const source = `import {box, dimension} from '@code3d/core';
      /** @code3d.inspect size part.inspect */
      function part(size: number) { return box(size, 2, 3); }
      namespace part {
        export function inspect([size]) {
          if (size === 3) throw new Error('Cannot inspect this part');
          const body = box(size, 2, 3);
          return {target: [body, dimension({owner: body, start: [0, 0, 0], end: [size, 0, 0], value: size})]};
        }
      }
      part(3);
      part(9);
      export default part(5);`;
      const editor = window.inspectionApp.codeEditor.editor;
      editor.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.lastIndexOf('part(5)') + 5),
      );
    });
    await page.waitForFunction(() =>
      window.inspectionApp.viewport['decorationLayers']
        .get('inspection')
        ?.some(value => value.measurement?.userData.decoration.value === 5),
    );
    const pending = await page.evaluate(() => {
      const {compiler, codeEditor, viewport} = window.inspectionApp;
      const inspect = compiler.inspect.bind(compiler);
      compiler.inspect = async (...args) => {
        await new Promise<void>(resolve => {
          window.inspectionApp.resumeInspection = resolve;
        });
        return inspect(...args);
      };
      const original = viewport['root'].children.map(value => value.uuid);
      const marker = viewport['decorationLayers']
        .get('inspection')!
        .find(value => value.measurement)!.measurement!.uuid;
      const editor = codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().lastIndexOf('part(9)') + 5),
      );
      return {original, marker};
    });
    await page.waitForFunction(
      () =>
        window.inspectionApp.previewState.inspecting &&
        !!window.inspectionApp.resumeInspection,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.inspectionApp.viewport['root'].children.map(value => value.uuid),
      ),
      pending.original,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.inspectionApp.viewport['decorationLayers']
            .get('inspection')!
            .find(value => value.measurement)!.measurement!.uuid,
      ),
      pending.marker,
    );
    await page.evaluate(() => window.inspectionApp.resumeInspection!());
    await page.waitForFunction(() =>
      window.inspectionApp.viewport['decorationLayers']
        .get('inspection')
        ?.some(value => value.measurement?.userData.decoration.value === 9),
    );
    await page.evaluate(() => {
      const editor = window.inspectionApp.codeEditor.editor;
      window.inspectionApp.resumeInspection = undefined;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().lastIndexOf('part(3)') + 5),
      );
    });
    await page.waitForFunction(() => !!window.inspectionApp.resumeInspection);
    await page.evaluate(() => window.inspectionApp.resumeInspection!());
    await page.getByText('Cannot inspect this part', {exact: true}).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.inspectionApp.previewState.module?.diagnostic,
      ),
      undefined,
    );
    assert.ok(
      await page.evaluate(() =>
        window.inspectionApp.viewport['decorationLayers']
          .get('inspection')
          ?.some(value => value.measurement?.userData.decoration.value === 9),
      ),
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'renders distance inspector values with the original placements and screen-sized annotations',
  {timeout: 90_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1000, height: 700},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[MobX\]/i.test(message.text())) errors.push(message.text());
    });
    const url = new URL(
      '/__inspection-renderer-test__',
      process.env.CODE3D_TEST_URL,
    );
    await page.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<style>html,body,main{margin:0;width:100%;height:100%;overflow:hidden}</style><main></main>',
      }),
    );
    await page.goto(url.href);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main')!, {
        animateViewChanges: false,
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
      });
      const source = `import {box, distance, offset, group} from '@code3d/core';
      const base = box(10, 10, 10);
      const part = box(2, 2, 2).relate(self => {
        distance(base.right, self.left, 'x');
        return [self.on(base.right), offset(3, 0, 0)];
      });
      distance(base.right, part.left, 'x');
      export default group([base, part]);`;
      try {
        const module = await client.compile(
          {files: [{path: '/model.ts', source}]},
          '/model.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        const render = async (token: string) => {
          const selection = {file: '/model.ts', offset: source.indexOf(token)};
          const scene = await client.inspect(module, selection);
          if (!scene) throw new Error('Missing inspection');
          viewport.renderInspection(module, scene, selection);
          viewport.setView({direction: [0, 0, 1], up: [0, 1, 0]});
          await new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const marker = viewport['decorationLayers']
            .get('inspection')
            ?.find(value => value.measurement)?.measurement;
          if (!marker) throw new Error('Missing rendered dimension');
          const label = marker.getObjectByName('distance-label')!;
          const data = marker.userData.decoration;
          const projected = (y: number) =>
            viewport['camera'].position
              .clone()
              .set(0, y, 0)
              .applyMatrix4(label.matrixWorld)
              .project(viewport['camera']);
          const p = projected(-0.5),
            q = projected(0.5);
          return {
            value: data.value,
            start: data.start,
            end: data.end,
            labelPixels: Math.hypot(p.x - q.x, p.y - q.y) * 350,
            contextCount: viewport['contextOccurrences'].size,
            bodyTransforms: viewport
              .renderedOccurrences()
              .filter(value => value.node.mesh)
              .map(value =>
                value.object
                  .getWorldPosition(value.object.position.clone())
                  .toArray(),
              ),
          };
        };
        const before = await render('distance(base.right, self.left');
        const after = await render('distance(base.right, part.left');
        const selection = {
          file: '/model.ts',
          offset: source.indexOf('.on(') + 1,
        };
        const onScene = await client.inspect(module, selection);
        if (!onScene) throw new Error('Missing on inspection');
        viewport.renderInspection(module, onScene, selection);
        viewport.setView({direction: [1, 0.6, 1], up: [0, 1, 0]});
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const bounds =
          viewport['decorationLayers']
            .get('inspection')
            ?.filter(value => value.bounds) ?? [];
        const on = bounds.map(instance => ({
          visible: instance.object.visible,
          ...instance.object.children[0].userData.decoration,
        }));
        let onArrows = 0;
        for (const instance of viewport['decorationLayers'].get('inspection') ??
          [])
          instance.object.traverse(object => {
            if (object.name === 'direction-arrow-head') onArrows++;
          });
        return {before, after, on, onArrows};
      } finally {
        client.dispose();
      }
    });
    assert.equal(result.before.value, 6);
    assert.deepEqual(result.before.end, [-1, 0, 0]);
    assert.equal(result.after.value, 3);
    assert.deepEqual(result.after.end, [8, 0, 0]);
    assert.ok(
      result.before.bodyTransforms.every(position => position[0] === 0),
    );
    assert.ok(result.after.bodyTransforms.some(position => position[0] === 9));
    assert.ok(
      Math.abs(result.before.labelPixels - result.after.labelPixels) < 0.5,
    );
    assert.ok(result.after.labelPixels > 15 && result.after.labelPixels < 40);
    assert.equal(result.on.length, 1);
    assert.equal(result.on[0].visible, true);
    assert.deepEqual(result.on[0].size, [2, 2, 2]);
    assert.deepEqual(result.on[0].transform.position, [6, 0, 0]);
    assert.equal(result.onArrows, 2);
    await page.screenshot({path: '/tmp/code3d-180-on-inspector.png'});
    assert.deepEqual(errors, []);
  },
);

test(
  'candidate dimensions select a nearby edge once and retain it across orbiting and repeated inspection',
  {timeout: 90_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1000, height: 700},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.text().includes('[mobx]')) errors.push(message.text());
    });
    const url = new URL('/__candidate-dimension__', process.env.CODE3D_TEST_URL)
      .href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<style>body{margin:0}main{width:1000px;height:700px}canvas{width:100%;height:100%}</style><main></main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main')!, {
        animateViewChanges: false,
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
      });
      const source = `import {box} from '@code3d/core'; export default box(12,14,16);`;
      try {
        const module = await client.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        viewport.setView({direction: [1, 1, 1], up: [0, 1, 0]});
        const selection = {file: '/main.ts', offset: source.indexOf('12,')};
        const scene = (await client.inspect(module, selection))!;
        const candidates = scene.target.find(item => item.kind === 'dimension');
        if (!candidates || !('candidates' in candidates))
          throw new Error('Missing candidate dimension');
        const frame = async () => {
          await new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const marker = viewport['decorationLayers']
            .get('inspection')
            ?.find(item => item.measurement)?.measurement;
          if (!marker) throw new Error('Missing rendered candidate');
          const {start, end} = marker.userData.decoration;
          return {
            start,
            end,
            text: marker.getObjectByName('distance-label')!.userData.text,
          };
        };
        viewport.renderInspection(module, scene, selection);
        const first = await frame();
        viewport.setView({direction: [-1, -1, -1], up: [0, 1, 0]});
        const orbited = await frame();
        viewport.renderInspection(
          module,
          (await client.inspect(module, selection))!,
          selection,
        );
        const repeated = await frame();
        const call = {file: '/main.ts', offset: source.indexOf('box(12')};
        viewport.renderInspection(
          module,
          (await client.inspect(module, call))!,
          call,
        );
        if (
          viewport['decorationLayers']
            .get('inspection')
            ?.some(item => item.measurement)
        )
          throw new Error('Call result retained parameter annotation');
        viewport.renderInspection(
          module,
          (await client.inspect(module, selection))!,
          selection,
        );
        return {
          first,
          orbited,
          repeated,
          reentered: await frame(),
          candidates: candidates.candidates,
        };
      } finally {
        client.dispose();
      }
    });
    assert.equal(result.first.text, '12 · X');
    assert.deepEqual(result.orbited, result.first);
    assert.deepEqual(result.repeated, result.first);
    assert.notDeepEqual(result.reentered.start, result.first.start);
    for (const value of [result.first, result.reentered])
      assert.ok(
        result.candidates.some(
          segment =>
            JSON.stringify(segment) ===
            JSON.stringify({start: value.start, end: value.end}),
        ),
      );
    await page.screenshot({path: '/tmp/code3d-180-parameter-dimension.png'});
    assert.deepEqual(errors, []);
  },
);

test(
  'Sketch inspection draws mixed 3D planes and opens 2D editing on a sketch',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[mobx\]/i.test(message.text())) errors.push(message.text());
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.inspectionApp = {viewport, codeEditor, compiler, previewState};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(() => {
      const source = `import {box, sketch} from '@code3d/core';
const stock = box(20,20,20);
const base = sketch([['point', 1, [0,0]], ['point', 2, [15,0]], ['line', 3, [1,2]], ['circle', 4, [1,5]]]);
const profile = base.relate(s => s.plane.align(stock.up));
const side = base.relate(s => s.plane.align(stock.right));
/** @code3d.inspect show.inspect */
function show() { return stock; }
namespace show { export function inspect() { return {ambient: [stock], target: [profile, side]}; } }
export default show();`;
      const editor = window.inspectionApp.codeEditor.editor;
      editor.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.lastIndexOf('show();') + 1),
      );
    });
    await page.waitForFunction(
      () =>
        window.inspectionApp.viewport['inspectionScene']?.target.filter(
          item => item.kind === 'sketch',
        ).length === 2,
    );
    const scene = await page.evaluate(() => {
      const viewport = window.inspectionApp.viewport;
      viewport['root'].updateWorldMatrix(true, true);
      return [...viewport['occurrences'].values()]
        .filter(value => value.sketchId)
        .map(value => ({
          position: value.object.position.toArray(),
          quaternion: value.object.quaternion.toArray(),
          expected: value.node.compositionTransform,
          primitives: value.object.children.map(child => child.type),
        }));
    });
    assert.equal(scene.length, 2);
    assert.notDeepEqual(scene[0].quaternion, scene[1].quaternion);
    for (const sketch of scene) {
      assert.deepEqual(sketch.position, sketch.expected.position);
      assert.deepEqual(sketch.quaternion, sketch.expected.quaternion);
      assert.deepEqual(sketch.primitives, [
        'Points',
        'Points',
        'LineSegments',
        'LineSegments',
      ]);
    }
    assert.equal(
      await page.getByRole('region', {name: 'Sketch editor'}).isVisible(),
      false,
    );
    await page.screenshot({path: '/tmp/code3d-180-sketch-3d.png'});
    await page.evaluate(() => {
      const editor = window.inspectionApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('profile =') + 1),
      );
    });
    await page.getByRole('region', {name: 'Sketch editor'}).waitFor();
    assert.equal(
      await page.locator('.sketch-canvas circle.local[data-id="1"]').count(),
      1,
    );
    await page.screenshot({path: '/tmp/code3d-180-sketch-2d.png'});
    await page.evaluate(() => {
      const editor = window.inspectionApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('show();') + 1),
      );
    });
    await page
      .getByRole('region', {name: 'Sketch editor'})
      .waitFor({state: 'hidden'});
    await page.evaluate(() => {
      const editor = window.inspectionApp.codeEditor.editor;
      editor.setValue(
        "import {sketch} from '@code3d/core';\nconst empty = sketch([]);\nexport default empty;",
      );
      editor.setPosition({lineNumber: 2, column: 8});
    });
    await page.getByRole('region', {name: 'Sketch editor'}).waitFor();
    assert.equal(await page.locator('.sketch-canvas circle.local').count(), 0);
    assert.deepEqual(errors, []);
  },
);

test(
  'read-only length, area and volume display geometry, screen-sized labels and annotated exports',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000},
      deviceScaleFactor: 2,
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[mobx\]/i.test(message.text())) errors.push(message.text());
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.inspectionApp = {viewport, codeEditor, compiler, previewState};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(() => {
      const editor = window.inspectionApp.codeEditor.editor;
      editor.setValue(`import {line, arc, rectangle, tube, group} from '@code3d/core';
const straight = line([30, 40, 0]);
const curve = arc([20, 0, 0], [0, 20, 0], [-20, 0, 0]);
const sheet = rectangle(30, 20);
const pipe = tube(15, 10, 40);
const a = straight.length;
const b = curve.length;
const c = sheet.area;
const d = pipe.area;
const e = pipe.surfaces()[0].area;
const f = pipe.volume;
export default group([straight, curve, sheet, pipe]);`);
    });
    for (const [token, value, line] of [
      ['straight.length', 50, true],
      ['curve.length', 20 * Math.PI, false],
      ['sheet.area', 600, false],
      ['pipe.area', 2250 * Math.PI, false],
      ['pipe.volume', 5000 * Math.PI, false],
    ] as const) {
      await page.evaluate(token => {
        const editor = window.inspectionApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(
              editor.getValue().indexOf(token) + token.lastIndexOf('.') + 2,
            ),
        );
      }, token);
      await page.waitForFunction(value => {
        const {viewport, previewState} = window.inspectionApp;
        const measurement = viewport['inspectionScene']?.target.find(
          item => item.kind === 'dimension',
        );
        return (
          !previewState.inspecting &&
          measurement?.kind === 'dimension' &&
          Math.abs(measurement.value - value) < 1e-5
        );
      }, value);
      const rendered = await page.evaluate(async () => {
        const {viewport, previewState} = window.inspectionApp;
        const layers = viewport['decorationLayers'].get('inspection')!;
        const measurement = layers.find(item => item.measurement)!.measurement!;
        const label = measurement.getObjectByName('distance-label')!;
        const camera = viewport['camera'];
        const height = viewport['renderer'].domElement.clientHeight;
        const pixels = () => {
          const a = label.position
            .clone()
            .set(0, -0.5, 0)
            .applyMatrix4(label.matrixWorld)
            .project(camera);
          const b = label.position
            .clone()
            .set(0, 0.5, 0)
            .applyMatrix4(label.matrixWorld)
            .project(camera);
          return (Math.hypot(a.x - b.x, a.y - b.y) * height) / 2;
        };
        const before = pixels();
        camera.zoom *= 1.5;
        camera.updateProjectionMatrix();
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const zoomed = pixels();
        const png = await viewport.captureImage(1200, 800);
        camera.zoom /= 1.5;
        camera.updateProjectionMatrix();
        viewport['rendering'].renderFrame();
        return {
          text: label.userData.text,
          line: !!measurement.getObjectByName('distance-line'),
          ticks: measurement['ticks'].geometry.instanceCount,
          before,
          zoomed,
          pngBytes: png.size,
          diagnostic: previewState.inspectionDiagnostic,
          tools: viewport.sourceContext?.target.tool,
          targets: viewport['inspectionScene']!.target.map(item => item.kind),
        };
      });
      assert.equal(rendered.line, line);
      assert.equal(rendered.ticks, line ? 2 : 0);
      assert.ok(Math.abs(rendered.before - 24) < 0.01);
      assert.ok(Math.abs(rendered.zoomed - 24) < 0.01);
      assert.ok(rendered.pngBytes > 1000);
      assert.equal(rendered.diagnostic, undefined);
      assert.equal(rendered.tools, undefined);
      assert.ok(
        rendered.targets.includes(
          token.startsWith('pipe.') ? 'model' : 'anchor',
        ),
      );
      assert.match(
        rendered.text,
        token.includes('volume')
          ? /volume$/
          : token.includes('area')
            ? /area$/
            : token.startsWith('curve')
              ? /arc length$/
              : /^50$/,
      );
      await page.screenshot({path: `/tmp/code3d-207-${token}.png`});
    }
    assert.deepEqual(errors, []);
  },
);
