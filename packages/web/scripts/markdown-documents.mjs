import {glob, readFile, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {toMarkdown} from 'mdast-util-to-markdown';
import {mdxjs} from 'micromark-extension-mdxjs';
import {mdxFromMarkdown} from 'mdast-util-mdx';
import GithubSlugger from 'github-slugger';
import {renderSamples} from '../../app/render-samples/catalog.ts';

export const repository = fileURLToPath(new URL('../../../', import.meta.url));
const contentRoot = 'packages/web/src/content/docs/docs/';
const origin = 'https://code3d.invalid';

export async function markdownDocuments(
  root = repository,
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  }).trim(),
) {
  const documents = [];
  for await (const source of glob(
    ['docs/**/*.md', 'packages/*/README.md', `${contentRoot}**/*.{md,mdx}`],
    {cwd: root},
  )) {
    let route;
    let html;
    if (source.startsWith(contentRoot)) {
      const name = source.slice(contentRoot.length).replace(/\.mdx?$/, '');
      route = `/docs/${name}.md`;
      html = `/docs/${name === 'index' ? '' : name + '/'}`;
    } else if (source.endsWith('/README.md')) {
      route = `/docs/packages/${source.split('/')[1]}.md`;
    } else {
      route = '/' + source;
    }
    documents.push({source, route, html, repository: root, sourceCommit});
  }
  return documents.sort((a, b) => a.route.localeCompare(b.route));
}

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

function relativeUrl(route, target) {
  const url = new URL(target, origin);
  let relative = path.posix.relative(path.posix.dirname(route), url.pathname);
  if (url.pathname.endsWith('/')) relative = relative ? relative + '/' : './';
  return (relative || path.posix.basename(route)) + url.search + url.hash;
}

async function publishLink(href, document, documents) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || href.startsWith('#'))
    return href;
  const url = new URL(href, new URL('/' + document.source, origin));
  const local = decodeURIComponent(url.pathname.slice(1));
  const target = documents.find(item => item.source === local);
  if (target)
    return relativeUrl(document.route, target.route + url.search + url.hash);

  // Website prose uses links relative to its HTML page, while repository docs
  // and READMEs link to real source files.
  const pageUrl = new URL(
    href,
    new URL(document.html || document.route, origin),
  );
  const page = documents.find(
    item => item.html === pageUrl.pathname || item.route === pageUrl.pathname,
  );
  if (page)
    return relativeUrl(
      document.route,
      page.route + pageUrl.search + pageUrl.hash,
    );
  if (href.startsWith('/') || document.html)
    return relativeUrl(document.route, pageUrl.href);

  const info = await stat(path.join(document.repository, local)).catch(() => {
    throw new Error(`${document.source}: missing source link ${href}`);
  });
  const encoded = local.split('/').map(encodeURIComponent).join('/');
  return info.isDirectory()
    ? `https://github.com/vilicvane/code3d/tree/${document.sourceCommit}/${encoded}${url.hash}`
    : `https://raw.githubusercontent.com/vilicvane/code3d/${document.sourceCommit}/${encoded}${url.hash}`;
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
      const title = metadata.match(/^title: (.+)$/m)?.[1];
      if (!title)
        throw new Error(`${document.source}: Markdown export needs a title`);
      return `# ${title}\n`;
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
  return markdown.trim() + '\n';
}
