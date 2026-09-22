import {glob, readFile, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {frontmatter, reviewedPackage} from './source-review.mjs';

export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const featuredPackages = [
  'core',
  'layout',
  'materials',
  'screws',
  'gears',
];
export const contentRoot = 'packages/web/src/content/docs/docs/';
export const websiteDocumentPatterns = [
  `${contentRoot}**/*.{md,mdx}`,
  ...featuredPackages.flatMap(name => [
    `packages/${name}/README.md`,
    `packages/${name}/docs/**/*.{md,mdx}`,
  ]),
];
const origin = 'https://code3d.invalid';

export function markdownCanonical(document, site) {
  if (!document.html) return;
  return new URL(document.html.slice(1), site.href.replace(/\/?$/, '/')).href;
}

export function markdownHeaderRules(documents, site) {
  const base = site.pathname.replace(/\/$/, '');
  // Package Markdown always maps from <path>.md to <path>/. One splat keeps
  // growing API inventories below Cloudflare's 100-rule limit without matching
  // Markdown-only agent documents or the special /docs/index.md route.
  const packagePrefix = '/docs/packages/';
  const packageDocuments = documents.filter(document =>
    document.route.startsWith(packagePrefix),
  );
  const groupPackages =
    packageDocuments.length > 0 &&
    packageDocuments.every(
      document =>
        document.route.endsWith('.md') &&
        document.html === document.route.slice(0, -3) + '/',
    );
  const rules = groupPackages
    ? [
        `${base}${packagePrefix}*.md\n  Link: <${new URL('docs/packages/:splat/', site.href.replace(/\/?$/, '/')).href}>; rel="canonical"\n`,
      ]
    : [];
  for (const document of documents) {
    if (
      !document.html ||
      (groupPackages && document.route.startsWith(packagePrefix))
    )
      continue;
    rules.push(
      `${base}${document.route}\n  Link: <${markdownCanonical(document, site)}>; rel="canonical"\n`,
    );
  }
  return rules.join('\n');
}

export function documentLocation(source) {
  if (source.startsWith(contentRoot)) {
    const name = source.slice(contentRoot.length).replace(/\.mdx?$/, '');
    return {
      route: `/docs/${name}.md`,
      html: `/docs/${name === 'index' ? '' : name + '/'}`,
    };
  }
  const match = source.match(
    /^packages\/([^/]+)\/(README\.md|docs\/(.+)\.mdx?)$/,
  );
  if (match && featuredPackages.includes(match[1])) {
    const name = `packages/${match[1]}${match[3] ? '/' + match[3] : ''}`;
    return {
      route: `/docs/${name}.md`,
      html: `/docs/${name}/`,
      packageDirectory: match[1],
      overview: match[2] === 'README.md',
    };
  }
  return {route: '/' + source};
}

export async function packageMetadata(directory, root = repository) {
  const {name, version} = JSON.parse(
    await readFile(
      path.join(root, 'packages', directory, 'package.json'),
      'utf8',
    ),
  );
  return {name, version};
}

export async function markdownDocuments(
  root = repository,
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  }).trim(),
) {
  const documents = [];
  const packages = new Map();
  for await (const source of glob(
    ['docs/**/*.md', ...websiteDocumentPatterns],
    {cwd: root},
  )) {
    const location = documentLocation(source);
    if (location.packageDirectory && !packages.has(location.packageDirectory))
      packages.set(
        location.packageDirectory,
        await packageMetadata(location.packageDirectory, root),
      );
    const {sourceReview} = frontmatter(
      await readFile(path.join(root, source), 'utf8'),
    ).data;
    documents.push({
      source,
      ...location,
      package: reviewedPackage(
        packages.get(location.packageDirectory),
        sourceReview,
      ),
      sourceReview,
      repository: root,
      sourceCommit,
    });
  }
  return documents.sort((a, b) => a.route.localeCompare(b.route));
}

function relativeUrl(route, target) {
  const url = new URL(target, origin);
  const directory = route.endsWith('/') ? route : path.posix.dirname(route);
  let relative = path.posix.relative(directory, url.pathname);
  if (url.pathname.endsWith('/')) relative = relative ? relative + '/' : './';
  return (relative || path.posix.basename(route)) + url.search + url.hash;
}

export async function publishLink(
  href,
  document,
  documents,
  format = 'markdown',
) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || href.startsWith('#'))
    return href;
  const route = format === 'html' ? document.html : document.route;
  const published = target =>
    format === 'html' ? target.html || target.route : target.route;
  const url = new URL(href, new URL('/' + document.source, origin));
  const local = decodeURIComponent(url.pathname.slice(1));
  const target = documents.find(item => item.source === local);
  if (target)
    return relativeUrl(route, published(target) + url.search + url.hash);

  const pageUrl = new URL(
    href,
    new URL(document.html || document.route, origin),
  );
  const page = documents.find(
    item => item.html === pageUrl.pathname || item.route === pageUrl.pathname,
  );
  if (page)
    return relativeUrl(route, published(page) + pageUrl.search + pageUrl.hash);
  if (href.startsWith('/') || document.source.startsWith(contentRoot))
    return relativeUrl(route, pageUrl.href);

  const info = await stat(path.join(document.repository, local)).catch(() => {
    throw new Error(`${document.source}: missing source link ${href}`);
  });
  const encoded = local.split('/').map(encodeURIComponent).join('/');
  return info.isDirectory() || format === 'html'
    ? `https://github.com/vilicvane/code3d/${info.isDirectory() ? 'tree' : 'blob'}/${document.sourceCommit}/${encoded}${url.hash}`
    : `https://raw.githubusercontent.com/vilicvane/code3d/${document.sourceCommit}/${encoded}${url.hash}`;
}
