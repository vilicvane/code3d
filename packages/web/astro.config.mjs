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
  appHeaderRules,
  appIsolationHeaders,
} from '../app/build/response-headers.ts';

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
              ...(name === 'core'
                ? [
                    {
                      label: 'API reference',
                      items: [
                        {
                          slug: 'docs/packages/core/api',
                          label: 'Browse by task',
                        },
                        {
                          label: 'Solid primitives',
                          items: [
                            {slug: 'docs/packages/core/api/box'},
                            {slug: 'docs/packages/core/api/cylinder'},
                            {slug: 'docs/packages/core/api/sphere'},
                            {slug: 'docs/packages/core/api/ellipsoid'},
                            {slug: 'docs/packages/core/api/frustum'},
                            {slug: 'docs/packages/core/api/regular-prism'},
                            {slug: 'docs/packages/core/api/tube'},
                            {slug: 'docs/packages/core/api/coil'},
                          ],
                        },
                        {
                          label: 'Points, curves and profiles',
                          items: [
                            {slug: 'docs/packages/core/api/point'},
                            {slug: 'docs/packages/core/api/line'},
                            {slug: 'docs/packages/core/api/arc'},
                            {slug: 'docs/packages/core/api/bezier'},
                            {slug: 'docs/packages/core/api/spline'},
                            {slug: 'docs/packages/core/api/circle'},
                            {slug: 'docs/packages/core/api/ellipse'},
                            {slug: 'docs/packages/core/api/rectangle'},
                            {slug: 'docs/packages/core/api/regular-polygon'},
                          ],
                        },
                        {
                          label: 'Shape construction',
                          items: [
                            {slug: 'docs/packages/core/api/extrude'},
                            {slug: 'docs/packages/core/api/revolve'},
                            {slug: 'docs/packages/core/api/sweep'},
                            {slug: 'docs/packages/core/api/loft'},
                            {slug: 'docs/packages/core/api/wrap'},
                            {slug: 'docs/packages/core/api/thicken'},
                          ],
                        },
                        {
                          label: 'Booleans and solid modifications',
                          items: [
                            {slug: 'docs/packages/core/api/union'},
                            {slug: 'docs/packages/core/api/cut'},
                            {slug: 'docs/packages/core/api/intersect'},
                            {slug: 'docs/packages/core/api/fillet'},
                            {slug: 'docs/packages/core/api/chamfer'},
                            {slug: 'docs/packages/core/api/shell'},
                          ],
                        },
                        {
                          label: 'Origins and local transforms',
                          items: [
                            {slug: 'docs/packages/core/api/origin-point'},
                            {slug: 'docs/packages/core/api/origin-vertex'},
                            {slug: 'docs/packages/core/api/origin-offset'},
                            {slug: 'docs/packages/core/api/origin-center'},
                            {slug: 'docs/packages/core/api/model-rotate'},
                            {slug: 'docs/packages/core/api/scaled'},
                          ],
                        },
                        {
                          label: 'Groups and placement',
                          items: [
                            {slug: 'docs/packages/core/api/group'},
                            {slug: 'docs/packages/core/api/expose'},
                            {slug: 'docs/packages/core/api/relate'},
                            {slug: 'docs/packages/core/api/on'},
                            {slug: 'docs/packages/core/api/align'},
                            {slug: 'docs/packages/core/api/offset'},
                            {slug: 'docs/packages/core/api/rotate'},
                            {slug: 'docs/packages/core/api/pivot'},
                            {slug: 'docs/packages/core/api/pivot-vertex'},
                            {slug: 'docs/packages/core/api/pivot-point'},
                            {slug: 'docs/packages/core/api/axis-edge'},
                            {slug: 'docs/packages/core/api/axis-line'},
                            {slug: 'docs/packages/core/api/couple-rotation'},
                          ],
                        },
                        {
                          label: 'Topology and references',
                          items: [
                            {slug: 'docs/packages/core/api/vertex'},
                            {slug: 'docs/packages/core/api/edge'},
                            {slug: 'docs/packages/core/api/surface'},
                            {slug: 'docs/packages/core/api/reference-elements'},
                            {slug: 'docs/packages/core/api/directional-bounds'},
                            {slug: 'docs/packages/core/api/flip-reverse'},
                          ],
                        },
                        {
                          label: 'Geometry measurements',
                          items: [
                            {slug: 'docs/packages/core/api/distance'},
                            {slug: 'docs/packages/core/api/length'},
                            {slug: 'docs/packages/core/api/area'},
                            {slug: 'docs/packages/core/api/volume'},
                            {slug: 'docs/packages/core/api/bounds'},
                            {slug: 'docs/packages/core/api/position'},
                          ],
                        },
                      ],
                    },
                  ]
                : []),
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
            appHeaderRules(sitePath('app')) +
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
