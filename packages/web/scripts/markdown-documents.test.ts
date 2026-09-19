import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {satteri} from '@astrojs/markdown-satteri';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {
  markdownDocuments,
  renderMarkdown,
  markdownReferences,
  markdownHeadings,
  repository,
} from './markdown-documents.mjs';
import {featuredPackages, publishLink} from './document-sources.mjs';
import {htmlDocuments} from './html-documents.mjs';

test('featured package overviews share the same reading order in source and published Markdown', async () => {
  const documents = await markdownDocuments();
  const headings = [
    'Installation',
    'Example',
    'Usage notes',
    'Documentation',
    'Source and development',
  ];
  for (const document of documents.filter(item => item.overview)) {
    const source = await readFile(
      path.join(repository, document.source),
      'utf8',
    );
    assert.ok(source.startsWith(`# ${document.package!.name}\n`));
    for (const markdown of [
      source,
      await renderMarkdown(document, documents),
    ]) {
      const nodes = fromMarkdown(markdown).children;
      const sections = nodes.flatMap((node, index) =>
        node.type === 'heading' && node.depth === 2
          ? [
              {
                index,
                title: node.children
                  .map(child => ('value' in child ? child.value : ''))
                  .join(''),
              },
            ]
          : [],
      );
      assert.deepEqual(
        sections.map(section => section.title),
        headings,
        document.source,
      );
      const content = (title: string) => {
        const index = sections.findIndex(section => section.title === title);
        return nodes.slice(
          sections[index].index + 1,
          sections[index + 1]?.index,
        );
      };
      assert.deepEqual(
        content('Installation').flatMap(node =>
          node.type === 'code' && node.lang === 'sh' ? [node.value] : [],
        ),
        [
          'npm install ' +
            [...new Set(['@code3d/core', document.package!.name])].join(' '),
        ],
        `${document.source}: installation must not include example-only dependencies`,
      );
      const example = content('Example');
      if (document.package!.name === '@code3d/materials') {
        const extraInstall = example.findIndex(
          node =>
            node.type === 'code' &&
            node.lang === 'sh' &&
            node.value === 'npm install @code3d/layout',
        );
        assert.ok(
          extraInstall >= 0 &&
            extraInstall <
              example.findIndex(
                node => node.type === 'code' && node.lang === 'ts',
              ),
          'Explain Layout installation in the material grid example before its source',
        );
      }
      assert.equal(
        example[0].type,
        'paragraph',
        'Introduce the example before the code',
      );
      assert.ok(
        example.some(node => node.type === 'code' && node.lang === 'ts'),
      );
      assert.ok(
        example.some(
          node =>
            node.type === 'paragraph' &&
            node.children.some(child => child.type === 'image'),
        ),
      );
      for (const title of ['Documentation', 'Source and development']) {
        const section = content(title);
        assert.equal(
          section.length,
          1,
          `${document.source}: ${title} is a link list`,
        );
        assert.equal(section[0].type, 'list');
      }
    }
  }
});

test('package screenshots stay local for HTML and become raw images in Markdown', async () => {
  const documents = await markdownDocuments();
  const renderer = await satteri({
    mdastPlugins: [htmlDocuments],
  }).createRenderer({syntaxHighlight: false});
  for (const name of featuredPackages) {
    const document = documents.find(
      item => item.source === `packages/${name}/README.md`,
    )!;
    const source = await readFile(
      path.join(repository, document.source),
      'utf8',
    );
    const screenshots = fromMarkdown(source).children.flatMap(node =>
      node.type === 'paragraph'
        ? node.children.filter(child => child.type === 'image')
        : [],
    );
    assert.ok(screenshots.length, `${name}: missing overview screenshot`);
    const html = await renderer.render(source, {
      fileURL: pathToFileURL(path.join(repository, document.source)),
    });
    const references = markdownReferences(
      await renderMarkdown(document, documents),
    );
    for (const screenshot of screenshots) {
      assert.ok(screenshot.alt?.trim(), `${name}: screenshot needs alt text`);
      assert.ok(
        html.metadata.localImagePaths.includes(screenshot.url),
        `${name}: screenshot must reach Astro's local image pipeline`,
      );
      const published = await publishLink(screenshot.url, document, documents);
      assert.match(published, /^https:\/\/raw\.githubusercontent\.com\//);
      assert.ok(references.includes(published));
    }
    assert.ok(
      !html.code.includes(
        'github.com/vilicvane/code3d/blob/' +
          document.sourceCommit +
          '/packages/web/src/assets/models/',
      ),
    );
  }
});

test('HTML preserves a linked screenshot while rewriting its documentation target', async () => {
  const renderer = await satteri({
    mdastPlugins: [htmlDocuments],
  }).createRenderer({syntaxHighlight: false});
  const result = await renderer.render(
    '[![Sketch on a mounting plate](../../web/src/assets/models/mounting-plate.png)](../README.md)',
    {
      fileURL: pathToFileURL(
        path.join(repository, 'packages/core/docs/sketches.md'),
      ),
    },
  );
  assert.deepEqual(result.metadata.localImagePaths, [
    '../../web/src/assets/models/mounting-plate.png',
  ]);
  assert.ok(result.code.includes('href="../"'));
});

test('package screenshots follow code and canonical overview examples stay in sync', async () => {
  const documents = await markdownDocuments();
  for (const document of documents.filter(
    item => item.package && item.source.endsWith('.md'),
  )) {
    const source = await readFile(
      path.join(repository, document.source),
      'utf8',
    );
    let hasCode = false;
    for (const node of fromMarkdown(source).children) {
      if (node.type === 'heading') hasCode = false;
      if (node.type === 'code' && node.lang === 'ts') hasCode = true;
      if (
        node.type === 'paragraph' &&
        node.children.some(child => child.type === 'image')
      )
        assert.ok(
          hasCode,
          `${document.source}: show the example code before its screenshot`,
        );
    }
  }
  for (const [document, example] of [
    ['core/README.md', 'constraints/relate.ts'],
    ['layout/README.md', 'packages/layout/linear.ts'],
    ['materials/README.md', 'packages/material-presets.ts'],
    ['layout/docs/layouts.md', 'packages/layout/grid.ts'],
    ['layout/docs/layouts.md', 'packages/layout/radial.ts'],
  ]) {
    const markdown = await readFile(
      path.join(repository, 'packages', document),
      'utf8',
    );
    const canonical = await readFile(
      path.join(repository, 'packages/app/examples', example),
      'utf8',
    );
    assert.ok(
      fromMarkdown(markdown).children.some(
        node =>
          node.type === 'code' &&
          node.lang === 'ts' &&
          node.value.trim() === canonical.trim(),
      ),
      `${document}: use the actual ${example} source`,
    );
  }
});

test('Gears pairs a short related snippet with the colored multi-gear overview', async () => {
  const markdown = await readFile(
    path.join(repository, 'packages/gears/README.md'),
    'utf8',
  );
  const gallery = await readFile(
    path.join(repository, 'packages/app/examples/packages/gears.ts'),
    'utf8',
  );
  const snippet = fromMarkdown(markdown).children.find(
    node => node.type === 'code' && node.lang === 'ts',
  );
  assert.ok(snippet?.type === 'code');
  const wheel = snippet.value
    .slice(snippet.value.indexOf('spurGear({'))
    .trim()
    .replace(/;$/, '');
  assert.ok(wheel.startsWith('spurGear({'));
  assert.ok(gallery.replace(/\s+/g, '').includes(wheel.replace(/\s+/g, '')));
  assert.ok(markdown.includes('../web/src/assets/models/gears.png'));
});

test('package overview and detail pages share source links and current manifest versions', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'c3d-package-docs-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const files = {
    'packages/core/package.json': JSON.stringify({
      name: '@code3d/core',
      version: '1.2.3',
    }),
    'packages/core/README.md':
      '# @code3d/core\n\n[Guide](docs/model.md#example)\n',
    'packages/core/docs/model.md':
      '---\ntitle: Model guide\ndescription: Model a part.\n---\n\n## Example\n\n[Overview](../README.md)\n\n[Source](../src/index.ts)\n',
    'packages/core/src/index.ts': 'export const model = 1;\n',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await writeFile(path.join(root, file), content);
  }
  const documents = await markdownDocuments(root, 'test-commit');
  const overview = documents.find(item => item.overview)!;
  const guide = documents.find(item => item.source.endsWith('/model.md'))!;
  assert.equal(overview.html, '/docs/packages/core/');
  assert.equal(guide.html, '/docs/packages/core/model/');
  assert.match(
    await renderMarkdown(guide, documents),
    /# Model guide\n\n@code3d\/core · v1\.2\.3/,
  );
  for (const base of [
    'https://example.test/',
    'https://example.test/code3d/',
  ]) {
    for (const [format, location] of [
      ['html', 'html'],
      ['markdown', 'route'],
    ] as const) {
      const href = await publishLink(
        'docs/model.md#example',
        overview,
        documents,
        format,
      );
      assert.equal(
        new URL(href, base + overview[location]!.slice(1)).href,
        base + guide[location]!.slice(1) + '#example',
      );
      const back = await publishLink('../README.md', guide, documents, format);
      assert.equal(
        new URL(back, base + guide[location]!.slice(1)).href,
        base + overview[location]!.slice(1),
      );
    }
  }
  assert.equal(
    await publishLink('../src/index.ts', guide, documents, 'html'),
    'https://github.com/vilicvane/code3d/blob/test-commit/packages/core/src/index.ts',
  );
  await writeFile(
    path.join(root, 'packages/core/package.json'),
    JSON.stringify({name: '@code3d/core', version: '1.2.4'}),
  );
  const updated = await markdownDocuments(root, 'test-commit');
  for (const document of updated) {
    assert.ok(
      (await renderMarkdown(document, updated)).includes(
        '@code3d/core · v1.2.4',
      ),
    );
    assert.ok(!document.route.includes('1.2.4'));
  }
});

test('repository links become readable Markdown under root or nested deployments', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'c3d-markdown-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const files = {
    'docs/agents.md':
      '# Agent\n\n[Package](../packages/core/README.md#use)\n\n[![Preview](../packages/core/image.png)](../packages/core/README.md)\n\n[Source][implementation]\n\n[implementation]: ../packages/core/index.ts\n\n`[literal](missing.md)`\n\n```ts\n// [example](missing.md)\n```\n',
    'packages/core/package.json': JSON.stringify({
      name: '@code3d/core',
      version: '1.2.3',
    }),
    'packages/core/README.md':
      '# Core\n\n## Use\n\n[Entry](../../docs/agents.md)\n\n[Dependency](../agent/README.md)\n\n[Architecture](../../.agents/docs/architecture/modeling.md)\n',
    'packages/agent/README.md': '# Internal transport\n',
    '.agents/docs/architecture/modeling.md': '# Modeling architecture\n',
    'packages/core/index.ts': 'export const value = 1;\n',
    'packages/core/image.png': '',
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await writeFile(path.join(root, file), text);
  }
  const documents = await markdownDocuments(root, 'test-commit');
  assert.ok(
    !documents.some(document => document.route === '/docs/packages/agent.md'),
  );
  assert.ok(
    !documents.some(document => document.source.startsWith('.agents/')),
  );
  const core = documents.find(
    document => document.route === '/docs/packages/core.md',
  );
  assert.ok(core);
  const dependencyReadme = await renderMarkdown(core, documents);
  assert.ok(
    markdownReferences(dependencyReadme).includes(
      'https://raw.githubusercontent.com/vilicvane/code3d/test-commit/packages/agent/README.md',
    ),
  );
  assert.ok(
    markdownReferences(dependencyReadme).includes(
      'https://raw.githubusercontent.com/vilicvane/code3d/test-commit/.agents/docs/architecture/modeling.md',
    ),
  );
  const entry = documents.find(d => d.route === '/docs/agents.md');
  assert.ok(entry);
  const markdown = await renderMarkdown(entry, documents);
  const references = markdownReferences(markdown);
  for (const base of [
    'https://example.test/',
    'https://example.test/code3d/',
  ]) {
    assert.equal(
      new URL(references[0], base + 'docs/agents.md').href,
      base + 'docs/packages/core.md#use',
    );
  }
  assert.ok(
    references.includes(
      'https://raw.githubusercontent.com/vilicvane/code3d/test-commit/packages/core/index.ts',
    ),
  );
  assert.ok(
    references.includes(
      'https://raw.githubusercontent.com/vilicvane/code3d/test-commit/packages/core/image.png',
    ),
  );
  assert.ok(markdown.includes('`[literal](missing.md)`'));
  assert.ok(markdown.includes('// [example](missing.md)'));
});

test('Starlight YAML titles become plain Markdown headings', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'c3d-markdown-titles-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const directory = 'packages/web/src/content/docs/docs/reference';
  await mkdir(path.join(root, directory), {recursive: true});
  const cases = [
    {name: 'core', title: "'@code3d/core'", heading: '@code3d/core'},
    {name: 'layout', title: '"@code3d/layout"', heading: '@code3d/layout'},
    {
      name: 'overview',
      title: '>\n  Code3D\n  modeling',
      heading: 'Code3D modeling',
    },
  ];
  for (const {name, title} of cases) {
    await writeFile(
      path.join(root, directory, `${name}.md`),
      `---\ntitle: ${title}\n---\n\nPackage documentation.\n`,
    );
  }
  const documents = await markdownDocuments(root, 'test-commit');
  for (const {name, heading} of cases) {
    const document = documents.find(
      item => item.route === `/docs/reference/${name}.md`,
    );
    assert.ok(document);
    const markdown = await renderMarkdown(document, documents);
    assert.equal(markdown, `# ${heading}\n\nPackage documentation.\n`);
  }
});

test('MDX guides expose complete executable examples without UI components', async () => {
  const documents = await markdownDocuments();
  const document = documents.find(
    d => d.route === '/docs/packages/core/relations.md',
  );
  assert.ok(document);
  const guide = await renderMarkdown(document, documents);
  const source = await readFile(
    path.join(
      repository,
      'packages/app/examples/constraints/combined-constraints.ts',
    ),
    'utf8',
  );
  assert.ok(guide.startsWith('# Positioning with relations\n'));
  assert.ok(guide.includes(source.trimEnd()));
  assert.ok(!guide.includes('<ModelExample'));
  assert.ok(!guide.includes('<SourceCode'));
  assert.ok(!guide.includes('import ArrowIcon'));
  assert.ok(
    markdownReferences(guide).includes(
      '../../../app/#/file/examples/constraints/combined-constraints.ts',
    ),
  );
  assert.ok(markdownHeadings(guide).has('combine-conditions'));
});
