import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {
  markdownDocuments,
  renderMarkdown,
  markdownReferences,
  markdownHeadings,
  repository,
} from './markdown-documents.mjs';

test('repository links become readable Markdown under root or nested deployments', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'c3d-markdown-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const files = {
    'docs/agents.md':
      '# Agent\n\n[Package](../packages/demo/README.md#use)\n\n[![Preview](../packages/demo/image.png)](../packages/demo/README.md)\n\n[Source][implementation]\n\n[implementation]: ../packages/demo/index.ts\n\n`[literal](missing.md)`\n\n```ts\n// [example](missing.md)\n```\n',
    'packages/demo/README.md':
      '# Demo\n\n## Use\n\n[Entry](../../docs/agents.md)\n',
    'packages/demo/index.ts': 'export const value = 1;\n',
    'packages/demo/image.png': '',
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await writeFile(path.join(root, file), text);
  }
  const documents = await markdownDocuments(root, 'test-commit');
  const markdown = await renderMarkdown(
    documents.find(d => d.route === '/docs/agents.md'),
    documents,
  );
  const references = markdownReferences(markdown);
  for (const base of [
    'https://example.test/',
    'https://example.test/code3d/',
  ]) {
    assert.equal(
      new URL(references[0], base + 'docs/agents.md').href,
      base + 'docs/packages/demo.md#use',
    );
  }
  assert.ok(
    references.includes(
      'https://raw.githubusercontent.com/vilicvane/code3d/test-commit/packages/demo/index.ts',
    ),
  );
  assert.ok(
    references.includes(
      'https://raw.githubusercontent.com/vilicvane/code3d/test-commit/packages/demo/image.png',
    ),
  );
  assert.ok(markdown.includes('`[literal](missing.md)`'));
  assert.ok(markdown.includes('// [example](missing.md)'));
});

test('MDX guides expose complete executable examples without UI components', async () => {
  const documents = await markdownDocuments();
  const guide = await renderMarkdown(
    documents.find(d => d.route === '/docs/guides/relations.md'),
    documents,
  );
  const source = await readFile(
    path.join(repository, 'packages/app/examples/combined-constraints.ts'),
    'utf8',
  );
  assert.ok(guide.startsWith('# Positioning with relations\n'));
  assert.ok(guide.includes(source.trimEnd()));
  assert.ok(!guide.includes('<ModelExample'));
  assert.ok(!guide.includes('<SourceCode'));
  assert.ok(!guide.includes('import ArrowIcon'));
  assert.ok(
    markdownReferences(guide).includes(
      '../../app/#/file/examples/combined-constraints.ts',
    ),
  );
  assert.ok(markdownHeadings(guide).has('combine-conditions'));
});
