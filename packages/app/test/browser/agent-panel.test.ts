import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, type ElementHandle, type Locator} from 'playwright-core';
import {AgentClient, type AgentConfig} from '@code3d/agent';
import {createLocalBridge} from '../../../cli/bld/bridge.js';
import {reserveLocalPort} from './local-port.ts';

declare const window: Window & {settleAgentCopy(): void};

test(
  'agent controls preserve identity, prompt interaction and connection history',
  {timeout: 60_000},
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
    await context.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => {},
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.CODE3D_TEST_URL);
    const nav = page.locator('.agent-nav');
    const connect = page.locator('#agents-button');
    await nav.waitFor();
    assert.equal(await connect.textContent(), 'Connect Agent');
    assert.equal(
      await nav.evaluate(
        element => element === element.parentElement!.lastElementChild,
      ),
      true,
    );
    await connect.click();
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
    assert.equal(await prompt.count(), 0);
    assert.ok(
      (await dialog.getByLabel('Agent name', {exact: true}).inputValue())
        .length,
    );
    await page.evaluate(() =>
      window.addEventListener('keydown', () => {
        document.documentElement.dataset.globalKeydown = 'true';
      }),
    );
    const nameInput = dialog.getByLabel('Agent name', {exact: true});
    await nameInput.fill('Euler');
    await nameInput.press('End');
    await nameInput.pressSequentially('x');
    await nameInput.press('Control+z');
    assert.equal(await nameInput.inputValue(), 'Euler');
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.globalKeydown),
      undefined,
    );
    const configs: AgentConfig[] = [];
    for (const name of ['Euler', 'Gauss']) {
      const lease = await reserveLocalPort(t);
      await dialog
        .getByLabel('Local port', {exact: true})
        .fill(String(lease.port));
      await dialog.getByLabel('Agent name', {exact: true}).fill(name);
      await dialog
        .getByRole('button', {name: 'Add agent & copy prompt', exact: true})
        .click();
      await row(name).getByLabel('Agent prompt', {exact: true}).waitFor();
      const text = await prompt.inputValue();
      configs.push(
        JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)![1]) as AgentConfig,
      );
      await lease.release();
      const bridge = await createLocalBridge(configs.at(-1)!);
      t.after(() => bridge.close());
      assert.equal(await dialog.locator('.agent-prompt').count(), 1);
      assert.notEqual(
        await dialog.getByLabel('Agent name', {exact: true}).inputValue(),
        name,
      );
    }
    await dialog.locator('.agent-status[data-state="online"]').waitFor();
    assert.deepEqual(
      await dialog.locator('.agent-row-status').allTextContents(),
      ['Never connected', 'Never connected'],
    );
    assert.equal(
      await nav.locator('.agent-badge[data-active="true"]').count(),
      0,
    );
    const colors = await nav
      .locator('.agent-badge')
      .evaluateAll(elements =>
        elements.map(element =>
          getComputedStyle(element).getPropertyValue('--agent-color'),
        ),
      );
    assert.ok(colors.every(Boolean));
    assert.deepEqual(
      await dialog
        .locator('.agent-badge')
        .evaluateAll(elements =>
          elements.map(element =>
            getComputedStyle(element).getPropertyValue('--agent-color'),
          ),
        ),
      colors,
    );
    await row('Euler')
      .getByRole('button', {name: 'Copy initial prompt', exact: true})
      .click();
    await row('Euler').getByLabel('Agent prompt', {exact: true}).waitFor();
    assert.equal(await row('Gauss').locator('.agent-prompt').count(), 0);
    await prompt.focus();
    const element =
      (await prompt.elementHandle())! as ElementHandle<HTMLTextAreaElement>;
    const selection = await element.evaluate(element => {
      element.setSelectionRange(50, 120);
      element.scrollTop = 100;
      return {
        start: element.selectionStart,
        end: element.selectionEnd,
        scroll: element.scrollTop,
      };
    });
    const client = await AgentClient.create(configs[0]);
    await client.request({operation: 'context'});
    assert.deepEqual(
      await element.evaluate(element => ({
        start: element.selectionStart,
        end: element.selectionEnd,
        scroll: element.scrollTop,
      })),
      selection,
    );
    assert.equal(
      await element.evaluate(
        element => element.isConnected && document.activeElement === element,
      ),
      true,
    );
    assert.equal(
      await nav.locator('.agent-badge[data-active="true"]').count(),
      1,
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('.agent-status')?.getAttribute('data-state') ===
        'online',
    );
    assert.equal(
      await nav.locator('.agent-badge[data-active="true"]').count(),
      0,
    );
    assert.deepEqual(
      await nav
        .locator('.agent-badge')
        .evaluateAll(elements =>
          elements.map(element =>
            getComputedStyle(element).getPropertyValue('--agent-color'),
          ),
        ),
      colors,
    );
    await connect.click();
    assert.equal(await prompt.count(), 0);
    assert.equal(
      await row('Euler').locator('.agent-row-status').isVisible(),
      false,
    );
    assert.equal(await dialog.locator('.agent-row-location').count(), 0);
    assert.equal(
      await row('Gauss').locator('.agent-row-status').textContent(),
      'Never connected',
    );
    await row('Euler')
      .getByRole('button', {name: 'Copy update', exact: true})
      .click();
    assert.ok((await prompt.inputValue()).includes(configs[0].key));
    await page.clock.install();
    const copied = row('Euler').getByText('Prompt copied.', {exact: true});
    const copy = row('Euler').getByRole('button', {
      name: 'Copy displayed prompt',
      exact: true,
    });
    await copy.click();
    await copied.waitFor();
    await page.clock.runFor(2000);
    await copy.click();
    await page.clock.runFor(2000);
    assert.equal(await copied.isVisible(), true);
    await page.clock.runFor(1100);
    assert.equal(await copied.count(), 0);
    await page.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => {
          throw new Error('Clipboard unavailable');
        },
      }),
    );
    await row('Gauss')
      .getByRole('button', {name: 'Copy update', exact: true})
      .click();
    await row('Gauss')
      .getByText('Select and copy the prompt above.', {exact: true})
      .waitFor();
    assert.equal(
      await prompt.evaluate(
        (element: HTMLTextAreaElement) =>
          document.activeElement === element &&
          element.selectionStart === 0 &&
          element.selectionEnd === element.value.length,
      ),
      true,
    );
    for (const rejected of [false, true]) {
      await page.evaluate(
        rejected =>
          Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: () =>
              new Promise<void>((resolve, reject) => {
                window.settleAgentCopy = () =>
                  rejected
                    ? reject(new Error('Clipboard unavailable'))
                    : resolve();
              }),
          }),
        rejected,
      );
      await row('Gauss')
        .getByRole('button', {name: 'Copy displayed prompt', exact: true})
        .click();
      await dialog.getByRole('button', {name: 'Close', exact: true}).click();
      await page.evaluate(() => window.settleAgentCopy());
      await connect.click();
      assert.equal(
        await dialog.locator('.agent-prompt-message').textContent(),
        '',
      );
      assert.equal(
        await prompt.evaluate(element => document.activeElement === element),
        false,
      );
    }
    await checkFooter(dialog);
    const connection = dialog.getByLabel('Local agent connections', {
      exact: true,
    });
    const end = dialog.getByRole('button', {name: 'Revoke all', exact: true});
    await connection.focus();
    await page.keyboard.press('Enter');
    await end.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await end.isVisible(), false);
    assert.equal(await dialog.isVisible(), true);
    await connection.click();
    await dialog.getByLabel('Agent name', {exact: true}).click();
    assert.equal(await end.isVisible(), false);
    await page.setViewportSize({width: 480, height: 600});
    assert.equal(
      await dialog.evaluate(
        element =>
          element.scrollWidth <= element.clientWidth &&
          element.scrollHeight > element.clientHeight,
      ),
      true,
    );
    await connection.click();
    assert.equal(
      await dialog.evaluate(
        element => element.scrollWidth <= element.clientWidth,
      ),
      true,
    );
    await page.keyboard.press('Escape');
    await row('Gauss')
      .getByRole('button', {name: 'Revoke', exact: true})
      .click();
    await row('Gauss').waitFor({state: 'detached'});
    assert.equal(await prompt.count(), 0);
    await assert.rejects(
      () =>
        AgentClient.create(configs[1]).then(client =>
          client.request({operation: 'context'}),
        ),
      {code: 'app_disconnected'},
    );
    await dialog.getByRole('button', {name: 'Close', exact: true}).click();
    await page.setViewportSize({width: 1440, height: 1000});
    for (const kind of ['image', 'model']) {
      await page.locator('.viewport-canvas').click({button: 'right'});
      await page
        .getByRole('menuitem', {name: `Export ${kind}…`, exact: true})
        .click();
      const exporting = page.getByRole('dialog', {
        name: `Export ${kind}`,
        exact: true,
      });
      await checkFooter(exporting);
      assert.equal(await exporting.locator('input:focus').count(), 1);
      if (kind === 'model') {
        await exporting.getByLabel('Format', {exact: true}).selectOption('stl');
        await exporting.getByLabel('STL encoding', {exact: true}).waitFor();
        await exporting
          .getByRole('button', {name: 'Export STL', exact: true})
          .waitFor();
      }
      await exporting
        .getByRole('button', {name: 'Cancel', exact: true})
        .click();
      assert.equal(await exporting.isVisible(), false);
    }
    await connect.click();
    await connection.click();
    await end.click();
    await dialog.locator('.agent-row').waitFor({state: 'detached'});
    assert.equal(await connect.textContent(), 'Connect Agent');
    await page.reload();
    await nav.waitFor();
    assert.equal(await connect.textContent(), 'Connect Agent');
    await assert.rejects(() => client.request({operation: 'context'}), {
      code: 'app_disconnected',
    });
    assert.deepEqual(errors, []);
  },
);

async function checkFooter(dialog: Locator): Promise<void> {
  const layout = await dialog.locator('footer').evaluate(element => {
    const [secondary, primary] = element.querySelectorAll('button');
    const bounds = element.getBoundingClientRect();
    const left = secondary.getBoundingClientRect();
    const right = primary.getBoundingClientRect();
    return {
      left: left.left - bounds.left,
      right: bounds.right - right.right,
      gap: right.left - left.right,
      offset: left.top - right.top,
    };
  });
  assert.equal(layout.left, 0);
  assert.equal(layout.right, 0);
  assert.equal(layout.offset, 0);
  assert.ok(layout.gap > 8);
}
