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

test('Markdown canonical headers preserve every HTML mapping and omit Markdown-only agent docs', () => {
  const documents = [
    {route: '/docs/index.md', html: '/docs/'},
    {route: '/docs/comparisons/fusion.md', html: '/docs/comparisons/fusion/'},
    {route: '/docs/packages/core.md', html: '/docs/packages/core/'},
    {route: '/docs/agents.md'},
  ];
  for (const base of ['', '/code3d']) {
    const site = new URL(`https://example.test${base}/`);
    const rules = markdownHeaderRules(documents, site);
    for (const doc of documents.slice(0, -1)) {
      const canonical = `https://example.test${base}${doc.html}`;
      assert.equal(markdownCanonical(doc, site), canonical);
      assert.ok(
        rules.includes(
          `${base}${doc.route}\n  Link: <${canonical}>; rel="canonical"\n`,
        ),
      );
    }
    assert.equal(markdownCanonical(documents[3], site), undefined);
    assert.equal(rules.includes('agents.md'), false);
  }
});
