import {glob, readFile, stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';
import {markdownHeaderRules} from './document-sources.mjs';
import {appHeaderRules} from '../../app/build/response-headers.ts';
import {
  featuredPackages,
  markdownDocuments,
  markdownHeadings,
  markdownReferences,
  renderMarkdown,
  repository,
} from './markdown-documents.mjs';

const directory = fileURLToPath(new URL('../dist/www/', import.meta.url));
const appDirectory = fileURLToPath(new URL('../../app/', import.meta.url));
const site = new URL(process.env.CODE3D_SITE_URL || 'https://code3d.invalid/');
const base = site.pathname.replace(/\/$/, '');
const pages = new Map();
const issues = [];
const documents = await markdownDocuments();
const headers = await readFile(path.join(directory, '_headers'), 'utf8');
assert.ok(
  headers.startsWith(appHeaderRules(`${base}/app`)),
  'Missing App response header rules',
);
assert.ok(
  headers.split('\n').filter(line => line && !/^\s|#/.test(line)).length <= 100,
  'Cloudflare supports at most 100 header rules',
);
if (process.env.CODE3D_SITE_URL) {
  assert.ok(
    headers.includes(markdownHeaderRules(documents, site)),
    'Missing Markdown canonical header rules',
  );
}
for (const document of documents) {
  const file = document.route.slice(1);
  const markdown = await readFile(path.join(directory, file), 'utf8');
  assert.equal(
    markdown,
    await renderMarkdown(document, documents),
    `${file}: stale Markdown output`,
  );
  assert.ok(markdown.startsWith('# '), `${file}: missing plain Markdown title`);
  if (document.package)
    assert.ok(
      markdown.includes(
        `${document.package.name} · v${document.package.version}`,
      ),
      `${file}: missing current package version`,
    );
  pages.set(document.route, {
    file,
    ids: markdownHeadings(markdown),
    references: markdownReferences(markdown),
  });
}
const entry = pages.get('/docs/agents.md');
const entryTargets = new Set(
  entry.references.map(
    href => new URL(href, site.origin + '/docs/agents.md').pathname,
  ),
);
for (const document of documents.filter(item =>
  item.source.startsWith('docs/agents/'),
)) {
  assert.ok(
    entryTargets.has(document.route),
    `Agent entry is missing topic ${document.source}`,
  );
}
for (const name of featuredPackages) {
  assert.ok(
    entryTargets.has(`/docs/packages/${name}.md`),
    `Agent entry is missing featured package ${name}`,
  );
  assert.ok(
    pages.has(`/docs/packages/${name}.md`),
    `Missing featured README ${name}`,
  );
}
for await (const file of glob('packages/*/package.json', {cwd: repository})) {
  await stat(path.join(repository, path.dirname(file), 'README.md'));
}
const agentGuide = await readFile(
  path.join(directory, 'docs/agents.md'),
  'utf8',
);
assert.ok(agentGuide.includes('project.c3d.json serve'));
assert.ok(
  agentGuide.includes(
    `echo '{"operation":"context"}' | npx --yes @code3d/cli@latest`,
  ),
);

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
    if (attributes.class?.split(/\s+/).includes('model-example')) {
      const order = [];
      walk(node, child => {
        if (['source-code', 'img', 'figcaption'].includes(child.tagName))
          order.push(child.tagName);
      });
      if (order.join(',') !== 'source-code,img,figcaption')
        issues.push(
          `${file}: model examples must show code, image, then caption`,
        );
    }
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
    if (
      node.tagName === 'img' &&
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(attributes.src || '')
    ) {
      issues.push(
        `${file}: image points to a GitHub file viewer: ${attributes.src}`,
      );
    }
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
  if (
    route === '/docs/comparisons/' ||
    route.startsWith('/docs/comparisons/')
  ) {
    const tags = [];
    const headings = [];
    const structured = [];
    let visibleText = '';
    walk(document, node => {
      const attrs = Object.fromEntries(
        (node.attrs || []).map(a => [a.name, a.value]),
      );
      if (node.nodeName === '#text') visibleText += node.value;
      if (node.tagName === 'meta' || node.tagName === 'link') tags.push(attrs);
      if (node.tagName === 'h1') headings.push(node);
      if (node.tagName === 'script' && attrs.type === 'application/ld+json')
        structured.push(
          JSON.parse(node.childNodes.map(child => child.value || '').join('')),
        );
    });
    assert.equal(headings.length, 1, `${file}: comparison must have one H1`);
    assert.equal(
      tags.filter(tag => tag.name === 'description' && tag.content).length,
      1,
      `${file}: missing or duplicate description`,
    );
    assert.ok(
      !tags.some(tag => tag.name === 'robots' && /noindex/.test(tag.content)),
      `${file}: comparison is not indexable`,
    );
    if (process.env.CODE3D_SITE_URL) {
      const canonical = site.origin + base + route;
      assert.deepEqual(
        tags.filter(tag => tag.rel === 'canonical').map(tag => tag.href),
        [canonical],
        `${file}: wrong canonical`,
      );
      assert.equal(
        structured.length,
        1,
        `${file}: missing or duplicate JSON-LD`,
      );
      const [content, breadcrumb] = structured[0]['@graph'];
      assert.equal(content.url, canonical);
      assert.equal(breadcrumb['@type'], 'BreadcrumbList');
      assert.equal(breadcrumb.itemListElement.at(-1).item, canonical);
      assert.ok(
        breadcrumb.itemListElement.every(
          item =>
            references.includes(new URL(item.item).pathname) ||
            item.item === canonical,
        ),
      );
      if (route === '/docs/comparisons/') {
        assert.equal(content['@type'], 'CollectionPage');
      } else {
        assert.equal(content['@type'], 'Article');
        assert.equal(content.author.name, 'Code3D');
        assert.ok(visibleText.includes('By Code3D'));
        const reviewed = new Date(content.dateModified).toLocaleDateString(
          'en-US',
          {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'},
        );
        assert.ok(
          visibleText.includes(`Reviewed ${reviewed}`),
          `${file}: metadata date differs from visible review date`,
        );
      }
    }
  }
  const packageDocument = documents.find(
    item => item.html === route && item.package,
  );
  if (packageDocument) {
    const headings = [];
    let version = '';
    let description = '';
    const navigation = [];
    function textContent(node) {
      let value = '';
      walk(node, child => {
        if (child.nodeName === '#text') value += child.value;
      });
      return value;
    }
    walk(document, node => {
      const attrs = Object.fromEntries(
        (node.attrs || []).map(a => [a.name, a.value]),
      );
      if (node.tagName === 'h1') headings.push(textContent(node));
      if (attrs.class?.split(/\s+/).includes('package-version'))
        version = textContent(node);
      if (node.tagName === 'meta' && attrs.name === 'description')
        description = attrs.content;
      if (node.tagName === 'nav' && attrs['aria-label'] === 'Main')
        walk(node, child => {
          const href = child.attrs?.find(a => a.name === 'href')?.value;
          if (href) navigation.push(href);
        });
    });
    assert.equal(
      headings.length,
      1,
      `${file}: package page must have one title`,
    );
    if (packageDocument.overview)
      assert.equal(headings[0], packageDocument.package.name);
    assert.ok(
      version.includes(`v${packageDocument.package.version}`),
      `${file}: stale HTML package version`,
    );
    assert.ok(description, `${file}: missing search description`);
    for (const related of documents.filter(
      item => item.packageDirectory === packageDocument.packageDirectory,
    ))
      assert.ok(
        navigation.includes(base + related.html),
        `${file}: package sidebar is missing ${related.html}`,
      );
  }
  pages.set(route, {ids, references, file});
}

if (process.env.CODE3D_SITE_URL) {
  const locations = xml =>
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const index = await readFile(
    path.join(directory, 'sitemap-index.xml'),
    'utf8',
  );
  const sitemaps = locations(index);
  assert.ok(sitemaps.length, 'Sitemap index must list at least one sitemap');
  const urls = [];
  for (const location of sitemaps) {
    const url = new URL(location);
    assert.equal(
      url.origin,
      site.origin,
      'Sitemap must use the configured origin',
    );
    assert.ok(
      url.pathname.startsWith(base + '/'),
      'Sitemap must stay within the site base',
    );
    const xml = await readFile(
      path.join(directory, url.pathname.slice(base.length)),
      'utf8',
    );
    urls.push(...locations(xml));
  }
  assert.deepEqual(
    urls.sort(),
    [...pages]
      .filter(([, page]) => page.file.endsWith('index.html'))
      .map(([route]) => site.origin + base + route)
      .sort(),
    'Sitemap must cover every public HTML page, without Markdown duplicates or the 404 page',
  );
  const robots = await readFile(path.join(directory, 'robots.txt'), 'utf8');
  assert.deepEqual(
    robots.split('\n').filter(line => line.startsWith('Sitemap:')),
    [`Sitemap: ${site.origin}${base}/sitemap-index.xml`],
    'robots.txt must advertise the configured sitemap index',
  );
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
  `Validated links, icons, anchors, and assets on ${pages.size} HTML/Markdown pages; search and App present.`,
);
