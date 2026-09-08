import type {APIRoute} from 'astro';
import guide from '../../../content/docs/docs/guides/agents.md?raw';
import {sitePath} from '../../../lib/site';

// The webpage and agent-readable response share one source. Resolve links from
// the canonical webpage location, since a .md resource sits one level higher.
const page = new URL(sitePath('docs/guides/agents/'), 'https://code3d.invalid');
const markdown = guide
  .replace(/^---\n[\s\S]*?\n---\n/, '# Work with an agent\n')
  .replace(/\]\((\.\.?\/[^)]+)\)/g, (_, href: string) => {
    const target = new URL(href, page);
    return `](${target.pathname}${target.search}${target.hash})`;
  });

export const GET: APIRoute = () =>
  new Response(markdown, {
    headers: {'Content-Type': 'text/markdown; charset=utf-8'},
  });
