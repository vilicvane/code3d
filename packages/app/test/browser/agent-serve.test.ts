import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {runCli, startServe} from '../../../cli/test/process.ts';
import {type AgentConfig} from '@code3d/agent';
import {createLocalBridge} from '../../../cli/bld/bridge.js';
import {reserveLocalPort} from './local-port.ts';
import {appIsolationHeaders} from '../../build/isolation.ts';

test(
  'HTTPS App prompt starts a real CLI service, permits local access, renders models and persists editable agent ports',
  {timeout: 180_000},
  async t => {
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000},
    });
    t.after(() => context.close());
    await context.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: async () => {},
      });
    });
    const origin = 'https://www.code3d.org';
    const prefix = '/__agent-serve__/';
    const directory = fileURLToPath(new URL('../../dist/', import.meta.url));
    // Serve this commit's production build under a real secure origin in an isolated
    // context. No public deployment or browser security bypass is involved.
    await context.route(`${origin}${prefix}**`, async route => {
      const path =
        new URL(route.request().url()).pathname.slice(prefix.length) ||
        'index.html';
      assert.ok(!path.includes('..'));
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.wasm': 'application/wasm',
        '.svg': 'image/svg+xml',
      };
      await route.fulfill({
        headers: appIsolationHeaders,
        body: await readFile(join(directory, path)),
        contentType: types[extname(path)] ?? 'application/octet-stream',
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const cdp = await context.newCDPSession(page);
    const {targetInfo} = await cdp.send('Target.getTargetInfo');
    const browserCdp = await browser.newBrowserCDPSession();
    const permission = async (setting: 'denied' | 'granted') => {
      for (const name of [
        'local-network-access',
        'local-network',
        'loopback-network',
      ])
        await browserCdp.send('Browser.setPermission', {
          permission: {name},
          setting,
          origin,
          browserContextId: targetInfo.browserContextId,
        });
    };
    await permission('denied');
    await page.goto(origin + prefix);
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);
    await page.locator('#agents-button').click();
    const dialog = page.getByRole('dialog', {
      name: 'Connect Agent',
      exact: true,
    });
    const prompt = dialog.getByLabel('Agent prompt', {exact: true});
    const row = (name: string) =>
      dialog.locator('.agent-row').filter({
        has: page.locator('.agent-badge-name', {
          hasText: new RegExp(`^${name}$`),
        }),
      });
    const add = async (name: string): Promise<AgentConfig> => {
      await dialog.getByLabel('Agent name', {exact: true}).fill(name);
      await dialog
        .getByRole('button', {name: 'Add agent & copy prompt', exact: true})
        .click();
      await row(name).getByLabel('Agent prompt').waitFor();
      return JSON.parse(
        (await prompt.inputValue()).match(/```json\n([\s\S]*?)\n```/)![1],
      );
    };
    const suggested = Number(
      await dialog.getByLabel('Local port', {exact: true}).inputValue(),
    );
    assert.ok(suggested >= 49152 && suggested <= 65535);
    const firstPort = await reserveLocalPort(t);
    await dialog
      .getByLabel('Local port', {exact: true})
      .fill(String(firstPort.port));
    let alice = await add('Alice');
    await firstPort.release();
    assert.equal(alice.version, 2);
    assert.equal(alice.origin, origin);
    assert.equal(alice.port, firstPort.port);
    const temp = await mkdtemp(join(tmpdir(), 'code3d-app-serve-'));
    t.after(() => rm(temp, {recursive: true, force: true}));
    const configFile = join(temp, 'project.c3d.json');
    const launch = async () => {
      await writeFile(configFile, JSON.stringify(alice), {mode: 0o600});
      return startServe(t, configFile);
    };
    const call = async (args: string[], input?: unknown) => {
      const result = await runCli(
        [configFile, '--output-dir', temp, ...args],
        input === undefined ? '' : JSON.stringify(input),
      );
      const value = JSON.parse(result.stdout);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return value;
    };
    let service = await launch();
    const connected = async (config: AgentConfig) =>
      (
        (await fetch(`http://127.0.0.1:${config.port}/health`).then(response =>
          response.json(),
        )) as {connected: boolean}
      ).connected;
    await page.waitForTimeout(1200);
    assert.equal(await connected(alice), false);
    assert.equal(
      await row('Alice').locator('.agent-row-status').textContent(),
      'Never connected',
    );
    await permission('granted');
    await dialog.locator('.agent-status[data-state="online"]').waitFor();
    assert.equal(
      await row('Alice').locator('.agent-row-status').textContent(),
      'Never connected',
    );
    const current = await call(['context']);
    const file = current.data.file as string;
    const read = await call(['fs', 'read', file]);
    const source =
      "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n";
    const request = {
      requestId: 'browser-model-edit',
      files: [{path: file, version: read.data.version, content: source}],
      cursor: {file, regex: '(box\\(10, 6, 8\\))'},
      render: {view: 'front'},
      topology: true,
      type: true,
    };
    const {requestId, ...input} = request;
    const data = await call(
      ['--request-id', requestId, 'apply', '--input', '-'],
      input,
    );
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.data.accepted, true);
    assert.equal(data.data.saved, true);
    const observation = data.data.observation as {
      topology: unknown;
      type: unknown;
    };
    assert.ok(observation.topology);
    assert.ok(observation.type);
    const image = data.artifacts.find(
      (artifact: {mimeType: string}) => artifact.mimeType === 'image/png',
    );
    assert.ok(image);
    const png = await readFile(image.path);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.ok(png.length > 1000);
    // The production bundle must also export the SVG sketch scene under HTTPS.
    const sketch = await call(['apply', '--input', '-'], {
      files: [
        {
          path: '/agent-sketch.ts',
          version: null,
          content:
            "import {sketch} from '@code3d/core'; const profile = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 3]]], {constraints: [['radius', 2, 8]]}); export default profile;",
        },
      ],
      cursor: {file: '/agent-sketch.ts', regex: 'const (profile) ='},
      topology: true,
      render: true,
    });
    assert.equal(sketch.data.observation.topology.kind, 'sketch');
    assert.equal(sketch.data.observation.render.projection, 'orthographic');
    assert.equal(sketch.data.observation.topology.items[1].radius, 8);
    const sketchPng = await readFile(sketch.artifacts[0].path);
    assert.equal(sketchPng.readUInt32BE(16), 960);
    assert.equal(sketchPng.readUInt32BE(20), 720);
    assert.ok(sketchPng.length > 1000);
    await page.reload();
    await page.locator('#agents-button').click();
    await dialog.locator('.agent-status[data-state="online"]').waitFor();
    assert.equal((await call(['result', request.requestId])).ok, true);
    const old = alice;
    const nextPort = await reserveLocalPort(t);
    const newPort = nextPort.port;
    await row('Alice')
      .getByLabel('Alice port', {exact: true})
      .fill(String(newPort));
    await row('Alice').getByLabel('Alice port', {exact: true}).press('Tab');
    await page.waitForFunction(
      port =>
        document
          .querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Agent prompt"]',
          )
          ?.value.includes(`"port": ${port}`),
      newPort,
    );
    alice = JSON.parse(
      (await prompt.inputValue()).match(/```json\n([\s\S]*?)\n```/)![1],
    );
    assert.equal(alice.key, old.key);
    assert.equal(alice.agentId, old.agentId);
    await page.waitForTimeout(600);
    assert.equal(await connected(old), false);
    await service.stop();
    await nextPort.release();
    service = await launch();
    await dialog.locator('.agent-status[data-state="online"]').waitFor();
    assert.equal((await call(['result', request.requestId])).ok, true);
    const bobPort = await reserveLocalPort(t);
    await dialog
      .getByLabel('Local port', {exact: true})
      .fill(String(bobPort.port));
    const bob = await add('Bob');
    await bobPort.release();
    assert.notEqual(bob.port, alice.port);
    const bobBridge = await createLocalBridge(bob);
    t.after(() => bobBridge.close());
    await dialog.locator('.agent-status[data-state="online"]').waitFor();
    let attempts = 0;
    bobBridge.server.on('upgrade', () => {
      attempts++;
    });
    await row('Bob').getByRole('button', {name: 'Revoke', exact: true}).click();
    await row('Bob').waitFor({state: 'detached'});
    await page.waitForTimeout(1200);
    assert.equal(bobBridge.connected, false);
    assert.equal(attempts, 0);
    assert.equal(await connected(alice), true);
    await page.screenshot({path: '/tmp/code3d-local-serve-panel.png'});
    await dialog.getByLabel('Local agent connections', {exact: true}).click();
    await dialog.getByRole('button', {name: 'Revoke all', exact: true}).click();
    await dialog.locator('.agent-row').waitFor({state: 'detached'});
    await page.waitForTimeout(1200);
    assert.equal(await connected(alice), false);
    await page.reload();
    await page.locator('#agents-button').click();
    assert.equal(await dialog.locator('.agent-row').count(), 0);
    assert.equal(await connected(alice), false);
  },
);
