import {mkdir} from 'node:fs/promises';
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

const model = option('model', 'fasteners');
const output = path.resolve(
  packageDirectory,
  option('output', `rendered/${model}.png`),
);
const width = Number(option('width', '1200'));
const height = Number(option('height', '900'));
const line = option('line');
const column = option('column');

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
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = await context.newPage();
await page.setViewportSize({width, height});

try {
  const url = new URL('render.html', baseUrl);
  url.searchParams.set('model', model);
  if (line) url.searchParams.set('line', line);
  if (column) url.searchParams.set('column', column);
  await page.goto(url.href, {waitUntil: 'networkidle'});
  await page.locator('html[data-render-state="ready"]').waitFor({
    state: 'attached',
    timeout: 60_000,
  });
  await page.locator('#render-root').screenshot({path: output});
  console.log(path.relative(process.cwd(), output));
} finally {
  await page.close();
  if (ownsBrowser) await browser.close();
  await server.close();
}

// A CDP connection to an externally owned browser keeps its WebSocket alive.
// The image and preview server are already fully closed at this point.
if (!ownsBrowser) process.exit(0);
