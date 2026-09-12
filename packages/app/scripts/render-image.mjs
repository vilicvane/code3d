import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {preview} from 'vite';

const packageDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

const model = option('model', 'desktop-stand');
const output = path.resolve(
  packageDirectory,
  option('output', `rendered/${model}.png`),
);
const width = Number(option('width', '1200'));
const height = Number(option('height', '900'));
const sourceContext = option('context');

if (!Number.isInteger(width) || width <= 0) {
  throw new Error(`Invalid image width: ${width}`);
}
if (!Number.isInteger(height) || height <= 0) {
  throw new Error(`Invalid image height: ${height}`);
}

await mkdir(path.dirname(output), {recursive: true});

const server = await preview({
  configFile: path.join(packageDirectory, 'vite.config.ts'),
  root: packageDirectory,
  preview: {host: '127.0.0.1', port: 0},
});
const baseUrl = server.resolvedUrls?.local[0];
if (!baseUrl) throw new Error('The render preview server did not start.');

const cdpEndpoint = process.env.CODE3D_CHROME_CDP_ENDPOINT;
const browser = cdpEndpoint
  ? await chromium.connectOverCDP(cdpEndpoint)
  : await chromium.launch({headless: true});
const ownsBrowser = !cdpEndpoint;
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({width, height});

try {
  const url = new URL('render.html', baseUrl);
  url.searchParams.set('model', model);
  if (sourceContext) url.searchParams.set('context', sourceContext);
  await page.goto(url.href, {waitUntil: 'networkidle'});
  await page
    .locator('html[data-render-state="ready"], html[data-render-state="error"]')
    .waitFor({
      state: 'attached',
      timeout: 120_000,
    });
  if (
    (await page.locator('html').getAttribute('data-render-state')) === 'error'
  ) {
    throw new Error(await page.locator('body').innerText());
  }
  const image = await page.evaluate(() => window.code3dRenderedImage);
  if (!image) throw new Error('The render page did not produce an image.');
  const encoded = image.slice(image.indexOf(',') + 1);
  await writeFile(output, Buffer.from(encoded, 'base64'));
  console.log(path.relative(process.cwd(), output));
} finally {
  await context.close();
  if (ownsBrowser) await browser.close();
  await server.close();
}

// A CDP connection to an externally owned browser keeps its WebSocket alive.
// The image and preview server are already fully closed at this point.
if (!ownsBrowser) process.exit(0);
