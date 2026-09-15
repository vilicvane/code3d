import type {APIRoute, GetStaticPaths} from 'astro';
import {root} from 'astro:config/server';
import {fileURLToPath} from 'node:url';
import {markdownCanonical} from '../../../scripts/document-sources.mjs';
import {
  markdownDocuments,
  renderMarkdown,
} from '../../../scripts/markdown-documents.mjs';

const repository = fileURLToPath(new URL('../../', root));

export const getStaticPaths: GetStaticPaths = async () =>
  (await markdownDocuments(repository)).map(document => ({
    params: {document: document.route.slice('/docs/'.length, -'.md'.length)},
    props: {source: document.source},
  }));

export const GET: APIRoute = async ({props, site}) => {
  const documents = await markdownDocuments(repository);
  const document = documents.find(
    document => document.source === props.source,
  )!;
  const canonical =
    site &&
    markdownCanonical(document, new URL(import.meta.env.BASE_URL, site));
  return new Response(await renderMarkdown(document, documents), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      ...(canonical ? {Link: `<${canonical}>; rel="canonical"`} : {}),
    },
  });
};
