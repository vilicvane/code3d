import type {APIRoute} from 'astro';

export const GET: APIRoute = ({site}) =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      ...(site
        ? [
            `Sitemap: ${new URL(import.meta.env.BASE_URL.replace(/\/$/, '') + '/sitemap-index.xml', site)}`,
          ]
        : []),
      '',
    ].join('\n'),
  );
