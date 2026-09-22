import assert from 'node:assert/strict';
import {test} from 'node:test';
import {comparisonMetadata} from '../src/lib/comparisons.ts';
import {markdownCanonical, markdownHeaderRules} from './document-sources.mjs';

test('comparison metadata keeps visible breadcrumbs and structured URLs aligned under a site base', () => {
  const entry = {
    id: 'docs/comparisons/fusion',
    data: {
      title: 'Code3D vs Autodesk Fusion',
      description: 'Compare editable models with CAD automation.',
      sidebar: {label: 'Autodesk Fusion'},
      lastUpdated: new Date('2026-09-15'),
    },
  } as Parameters<typeof comparisonMetadata>[0];
  const metadata = comparisonMetadata(
    entry,
    new URL('https://example.test/'),
    '/code3d/',
  )!;
  const [article, breadcrumbs] = JSON.parse(metadata.jsonLd!)['@graph'];
  assert.equal(
    article.mainEntityOfPage['@id'],
    'https://example.test/code3d/docs/comparisons/fusion/',
  );
  assert.equal(article.dateModified, '2026-09-15T00:00:00.000Z');
  assert.equal(article.author.url, 'https://example.test/code3d/');
  assert.equal('datePublished' in article, false);
  assert.deepEqual(
    breadcrumbs.itemListElement.map((item: {item: string}) => item.item),
    metadata.breadcrumbs.map(
      item => new URL(item.path, 'https://example.test/').href,
    ),
  );
  assert.equal(
    comparisonMetadata(entry, undefined, '/code3d/')!.jsonLd,
    undefined,
  );
  assert.equal(
    comparisonMetadata(
      {...entry, id: 'docs/guides/agents'},
      new URL('https://example.test/'),
      '/',
    ),
    undefined,
  );
});

test('overview is a collection and raw-text JSON-LD cannot terminate its script', () => {
  const entry = {
    id: 'docs/comparisons',
    data: {
      title: 'Compare </script><script>alert(1)</script>',
      description: 'Overview',
      sidebar: {},
    },
  } as Parameters<typeof comparisonMetadata>[0];
  const metadata = comparisonMetadata(
    entry,
    new URL('https://example.test/'),
    '/',
  )!;
  assert.equal(metadata.jsonLd!.includes('</script>'), false);
  const [overview, breadcrumb] = JSON.parse(metadata.jsonLd!)['@graph'];
  assert.equal(overview['@type'], 'CollectionPage');
  assert.equal(overview.name, entry.data.title);
  assert.equal('author' in overview, false);
  assert.equal(breadcrumb.itemListElement.length, 2);
});

test('Markdown canonical headers cover a growing API inventory once, preserving base paths and Markdown-only docs', () => {
  const documents = [
    {route: '/docs/index.md', html: '/docs/'},
    {route: '/docs/comparisons/fusion.md', html: '/docs/comparisons/fusion/'},
    {route: '/docs/packages/core.md', html: '/docs/packages/core/'},
    {route: '/docs/agents.md'},
    {route: '/docs/agents/modeling.md'},
    ...Array.from({length: 150}, (_, index) => ({
      route: `/docs/packages/core/api/topic-${index}.md`,
      html: `/docs/packages/core/api/topic-${index}/`,
    })),
  ];
  for (const base of ['', '/code3d']) {
    const site = new URL(`https://example.test${base}/`);
    const rules = markdownHeaderRules(documents, site).trim().split('\n\n');
    assert.equal(rules.length, 3);
    for (const doc of documents) {
      const applied = rules.flatMap(rule => {
        const [pattern, header] = rule.split('\n');
        const [prefix, suffix] = pattern.split('*');
        const route = base + doc.route;
        if (suffix === undefined)
          return route === pattern ? [header.trim()] : [];
        if (!route.startsWith(prefix) || !route.endsWith(suffix)) return [];
        const splat = route.slice(prefix.length, route.length - suffix.length);
        return [header.trim().replace(':splat', splat)];
      });
      const canonical = doc.html
        ? `https://example.test${base}${doc.html}`
        : undefined;
      assert.equal(markdownCanonical(doc, site), canonical);
      assert.deepEqual(
        applied,
        canonical ? [`Link: <${canonical}>; rel="canonical"`] : [],
      );
    }
  }
});

test('nonstandard package mapping retains explicit canonical rules', () => {
  const documents = [
    {route: '/docs/packages/core/old.md', html: '/docs/packages/core/new/'},
  ];
  assert.equal(
    markdownHeaderRules(documents, new URL('https://example.test/')),
    '/docs/packages/core/old.md\n  Link: <https://example.test/docs/packages/core/new/>; rel="canonical"\n',
  );
});
