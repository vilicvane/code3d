import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import {
  codeToHtml,
  type ShikiTransformer,
  type ThemeRegistrationRaw,
} from 'shiki';
import {defineConfig, type Plugin} from 'vite';
import {
  code3dCodeColors,
  code3dCodeFocusColors,
} from '../app/src/code-theme.ts';
import {
  fastenerRenderSample,
  sourceTokenOffset,
} from '../app/render-samples/fastener.config.ts';
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
  '../app/render-samples/fastener.ts',
);
const code3dShikiTheme = {
  name: 'code3d-dark',
  type: 'dark',
  fg: code3dCodeColors.foreground,
  bg: code3dCodeColors.background,
  colors: {
    'editor.background': code3dCodeColors.background,
    'editor.foreground': code3dCodeColors.foreground,
  },
  settings: [
    {
      settings: {
        background: code3dCodeColors.background,
        foreground: code3dCodeColors.foreground,
      },
    },
    {
      scope: 'comment',
      settings: {foreground: code3dCodeColors.comment},
    },
    {
      scope: [
        'keyword',
        'storage',
        'constant.language',
        'support.type.primitive',
      ],
      settings: {foreground: code3dCodeColors.keyword},
    },
    {
      scope: 'string',
      settings: {foreground: code3dCodeColors.string},
    },
    {
      scope: 'constant.numeric',
      settings: {foreground: code3dCodeColors.number},
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.name.interface',
        'support.type',
      ],
      settings: {foreground: code3dCodeColors.type},
    },
  ],
} satisfies ThemeRegistrationRaw;

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
  const focus = fastenerRenderSample.focus;
  const focusOffset = sourceTokenOffset(assemblySource, focus.target);
  const [assemblyHtml, packageHtml] = await Promise.all([
    codeToHtml(assemblySource, {
      lang: 'typescript',
      theme: code3dShikiTheme,
      decorations: [
        ...focus.related.map(target => ({
          start: sourceTokenOffset(assemblySource, target),
          end: sourceTokenOffset(assemblySource, target) + target.token.length,
          properties: {class: 'source-symbol-related'},
          alwaysWrap: true,
        })),
        ...focus.brackets.map(target => ({
          start: sourceTokenOffset(assemblySource, target),
          end: sourceTokenOffset(assemblySource, target) + target.token.length,
          properties: {class: 'source-bracket-match'},
          alwaysWrap: true,
        })),
        {
          start: focusOffset,
          end: focusOffset + focus.target.token.length,
          properties: {class: 'source-cursor source-symbol-current'},
          alwaysWrap: true,
        },
      ],
      transformers: [sourceFocusTransformer(assemblySource, focusOffset)],
    }),
    codeToHtml(packageSource, {
      lang: 'typescript',
      theme: code3dShikiTheme,
    }),
  ]);
  return {
    assembly: {source: assemblySource, html: assemblyHtml},
    package: {source: packageSource, html: packageHtml},
  };
}

function sourceFocusTransformer(
  source: string,
  focusOffset: number,
): ShikiTransformer {
  const focusedLine = source.slice(0, focusOffset).split('\n').length;
  const focusStyles = [
    `--source-cursor:${code3dCodeFocusColors.cursor}`,
    `--source-current-line:${code3dCodeFocusColors.currentLine}`,
    `--source-related-symbol:${code3dCodeFocusColors.relatedSymbol}`,
    `--source-current-symbol:${code3dCodeFocusColors.currentSymbol}`,
    `--source-bracket-match:${code3dCodeFocusColors.bracketMatch}`,
  ].join(';');

  return {
    name: 'code3d-source-focus',
    pre(hast) {
      const style =
        typeof hast.properties.style === 'string' ? hast.properties.style : '';
      hast.properties.style = `${style};${focusStyles}`;
    },
    line(hast, line) {
      if (line === focusedLine) {
        this.addClassToHast(hast, 'source-current-line');
      }
    },
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
