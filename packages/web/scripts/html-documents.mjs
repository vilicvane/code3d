import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  documentLocation,
  markdownDocuments,
  publishLink,
  repository,
} from './document-sources.mjs';

// Native Sätteri visitors serve both Markdown and MDX. Only the output format
// differs from the plain Markdown endpoint; link ownership stays in one catalog.
export function htmlDocuments({fileURL}) {
  if (!fileURL) return;
  const source = path.relative(repository, fileURLToPath(fileURL));
  if (!documentLocation(source).html) return;
  let documents;
  let document;
  async function rewrite(node, context) {
    context.setProperty(
      node,
      'url',
      await publishLink(node.url, document, documents, 'html'),
    );
  }
  return {
    name: 'code3d-document-links',
    async before() {
      documents = await markdownDocuments();
      document = documents.find(item => item.source === source);
    },
    heading(node, context) {
      if (document.overview && node.depth === 1) context.removeNode(node);
    },
    link: rewrite,
    image: rewrite,
    definition: rewrite,
  };
}
