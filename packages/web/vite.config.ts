import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import {codeToHtml} from 'shiki';
import {defineConfig, type Plugin} from 'vite';
import {App} from './src/www/app.tsx';
import {
  packageSource,
  type HighlightedCodeSamples,
} from './src/www/code-samples.ts';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const wwwDirectory = path.join(packageDirectory, 'src/www');
const rootMarker = '<div id="root"></div>';
const assemblySourcePath = path.join(
  packageDirectory,
  '../app/examples/fasteners.ts',
);

function normalizedSiteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const url = new URL(value);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  url.search = '';
  url.hash = '';
  return url.href;
}

function staticSite(siteUrl: string | undefined): Plugin {
  const samples = highlightedCodeSamples();

  return {
    name: 'code3d-static-site',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        if (!html.includes(rootMarker)) {
          throw new Error('The Code3D website root marker is missing.');
        }

        const highlightedSamples = await samples;
        const serializedSamples = JSON.stringify(highlightedSamples).replaceAll(
          '<',
          '\\u003c',
        );

        const metadata = siteUrl
          ? [
              `<link rel="canonical" href="${siteUrl}">`,
              `<meta property="og:url" content="${siteUrl}">`,
              `<meta property="og:image" content="${new URL('og-image.png', siteUrl).href}">`,
              `<meta name="twitter:image" content="${new URL('og-image.png', siteUrl).href}">`,
            ].join('\n    ')
          : '';

        return html
          .replace('<!-- code3d:site-metadata -->', metadata)
          .replace(
            rootMarker,
            `<div id="root">${renderToString(
              createElement(App, {samples: highlightedSamples}),
            )}</div>`,
          )
          .replace(
            '</body>',
            `<script id="code3d-code-samples" type="application/json">${serializedSamples}</script>\n  </body>`,
          );
      },
    },
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /'];

      if (siteUrl) {
        robots.push('', `Sitemap: ${new URL('sitemap.xml', siteUrl).href}`);
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            `  <url><loc>${siteUrl}</loc></url>`,
            '</urlset>',
            '',
          ].join('\n'),
        });
      }

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `${robots.join('\n')}\n`,
      });
    },
  };
}

async function highlightedCodeSamples(): Promise<HighlightedCodeSamples> {
  const assemblySource = await readFile(assemblySourcePath, 'utf8');
  const [assemblyHtml, packageHtml] = await Promise.all([
    codeToHtml(assemblySource, {lang: 'typescript', theme: 'vesper'}),
    codeToHtml(packageSource, {lang: 'typescript', theme: 'vesper'}),
  ]);
  return {
    assembly: {source: assemblySource, html: assemblyHtml},
    package: {source: packageSource, html: packageHtml},
  };
}

export default defineConfig(() => {
  const siteUrl = normalizedSiteUrl(process.env.CODE3D_SITE_URL);

  return {
    root: wwwDirectory,
    publicDir: path.join(wwwDirectory, 'public'),
    base: siteUrl ? new URL(siteUrl).pathname : '/',
    plugins: [react(), staticSite(siteUrl)],
    build: {
      outDir: path.join(packageDirectory, 'dist/www'),
      emptyOutDir: true,
    },
  };
});
