import {glob, readFile, stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';

const directory = fileURLToPath(new URL('../dist/www/', import.meta.url));
const appDirectory = fileURLToPath(new URL('../../app/', import.meta.url));
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
  const fontPreloads = [];
  const fontFaces = [];
  walk(document, node => {
    const attributes = Object.fromEntries(
      (node.attrs || []).map(a => [a.name, a.value]),
    );
    if (node.nodeName === '#text' && /[\u2196-\u2199]/u.test(node.value)) {
      issues.push(`${file}: diagonal arrows must use SVG, not Unicode glyphs`);
    }
    if (
      node.tagName === 'svg' &&
      attributes.class?.split(/\s+/).includes('c3-arrow') &&
      (attributes['aria-hidden'] !== 'true' ||
        attributes.focusable !== 'false' ||
        attributes.stroke !== 'currentColor')
    ) {
      issues.push(
        `${file}: arrow icons must be decorative and inherit the text color`,
      );
    }
    if (node.tagName === 'a' && attributes.target === '_blank') {
      let hasIcon = attributes.class?.split(/\s+/).includes('c3-link-arrow');
      walk(node, child => {
        if (child.tagName === 'svg') hasIcon = true;
      });
      if (!hasIcon) {
        issues.push(
          `${file}: new-tab link is missing its icon: ${attributes.href}`,
        );
      }
    }
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
        .some(rel => ['stylesheet', 'icon', 'sitemap', 'preload'].includes(rel))
    )
      references.push(attributes.href);
    if (
      node.tagName === 'link' &&
      attributes.rel === 'preload' &&
      attributes.as === 'font'
    ) {
      fontPreloads.push(attributes.href);
      if (attributes.type !== 'font/woff2' || !('crossorigin' in attributes)) {
        issues.push(`${file}: font preload must use WOFF2 and anonymous CORS`);
      }
    }
    if (node.tagName === 'style' && node.parentNode?.tagName === 'head') {
      const css = node.childNodes.map(child => child.value || '').join('');
      for (const [face] of css.matchAll(/@font-face\s*\{[^}]+\}/g)) {
        fontFaces.push(face);
        for (const [, url] of face.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          references.push(url);
        }
      }
    }
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
  if (
    fontPreloads.length !== 2 ||
    !fontFaces.length ||
    fontPreloads.some(url => !fontFaces.some(face => face.includes(url))) ||
    fontFaces.some(face => !/font-display:\s*optional\b/.test(face))
  ) {
    issues.push(
      `${file}: fonts must be declared in the head, preloaded, and optional`,
    );
  }
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
    if (relative === '/app/' && url.hash.startsWith('#/file/examples/')) {
      const examplePath = decodeURIComponent(url.hash.slice('#/file/'.length));
      try {
        await stat(path.join(appDirectory, examplePath));
      } catch {
        issues.push(`${page.file}: missing App example ${examplePath}`);
      }
    } else if (url.hash && !relative.startsWith('/app/')) {
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
for (const asset of ['mark.svg', 'favicon.svg']) {
  const source = await readFile(
    new URL(`../../../assets/brand/${asset}`, import.meta.url),
    'utf8',
  );
  for (const file of [asset, `app/${asset}`]) {
    assert.equal(
      await readFile(path.join(directory, file), 'utf8'),
      source,
      `${file} must match the shared brand asset`,
    );
  }
}
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
  `Validated links, icons, anchors, and assets on ${pages.size} pages; search and App present.`,
);
