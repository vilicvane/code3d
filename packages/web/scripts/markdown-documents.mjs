import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {toMarkdown} from 'mdast-util-to-markdown';
import {mdxjs} from 'micromark-extension-mdxjs';
import {mdxFromMarkdown} from 'mdast-util-mdx';
import GithubSlugger from 'github-slugger';
import {load as parseYaml} from 'js-yaml';
import {renderSamples} from '../../app/render-samples/catalog.ts';

import {publishLink} from './document-sources.mjs';
export {
  repository,
  featuredPackages,
  markdownDocuments,
} from './document-sources.mjs';

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

export function markdownReferences(markdown) {
  const references = [];
  walk(fromMarkdown(markdown), node => {
    if (['link', 'image', 'definition'].includes(node.type))
      references.push(node.url);
  });
  return references;
}

export function markdownHeadings(markdown) {
  const slugger = new GithubSlugger();
  const ids = new Set();
  walk(fromMarkdown(markdown), node => {
    if (node.type !== 'heading') return;
    let text = '';
    walk(node, child => {
      if (child.type === 'text' || child.type === 'inlineCode')
        text += child.value;
    });
    ids.add(slugger.slug(text));
  });
  return ids;
}

function expressionValue(node) {
  const expression = node.data.estree.body[0].expression;
  if (expression.type === 'Literal') return String(expression.value);
  if (
    expression.type === 'CallExpression' &&
    expression.callee.type === 'Identifier'
  ) {
    const name = expression.callee.name;
    const value = expression.arguments[0]?.value;
    if (name === 'sitePath' && typeof value === 'string') return '/' + value;
    if (name === 'appUrl' && (value === undefined || typeof value === 'string'))
      return '/app/' + (value ? '#/file/examples/' + value : '');
  }
  throw new Error(
    `Unsupported Markdown documentation expression: ${node.value}`,
  );
}

async function expandMdx(markdown, root) {
  const tree = fromMarkdown(markdown, {
    extensions: [mdxjs()],
    mdastExtensions: [mdxFromMarkdown()],
  });
  async function render(node) {
    if (node.type === 'mdxjsEsm') return '';
    if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression')
      return expressionValue(node);
    const children = async () => {
      let text = markdown.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      for (const child of [...(node.children || [])].reverse()) {
        const start = child.position.start.offset - node.position.start.offset;
        const end = child.position.end.offset - node.position.start.offset;
        text = text.slice(0, start) + (await render(child)) + text.slice(end);
      }
      return text;
    };
    if (!['mdxJsxFlowElement', 'mdxJsxTextElement'].includes(node.type))
      return children();
    const attributes = Object.fromEntries(
      node.attributes.map(attribute => [
        attribute.name,
        typeof attribute.value === 'object' && attribute.value
          ? attribute.name === 'source'
            ? undefined
            : expressionValue(attribute.value)
          : attribute.value,
      ]),
    );
    const content = async () =>
      (await Promise.all(node.children.map(render))).join('');
    switch (node.name) {
      case 'ArrowIcon':
        return '';
      case 'CardGrid':
      case 'p':
        return '\n\n' + (await content()) + '\n\n';
      case 'a':
        return `[${(await content()).trim()}](${attributes.href})`;
      case 'LinkCard':
        return `\n\n[${attributes.title}](${attributes.href}) — ${attributes.description}\n\n`;
      case 'ModelExample':
      case 'SourceCode': {
        const sample =
          node.name === 'ModelExample'
            ? renderSamples.find(sample => sample.id === attributes.id)
            : {file: attributes.file, description: ''};
        if (!sample)
          throw new Error(`Unknown Markdown example: ${attributes.id}`);
        const source = await readFile(
          path.join(root, 'packages/app/examples', sample.file),
          'utf8',
        );
        return `\n\n${sample.description}\n\n\`\`\`ts\n${source.trimEnd()}\n\`\`\`\n\n[Open ${sample.file} in Code3D](/app/#/file/examples/${sample.file})\n\n`;
      }
      default:
        throw new Error(
          `Provide a Markdown representation for <${node.name}>.`,
        );
    }
  }
  return render(tree);
}

export async function renderMarkdown(document, documents) {
  let markdown = await readFile(
    path.join(document.repository, document.source),
    'utf8',
  );
  markdown = markdown.replace(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n/,
    (_, metadata) => {
      const {title} = parseYaml(metadata);
      if (typeof title !== 'string' || !title.trim())
        throw new Error(`${document.source}: Markdown export needs a title`);
      return `# ${title.trim()}\n`;
    },
  );
  if (document.source.endsWith('.mdx'))
    markdown = await expandMdx(markdown, document.repository);
  const links = [];
  function collect(node) {
    if (['link', 'image', 'definition'].includes(node.type)) links.push(node);
    else for (const child of node.children || []) collect(child);
  }
  collect(fromMarkdown(markdown));
  async function rewrite(node) {
    const updated = {...node};
    if (node.url)
      updated.url = await publishLink(node.url, document, documents);
    if (node.children)
      updated.children = await Promise.all(node.children.map(rewrite));
    return updated;
  }
  for (const node of links.reverse()) {
    const replacement = toMarkdown(await rewrite(node)).trimEnd();
    markdown =
      markdown.slice(0, node.position.start.offset) +
      replacement +
      markdown.slice(node.position.end.offset);
  }
  if (document.package)
    markdown = markdown.replace(
      /^(# .+\n)/,
      `$1\n${document.package.name} · v${document.package.version}\n`,
    );
  return markdown.trim() + '\n';
}
