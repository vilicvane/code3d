import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import {cp, access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import sirv from 'sirv';

const configuredUrl = process.env.CODE3D_SITE_URL
  ? new URL(process.env.CODE3D_SITE_URL)
  : undefined;
const base = configuredUrl?.pathname.replace(/\/$/, '') || '/';
const sitePath = path => `${base === '/' ? '' : base}/${path}`;
const appDirectory = fileURLToPath(new URL('../app/dist/', import.meta.url));

export default defineConfig({
  site: configuredUrl?.origin,
  base,
  outDir: './dist/www',
  trailingSlash: 'always',
  devToolbar: {enabled: false},
  integrations: [
    starlight({
      disable404Route: true,
      title: 'Code3D',
      description: 'Solid modeling with TypeScript and direct manipulation.',
      logo: {src: './src/assets/logo.svg', replacesTitle: false},
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
              label: 'Open App ↗',
              link: '/app/',
              attrs: {target: '_blank', rel: 'noopener'},
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
          ],
        },
        {
          label: 'Guides',
          items: [
            {slug: 'docs/guides/relations'},
            {slug: 'docs/guides/topology'},
            {slug: 'docs/guides/reusable-models'},
          ],
        },
        {label: 'Concepts', items: [{slug: 'docs/concepts/code-and-geometry'}]},
        {
          label: 'Reference',
          items: [
            {slug: 'docs/reference/core'},
            {slug: 'docs/reference/screws'},
            {slug: 'docs/reference/limitations'},
          ],
        },
      ],
    }),
    ...(configuredUrl ? [sitemap()] : []),
    {
      name: 'code3d-app',
      hooks: {
        'astro:build:done': async ({dir}) => {
          await access(new URL('../app/dist/index.html', import.meta.url));
          await cp(appDirectory, new URL('app/', dir), {recursive: true});
        },
      },
    },
  ],
  vite: {
    server: {strictPort: true},
    plugins: [
      {
        name: 'code3d-app-preview',
        configureServer(server) {
          server.middlewares.use(
            sitePath('app'),
            sirv(appDirectory, {dev: true}),
          );
        },
      },
    ],
  },
});
