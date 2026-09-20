import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';
import {appIsolationHeaders} from '../../build/response-headers.ts';

declare const window: Window & {
  animationTest: {
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    animation: import('../../src/model/animation.ts').ModelAnimation;
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
  };
};

test(
  'time executions reuse compiled code, change ordinary control flow and reject superseded frames',
  {timeout: 120_000},
  async t => {
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL('/__animation-test__', process.env.CODE3D_TEST_URL);
    await page.route(url.href, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main>Animation test</main>',
      }),
    );
    await page.goto(url.href);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const client = new ModelCompilerClient({
        readFile: async () => undefined,
        stat: async () => undefined,
      });
      const messages: string[] = [];
      const worker = client['compiler'];
      const send = worker.postMessage.bind(worker);
      worker.postMessage = ((message: {kind: string}) => {
        messages.push(message.kind);
        send(message);
      }) as typeof worker.postMessage;
      try {
        const source = `import {box, timeOffset} from '@code3d/core';
        const time = timeOffset(9);
        await Promise.resolve();
        if (time !== timeOffset()) throw new Error('Time changed within an execution');
        /** @code3d.inspect part.inspect */
        function part(width) { return box(width, 2, 3); }
        namespace part {
          export function inspect() { return {target: [box(100 + timeOffset(), 2, 3)]}; }
        }
        export default part(time < 1 ? 4 : 8);`;
        const initial = await client.compile(
          {files: [{path: '/model.ts', source}]},
          '/model.ts',
        );
        messages.length = 0;
        const frame = await client.execute(2);
        const inspection = await client.inspect(frame, {
          file: '/model.ts',
          offset: source.lastIndexOf('part('),
        });
        const inspected = inspection!.target[0];
        if (inspected.kind !== 'model')
          throw new Error('Missing inspected model');
        const xs = Array.from(inspected.model.mesh!.vertices).filter(
          (_, i) => i % 3 === 0,
        );
        const inspectedWidth = Math.max(...xs) - Math.min(...xs);
        const reset = await client.execute(0);
        const playbackMessages = [...messages];
        const pending = client.execute(3).then(
          () => 'accepted',
          () => 'cancelled',
        );
        const replacement = await client.compile(
          {
            files: [
              {
                path: '/model.ts',
                source:
                  "import {box} from '@code3d/core'; export default box(12, 2, 3);",
              },
            ],
          },
          '/model.ts',
        );
        const width = (module: typeof initial) => {
          if (module.diagnostic) throw new Error(module.diagnostic.summary);
          const vertices = module.fallback!.mesh!.vertices;
          const xs = Array.from(vertices).filter((_, i) => i % 3 === 0);
          return Math.max(...xs) - Math.min(...xs);
        };
        return {
          times: [
            initial.timeOffset,
            frame.timeOffset,
            reset.timeOffset,
            replacement.timeOffset,
          ],
          widths: [initial, frame, reset, replacement].map(width),
          playbackMessages,
          inspectedWidth,
          pending: await pending,
          exportable: client.canExport(replacement),
        };
      } finally {
        client.dispose();
      }
    });
    assert.deepEqual(result.times, [0, 2, 0, undefined]);
    assert.deepEqual(result.widths, [4, 8, 4, 12]);
    assert.deepEqual(
      result.playbackMessages,
      [],
      'frames do not compile or republish artifacts',
    );
    assert.equal(
      result.inspectedWidth,
      102,
      'inspect reads the time belonging to its model execution',
    );
    assert.equal(result.pending, 'cancelled');
    assert.equal(result.exportable, true);
  },
);

test(
  'App plays the assembly, pauses, resets, stops on edits and clears playback on file changes',
  {timeout: 120_000},
  async t => {
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1400, height: 900},
      reducedMotion: 'reduce',
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[MobX\]|reaction.*error/i.test(message.text()))
        errors.push(message.text());
    });
    const source = await readFile(
      new URL('../../examples/constraints/animation.ts', import.meta.url),
      'utf8',
    );
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify({
          files: [
            {path: '/model.ts', source},
            {
              path: '/other.ts',
              source:
                "import {box} from '@code3d/core'; export default box(10, 10, 10);",
            },
          ],
        })};`,
      }),
    );
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.animationTest = {animation, viewport, codeEditor, previewState, compiler};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL!);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    await page.evaluate(() => {
      const editor = window.animationTest.codeEditor.editor;
      const model = editor.getModel()!;
      editor.setPosition(
        model.getPositionAt(model.getValue().lastIndexOf('group(') + 5),
      );
    });
    await page.waitForFunction(() => !window.animationTest.previewState.busy);
    const pose = () =>
      page.evaluate(
        () =>
          window.animationTest.previewState.module!.fallback!.children![1]
            .transform,
      );
    const initial = await pose();
    await page
      .getByRole('button', {name: 'Play animation', exact: true})
      .click();
    const playback = await page.evaluate(async () => {
      const status = document.getElementById('viewport-status')!;
      const samples = new Set<string>();
      const updates: Record<string, number> = {};
      const audit = new MutationObserver(records => {
        for (const record of records) {
          const element =
            record.target instanceof Element
              ? record.target
              : record.target.parentElement!;
          if (element.closest('#animation-time')) continue;
          const key = `${element.tagName}#${element.id}.${element.getAttribute('class') ?? ''}:${record.type}:${record.attributeName ?? ''}`;
          updates[key] = (updates[key] ?? 0) + 1;
        }
      });
      for (const id of ['project-tree', 'editor-tabs', 'viewport-host'])
        audit.observe(document.getElementById(id)!, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      const capture = () =>
        samples.add(
          JSON.stringify({
            label: status.textContent!.trim(),
            state: status.dataset.state,
            hidden: status.hidden,
            busy: status.getAttribute('aria-busy'),
            title: status.getAttribute('title'),
          }),
        );
      const observer = new MutationObserver(capture);
      observer.observe(status, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      try {
        const times = new Set<number>();
        while (times.size < 4) {
          capture();
          times.add(window.animationTest.animation.time);
          await new Promise(requestAnimationFrame);
        }
        return {
          statuses: [...samples].map(sample => JSON.parse(sample)),
          updates,
        };
      } finally {
        observer.disconnect();
        audit.disconnect();
      }
    });
    assert.deepEqual(
      playback.updates,
      {},
      'unchanged UI stays intact while model geometry and the time readout advance',
    );
    assert.deepEqual(playback.statuses, [
      {
        label: 'Playing',
        state: 'busy',
        hidden: false,
        busy: 'true',
        title: null,
      },
    ]);
    await page.waitForFunction(
      () => window.animationTest.animation.time > 0.15,
    );
    // Press over the icon, allow a full frame to finish, then release. Neither
    // the click target nor its interactivity may disappear between events.
    await page.locator('#animation-play svg').hover();
    await page.mouse.down();
    const pressedTime = await page.evaluate(
      () => window.animationTest.animation.time,
    );
    await page.waitForFunction(
      time => window.animationTest.animation.time > time,
      pressedTime,
    );
    assert.equal(await page.locator('#animation-play').isEnabled(), true);
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.animationTest.animation.playing),
      false,
    );
    await page.waitForFunction(() => !window.animationTest.animation.pending);
    assert.equal(
      await page.locator('#viewport-status-label').textContent(),
      'Ready',
    );
    assert.notDeepEqual(await pose(), initial);
    const paused = await page.evaluate(
      () => window.animationTest.animation.time,
    );
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => window.animationTest.animation.time),
      paused,
    );
    assert.equal(
      await page.evaluate(() =>
        window.animationTest.codeEditor.editor.getValue(),
      ),
      source,
    );
    await page.getByRole('button', {name: 'Reset animation'}).click();
    await page.waitForFunction(
      () =>
        !window.animationTest.animation.pending &&
        window.animationTest.animation.time === 0,
    );
    assert.deepEqual(await pose(), initial);
    // A caret move while a frame's inspection is in flight must select the
    // latest source, without ever publishing the now-stale inspection scene.
    const movedDuringFrame = await page.evaluate(async () => {
      const {compiler, animation, codeEditor, viewport} = window.animationTest;
      const inspect = compiler.inspect.bind(compiler);
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>(resolve => {
        enter = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      let held = false;
      compiler.inspect = async (...args) => {
        if (!held) {
          held = true;
          enter();
          await gate;
        }
        return inspect(...args);
      };
      try {
        animation.play();
        await entered;
        const editor = codeEditor.editor;
        const offset = editor.getValue().indexOf('cylinder(') + 3;
        editor.setPosition(editor.getModel()!.getPositionAt(offset));
        release();
        while (animation.pending) await new Promise(requestAnimationFrame);
        const source = viewport.sourceContext?.target.sourceRef;
        return {
          stopped: !animation.playing,
          currentSource:
            !!source && source.start <= offset && offset <= source.end,
        };
      } finally {
        release();
        compiler.inspect = inspect;
      }
    });
    assert.deepEqual(movedDuringFrame, {stopped: true, currentSource: true});
    await page.evaluate(() => {
      const editor = window.animationTest.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().lastIndexOf('group(') + 5),
      );
    });
    await page.waitForFunction(() => !window.animationTest.previewState.busy);
    assert.equal(
      await page.locator('#viewport-status-label').textContent(),
      'Ready',
    );
    await page
      .getByRole('button', {name: 'Play animation', exact: true})
      .click();
    await page.waitForFunction(() => window.animationTest.animation.time > 0.1);
    await page.evaluate(() => {
      const editor = window.animationTest.codeEditor.editor;
      editor.setValue(editor.getValue().replace('time * 60', 'time * 30'));
    });
    await page.waitForFunction(
      () =>
        !window.animationTest.animation.playing &&
        !window.animationTest.previewState.busy &&
        !window.animationTest.animation.pending,
    );
    assert.equal(
      await page.evaluate(() => window.animationTest.previewState.diagnostic),
      undefined,
    );
    await page.evaluate(() =>
      window.animationTest.codeEditor.openFile('/other.ts'),
    );
    await page.waitForFunction(
      () =>
        !window.animationTest.previewState.busy &&
        window.animationTest.previewState.file === '/other.ts',
    );
    assert.equal(await page.locator('#viewport-animation').isVisible(), false);
    assert.equal(
      await page.evaluate(() => window.animationTest.animation.time),
      0,
    );
    await page.evaluate(() =>
      window.animationTest.codeEditor.openFile('/model.ts'),
    );
    await page.waitForFunction(
      () =>
        !window.animationTest.previewState.busy &&
        window.animationTest.previewState.file === '/model.ts',
    );
    assert.equal(await page.locator('#viewport-animation').isVisible(), true);
    // A later frame may fail; Reset must remain usable to recover the zero pose.
    await page.evaluate(() => {
      const editor = window.animationTest.codeEditor.editor;
      editor.setValue(
        editor
          .getValue()
          .replace(
            'const angle =',
            "if (time > 0.1) throw new Error('Motion limit');\nconst angle =",
          ),
      );
    });
    await page.waitForFunction(() => !window.animationTest.previewState.busy);
    await page
      .getByRole('button', {name: 'Play animation', exact: true})
      .click();
    await page.waitForFunction(
      () =>
        !window.animationTest.animation.playing &&
        window.animationTest.previewState.status === 'error',
    );
    assert.equal(
      await page.locator('#viewport-status-label').textContent(),
      'Model error',
    );
    assert.equal(
      await page.locator('#viewport-status').getAttribute('data-state'),
      'error',
    );
    assert.match(
      (await page.locator('#viewport-status').getAttribute('title')) ?? '',
      /Motion limit/,
    );
    await page.getByRole('button', {name: 'Reset animation'}).click();
    await page.waitForFunction(
      () =>
        !window.animationTest.animation.pending &&
        window.animationTest.previewState.status === 'ready' &&
        window.animationTest.animation.time === 0,
    );
    assert.equal(
      await page.locator('#viewport-status-label').textContent(),
      'Ready',
    );
    // Restore the actual example for its acceptance screenshot.
    await page.evaluate(
      source => window.animationTest.codeEditor.editor.setValue(source),
      source,
    );
    await page.waitForFunction(() => !window.animationTest.previewState.busy);
    if (process.env.CODE3D_ANIMATION_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_ANIMATION_SCREENSHOT});
    assert.deepEqual(errors, []);
  },
);
