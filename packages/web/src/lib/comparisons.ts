import type {CollectionEntry} from 'astro:content';

export function comparisonMetadata(
  entry: Pick<CollectionEntry<'docs'>, 'id' | 'data'>,
  site: URL | undefined,
  base: string,
) {
  const overview = entry.id === 'docs/comparisons';
  if (!overview && !entry.id.startsWith('docs/comparisons/')) return;

  const path = (value: string) => `${base.replace(/\/$/, '')}/${value}`;
  const breadcrumbs = [
    {name: 'Home', path: path('')},
    {name: 'Comparisons', path: path('docs/comparisons/')},
    ...(!overview
      ? [
          {
            name: entry.data.sidebar.label || entry.data.title,
            path: path(`${entry.id}/`),
          },
        ]
      : []),
  ];
  if (!site) return {breadcrumbs};

  const url = new URL(path(`${entry.id}/`), site).href;
  const organization = {
    '@type': 'Organization',
    name: 'Code3D',
    url: new URL(path(''), site).href,
  };
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': overview ? 'CollectionPage' : 'Article',
        '@id': `${url}#${overview ? 'collection' : 'article'}`,
        url,
        ...(overview ? {name: entry.data.title} : {headline: entry.data.title}),
        description: entry.data.description,
        inLanguage: 'en',
        publisher: organization,
        ...(!overview
          ? {
              author: organization,
              mainEntityOfPage: {'@type': 'WebPage', '@id': url},
              ...(entry.data.lastUpdated instanceof Date
                ? {dateModified: entry.data.lastUpdated.toISOString()}
                : {}),
            }
          : {}),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumbs`,
        itemListElement: breadcrumbs.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: new URL(item.path, site).href,
        })),
      },
    ],
  };
  return {
    breadcrumbs,
    // JSON-LD is inserted into a raw-text script element, not an HTML attribute.
    jsonLd: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
  };
}
