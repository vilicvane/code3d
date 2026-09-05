import {glob, readFile, stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';

const directory = fileURLToPath(new URL('../dist/www/', import.meta.url));
const site = new URL(process.env.CODE3D_SITE_URL || 'https://code3d.invalid/');
const base = site.pathname.replace(/\/$/, '');
const pages = new Map();
const issues = [];

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}
for await (const file of glob('**/*.html', {cwd: directory})) {
  if (file.startsWith('app/')) continue;
  const document = parse(await readFile(path.join(directory, file), 'utf8'));
  const ids = new Set();
  const references = [];
  walk(document, node => {
    const attributes = Object.fromEntries(
      (node.attrs || []).map(a => [a.name, a.value]),
    );
    if (attributes.id) ids.add(attributes.id);
    if (
      node.tagName === 'a' &&
      attributes.href?.includes('#/file/examples/') &&
      (attributes.target !== '_blank' ||
        !attributes.rel?.split(/\s+/).includes('noopener'))
    ) {
      issues.push(
        `${file}: example must open safely in a new tab: ${attributes.href}`,
      );
    }
    if (attributes.href && node.tagName !== 'link')
      references.push(attributes.href);
    if (
      attributes.href &&
      node.tagName === 'link' &&
      attributes.rel
        ?.split(/\s+/)
        .some(rel => ['stylesheet', 'icon', 'sitemap'].includes(rel))
    )
      references.push(attributes.href);
    if (attributes.src) references.push(attributes.src);
    if (node.tagName === 'meta' && attributes.property === 'og:image')
      references.push(attributes.content);
    if (attributes.srcset)
      references.push(
        ...attributes.srcset
          .split(',')
          .map(item => item.trim().split(/\s+/)[0]),
      );
  });
  const route = '/' + file.replace(/index\.html$/, '');
  pages.set(route, {ids, references, file});
}

for (const [route, page] of pages) {
  for (const reference of page.references) {
    if (/^(data:|mailto:|tel:|javascript:)/.test(reference)) continue;
    const url = new URL(reference, new URL(base + route, site.origin));
    if (url.origin !== site.origin) continue;
    if (base && url.pathname !== base && !url.pathname.startsWith(base + '/')) {
      issues.push(`${page.file}: link escapes site base: ${reference}`);
      continue;
    }
    const relative = decodeURIComponent(url.pathname.slice(base.length)) || '/';
    const targetPath = path.join(directory, relative);
    let target;
    try {
      const info = await stat(targetPath);
      target = info.isDirectory()
        ? path.join(targetPath, 'index.html')
        : targetPath;
      await stat(target);
    } catch {
      issues.push(`${page.file}: missing target ${reference}`);
      continue;
    }
    if (url.hash && !relative.startsWith('/app/')) {
      const targetRoute =
        '/' + path.relative(directory, target).replace(/index\.html$/, '');
      const targetPage = pages.get(targetRoute);
      if (
        targetPage &&
        !targetPage.ids.has(decodeURIComponent(url.hash.slice(1)))
      ) {
        issues.push(`${page.file}: missing anchor ${reference}`);
      }
    }
  }
}
await stat(path.join(directory, 'pagefind/pagefind.js'));
await stat(path.join(directory, 'app/index.html'));
const license = await readFile(
  new URL('../../../LICENSE', import.meta.url),
  'utf8',
);
for (const file of ['license.txt', 'app/LICENSE']) {
  assert.equal(
    await readFile(path.join(directory, file), 'utf8'),
    license,
    `${file} must match the root LICENSE`,
  );
}
if (issues.length) throw new Error(issues.join('\n'));
console.log(
  `Validated links, anchors, and assets on ${pages.size} pages; search and App present.`,
);
