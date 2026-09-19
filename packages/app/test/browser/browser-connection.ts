import process from 'node:process';
import {
  chromium as playwrightChromium,
  type ConnectOptions,
  type ConnectOverCDPOptions,
  type LaunchOptions,
} from 'playwright-core';

export type {
  Browser,
  BrowserContext,
  ElementHandle,
  Locator,
  Page,
} from 'playwright-core';

/** Test files own their contexts; the runner owns a shared browser process. */
export const chromium = {
  connectOverCDP: (endpoint: string, options?: ConnectOverCDPOptions) =>
    process.env.CODE3D_PLAYWRIGHT_WS
      ? playwrightChromium.connect(process.env.CODE3D_PLAYWRIGHT_WS)
      : playwrightChromium.connectOverCDP(endpoint, options),
  connect: (endpoint: string, options?: ConnectOptions) =>
    playwrightChromium.connect(endpoint, options),
  launch: (options?: LaunchOptions) => playwrightChromium.launch(options),
};
