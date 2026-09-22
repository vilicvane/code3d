import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkReview,
  frontmatter,
  reviewDocument,
  sourceReferences,
} from './source-review.mjs';
import {markdownDocuments} from './document-sources.mjs';
import {renderMarkdown} from './markdown-documents.mjs';

async function fixture(t: {after: (cleanup: () => Promise<void>) => void}) {
  const root = await mkdtemp(path.join(tmpdir(), 'code3d-source-review-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const document = 'packages/core/docs/api/box.md';
  const source = 'packages/core/src/library/box.ts';
  const files = {
    [source]: 'export const box = 1;\n',
    [document]: `---\ntitle: box\nsourceReview:\n  sources:\n    - path: ${source}\n---\n\nA box.\n`,
    'packages/core/package.json': JSON.stringify({
      name: '@code3d/core',
      version: '1.2.3',
    }),
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await writeFile(path.join(root, file), content);
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      timeout: 10_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  git('init');
  git('config', 'user.name', 'Source review test');
  git('config', 'user.email', 'test@example.invalid');
  const commit = () => {
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Test source');
    return git('rev-parse', 'HEAD');
  };
  return {root, document, source, commit};
}

test('only declared file changes require review; checking never writes the baseline', async t => {
  const {root, document, source} = await fixture(t);
  const review = await reviewDocument(root, document, '1.2.3');
  const baseline = await readFile(path.join(root, document), 'utf8');
  await writeFile(path.join(root, 'unrelated.ts'), 'export const sphere = 2;');
  assert.deepEqual(await checkReview(root, review), []);
  await writeFile(path.join(root, source), 'export const box = 2;\n');
  assert.deepEqual(await checkReview(root, review), [
    {path: source, status: 'changed'},
  ]);
  assert.equal(await readFile(path.join(root, document), 'utf8'), baseline);
  const updated = await reviewDocument(root, document, '1.2.4');
  assert.equal(updated.packageVersion, '1.2.4');
  assert.deepEqual(await checkReview(root, updated), []);
  assert.equal(
    frontmatter(await readFile(path.join(root, document), 'utf8')).body,
    '\nA box.\n',
  );
  await rm(path.join(root, source));
  assert.deepEqual(await checkReview(root, updated), [
    {path: source, status: 'missing'},
  ]);
});

test('source history is attached only to matching bytes, including after a new file is committed', async t => {
  const {root, document, source, commit} = await fixture(t);
  const review = await reviewDocument(root, document, '1.2.3');
  assert.equal(review.sources[0].commit, undefined);
  assert.equal(sourceReferences(root, review)[0].href, undefined);
  const sha = commit();
  assert.equal(sourceReferences(root, review)[0].commit, sha);
  const committed = await reviewDocument(root, document, '1.2.3');
  assert.equal(committed.sources[0].commit, sha);
  await writeFile(path.join(root, source), 'export const box = 2;\n');
  const changed = await reviewDocument(root, document, '1.2.3');
  assert.equal(changed.sources[0].commit, undefined);
  assert.equal(sourceReferences(root, changed)[0].href, undefined);
  assert.equal(sourceReferences(root, committed)[0].commit, sha);
});

test('a release does not change a page review version or fingerprint', async t => {
  const {root, document, commit} = await fixture(t);
  const review = await reviewDocument(root, document, '1.2.3');
  const sha = commit();
  await writeFile(
    path.join(root, 'packages/core/package.json'),
    JSON.stringify({name: '@code3d/core', version: '1.2.4'}),
  );
  const documents = await markdownDocuments(root, sha);
  const page = documents.find(page => page.source === document)!;
  assert.equal(page.package.version, '1.2.3');
  const markdown = await renderMarkdown(page, documents);
  assert.ok(markdown.includes('@code3d/core · Reviewed with v1.2.3'));
  assert.ok(markdown.includes(review.sources[0].sha256));
  assert.ok(markdown.includes(`/blob/${sha}/${review.sources[0].path}`));
  assert.deepEqual(await checkReview(root, review), []);
});

test('malformed or incomplete baselines fail with actionable errors', async t => {
  const {root, document} = await fixture(t);
  await assert.rejects(checkReview(root, undefined!), /sourceReview needs/);
  const review = await reviewDocument(root, document, '1.2.3');
  await assert.rejects(
    checkReview(root, {
      ...review,
      sources: [{...review.sources[0], path: '../outside.ts'}],
    }),
    /repository-relative/,
  );
  await assert.rejects(
    checkReview(root, {
      ...review,
      sources: [{...review.sources[0], sha256: ''}],
    }),
    /invalid SHA-256/,
  );
  await assert.rejects(
    checkReview(root, {
      ...review,
      sources: [...review.sources, ...review.sources],
    }),
    /Duplicate/,
  );
  await assert.rejects(
    checkReview(root, {
      ...review,
      sources: [{...review.sources[0], commit: 'main'}],
    }),
    /Invalid source commit/,
  );
});
