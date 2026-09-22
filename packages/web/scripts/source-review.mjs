import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {load, dump} from 'js-yaml';

/** @typedef {{path: string, sha256: string, commit?: string}} ReviewedSource */
/** @typedef {{packageVersion: string, sources: ReviewedSource[]}} SourceReview */

export function frontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  return {
    data: match ? load(match[1]) : {},
    body: markdown.slice(match?.[0].length ?? 0),
  };
}

export function reviewedPackage(metadata, review) {
  return review ? {...metadata, version: review.packageVersion} : metadata;
}

function sourcePath(root, source) {
  if (
    typeof source !== 'string' ||
    !source ||
    source.startsWith('/') ||
    source.includes('\\') ||
    source.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error(`Expected a repository-relative source file: ${source}`);
  return path.join(root, source);
}

export function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

/** Find a committed copy only when its bytes match the reviewed file. */
export function matchingCommit(root, source) {
  try {
    const options = {
      cwd: root,
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    };
    const commit = execFileSync(
      'git',
      ['log', '-1', '--format=%H', 'HEAD', '--', source.path],
      options,
    )
      .toString()
      .trim();
    if (!commit) return undefined;
    const content = execFileSync('git', ['show', `${commit}:${source.path}`], {
      ...options,
      maxBuffer: 8 * 1024 * 1024,
    });
    return contentHash(content) === source.sha256 ? commit : undefined;
  } catch {
    // A working-tree baseline or a source archive need not have Git history.
    return undefined;
  }
}

/** @param {SourceReview | undefined} review */
export function validateReview(review) {
  if (
    !review ||
    typeof review.packageVersion !== 'string' ||
    !review.packageVersion ||
    !Array.isArray(review.sources) ||
    !review.sources.length
  )
    throw new Error(
      'sourceReview needs packageVersion and at least one source file',
    );
  const seen = new Set();
  for (const source of review.sources) {
    sourcePath('.', source.path);
    if (seen.has(source.path))
      throw new Error(`Duplicate reviewed source: ${source.path}`);
    seen.add(source.path);
    if (!/^[a-f0-9]{64}$/.test(source.sha256))
      throw new Error(`Missing or invalid SHA-256: ${source.path}`);
    if (source.commit !== undefined && !/^[a-f0-9]{40,64}$/.test(source.commit))
      throw new Error(`Invalid source commit: ${source.path}`);
  }
}

/** @param {SourceReview} review */
export async function checkReview(root, review) {
  validateReview(review);
  const changes = [];
  for (const source of review.sources) {
    try {
      if (
        contentHash(await readFile(sourcePath(root, source.path))) !==
        source.sha256
      )
        changes.push({path: source.path, status: 'changed'});
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      changes.push({path: source.path, status: 'missing'});
    }
  }
  return changes;
}

/** Refresh only a specifically selected page after human review. */
export async function reviewDocument(root, document, packageVersion) {
  const file = sourcePath(root, document);
  const {data, body} = frontmatter(await readFile(file, 'utf8'));
  if (
    !Array.isArray(data.sourceReview?.sources) ||
    !data.sourceReview.sources.length
  )
    throw new Error(
      `${document}: declare sourceReview.sources before reviewing`,
    );
  const sources = [];
  for (const source of data.sourceReview.sources) {
    const sha256 = contentHash(await readFile(sourcePath(root, source.path)));
    const commit = matchingCommit(root, {path: source.path, sha256});
    sources.push({path: source.path, sha256, ...(commit ? {commit} : {})});
  }
  const review = {packageVersion, sources};
  validateReview(review);
  data.sourceReview = review;
  await writeFile(
    file,
    `---\n${dump(data, {lineWidth: -1, noRefs: true})}---\n${body}`,
  );
  return review;
}

/**
 * Resolve history after a new file is committed without refreshing its baseline.
 * @param {string} root
 * @param {SourceReview} review
 */
export function sourceReferences(root, review) {
  validateReview(review);
  return review.sources.map(source => {
    const commit = source.commit ?? matchingCommit(root, source);
    return {
      ...source,
      commit,
      href: commit
        ? `https://github.com/vilicvane/code3d/blob/${commit}/${source.path}`
        : undefined,
    };
  });
}
