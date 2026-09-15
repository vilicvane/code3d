import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import {cp, access, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import sirv from 'sirv';
import {satteri} from '@astrojs/markdown-satteri';
import {htmlDocuments} from './scripts/html-documents.mjs';
import {
  featuredPackages,
  markdownDocuments,
  markdownHeaderRules,
} from './scripts/document-sources.mjs';
import {
  appIsolationHeaders,
  appIsolationRules,
} from '../app/build/isolation.ts';

const configuredUrl = process.env.CODE3D_SITE_URL
  ? new URL(process.env.CODE3D_SITE_URL)
  : undefined;
const base = configuredUrl?.pathname.replace(/\/$/, '') || '/';
const sitePath = path => `${base === '/' ? '' : base}/${path}`;
const appDirectory = fileURLToPath(new URL('../app/dist/', import.meta.url));

export default defineConfig({
  site: configuredUrl?.origin,
  base,
  publicDir: '../../assets/brand',
  outDir: './dist/www',
  trailingSlash: 'always',
  devToolbar: {enabled: false},
  markdown: {processor: satteri({mdastPlugins: [htmlDocuments]})},
  integrations: [
    starlight({
      disable404Route: true,
      markdown: {processedDirs: featuredPackages.map(name => `../${name}`)},
      title: 'Code3D',
      description: 'Solid modeling with TypeScript and direct manipulation.',
      favicon: '/favicon.svg',
      head: [
        {
          tag: 'meta',
          attrs: {name: 'twitter:card', content: 'summary_large_image'},
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/vilicvane/code3d',
        },
      ],
      customCss: ['./src/styles/docs.css'],
      components: {
        Header: './src/components/DocsHeader.astro',
        Head: './src/components/DocsHead.astro',
        PageTitle: './src/components/DocsPageTitle.astro',
      },
      editLink: {
        baseUrl: 'https://github.com/vilicvane/code3d/edit/main/packages/web/',
      },
      sidebar: [
        {
          label: 'Website',
          items: [
            {label: 'Home', link: '/'},
            {label: 'Examples', link: '/examples/'},
            {
              label: 'Open App',
              link: '/app/',
              attrs: {
                target: '_blank',
                rel: 'noopener',
                class: 'c3-link-arrow',
              },
            },
          ],
        },
        {
          label: 'Start here',
          items: [
            {slug: 'docs'},
            {slug: 'docs/getting-started/first-model'},
            {slug: 'docs/getting-started/app'},
            {slug: 'docs/getting-started/files'},
            {slug: 'docs/getting-started/limitations'},
          ],
        },
        {
          label: 'Packages',
          items: featuredPackages.map(name => ({
            label: `@code3d/${name}`,
            collapsed: true,
            items: [
              {slug: `docs/packages/${name}`, label: 'Overview'},
              {autogenerate: {directory: `../${name}/docs`}},
            ],
          })),
        },
        {
          label: 'Guides',
          items: [
            {slug: 'docs/guides/practical-models'},
            {slug: 'docs/guides/agents'},
            {slug: 'docs/guides/reusable-models'},
            {slug: 'docs/guides/model-tools'},
            {slug: 'docs/guides/exporting'},
          ],
        },
        {
          label: 'Concepts',
          items: [{slug: 'docs/concepts/code-and-geometry'}],
        },
        {
          label: 'Comparisons',
          collapsed: true,
          items: [
            {slug: 'docs/comparisons', label: 'Overview'},
            {autogenerate: {directory: 'docs/comparisons'}},
          ],
        },
      ],
    }),
    ...(configuredUrl ? [sitemap()] : []),
    {
      name: 'code3d-app',
      hooks: {
        'astro:config:setup': ({command, updateConfig}) => {
          // Astro preview excludes user Vite plugins, so configure its native
          // response headers. Production rules remain limited to the App path.
          if (command === 'preview')
            updateConfig({server: {headers: appIsolationHeaders}});
        },
        'astro:build:done': async ({dir}) => {
          await access(new URL('../app/dist/index.html', import.meta.url));
          await cp(appDirectory, new URL('app/', dir), {recursive: true});
          await writeFile(
            new URL('_headers', dir),
            appIsolationRules(`${sitePath('app')}/*`) +
              (configuredUrl
                ? '\n' +
                  markdownHeaderRules(await markdownDocuments(), configuredUrl)
                : ''),
          );
        },
      },
    },
  ],
  vite: {
    server: {strictPort: true},
    preview: {strictPort: true},
    plugins: [
      {
        name: 'code3d-app-preview',
        configureServer(server) {
          server.middlewares.use(
            sitePath('app'),
            sirv(appDirectory, {
              dev: true,
              setHeaders(response) {
                for (const [name, value] of Object.entries(appIsolationHeaders))
                  response.setHeader(name, value);
              },
            }),
          );
        },
      },
    ],
  },
});
