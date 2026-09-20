import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {build, preview} from 'vite';
import {ArtifactRegistry} from '../../../scripts/artifact-registry.mjs';
import {
  prepareExampleArtifacts,
  exampleArtifactsPlugin,
} from './example-artifacts.mjs';

const packageDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

/** One production render build and one package batch serve every requested image. */
export async function renderImages(requests) {
  const prepared = await prepareExampleArtifacts();
  const cache = path.join(packageDirectory, '.cache');
  await mkdir(cache, {recursive: true});
  const outDir = await mkdtemp(path.join(cache, 'render-artifacts-'));
  let server, browser;
  const cdpEndpoint = process.env.CODE3D_CHROME_CDP_ENDPOINT;
  try {
    await build({
      configFile: path.join(packageDirectory, 'vite.config.ts'),
      root: packageDirectory,
      logLevel: 'error',
      plugins: [exampleArtifactsPlugin(prepared.projects)],
      build: {
        outDir,
        rolldownOptions: {input: path.join(packageDirectory, 'render.html')},
      },
    });
    server = await preview({
      configFile: path.join(packageDirectory, 'vite.config.ts'),
      root: packageDirectory,
      build: {outDir},
      preview: {host: '127.0.0.1', port: 0},
    });
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) throw new Error('The render preview server did not start.');
    browser = cdpEndpoint
      ? await chromium.connectOverCDP(cdpEndpoint)
      : await chromium.launch({headless: true});
    const registry = new ArtifactRegistry(prepared.artifacts);
    for (const {
      model,
      output,
      width = 1200,
      height = 900,
      context: sourceContext,
    } of requests) {
      if (
        !Number.isInteger(width) ||
        width <= 0 ||
        !Number.isInteger(height) ||
        height <= 0
      )
        throw new Error(`Invalid image size: ${width} x ${height}`);
      await mkdir(path.dirname(output), {recursive: true});
      const context = await browser.newContext();
      try {
        await registry.route(context);
        const page = await context.newPage();
        await page.setViewportSize({width, height});
        const url = new URL('render.html', baseUrl);
        url.searchParams.set('model', model);
        if (sourceContext) url.searchParams.set('context', sourceContext);
        await page.goto(url.href, {waitUntil: 'networkidle'});
        await page
          .locator(
            'html[data-render-state="ready"], html[data-render-state="error"]',
          )
          .waitFor({
            state: 'attached',
            timeout: 120_000,
          });
        if (
          (await page.locator('html').getAttribute('data-render-state')) ===
          'error'
        )
          throw new Error(await page.locator('body').innerText());
        const image = await page.evaluate(() => window.code3dRenderedImage);
        await writeFile(
          output,
          Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'),
        );
        console.log(path.relative(process.cwd(), output));
      } finally {
        await context.close();
      }
    }
  } finally {
    if (!cdpEndpoint) await browser?.close();
    await server?.close();
    await rm(outDir, {recursive: true, force: true});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const model = option('model', 'desktop-stand');
  await renderImages([
    {
      model,
      output: path.resolve(
        packageDirectory,
        option('output', `rendered/${model}.png`),
      ),
      width: Number(option('width', '1200')),
      height: Number(option('height', '900')),
      context: option('context'),
    },
  ]);
  // Detach from the external CDP connection after all owned resources close.
  if (process.env.CODE3D_CHROME_CDP_ENDPOINT) process.exit(0);
}
