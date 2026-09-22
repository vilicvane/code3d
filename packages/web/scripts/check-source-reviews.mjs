import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {markdownDocuments, repository} from './document-sources.mjs';
import {checkReview, frontmatter, reviewDocument} from './source-review.mjs';

const [command = 'check', ...selected] = process.argv.slice(2);
if (
  !['check', 'review'].includes(command) ||
  (command === 'review' && !selected.length)
)
  throw new Error(
    'Usage: check-source-reviews.mjs check [page ...] | review <page ...>',
  );
const documents = await markdownDocuments();
for (const source of selected)
  if (
    !documents.some(document => document.source === source && document.package)
  )
    throw new Error(`Unknown package document: ${source}`);
let checked = 0;
for (const document of documents) {
  if (selected.length && !selected.includes(document.source)) continue;
  const {data} = frontmatter(
    await readFile(path.join(repository, document.source), 'utf8'),
  );
  const required = /^packages\/core\/docs\/api\//.test(document.source);
  if (!data.sourceReview && !required && !selected.length) continue;
  checked++;
  try {
    if (command === 'review') {
      const manifest = JSON.parse(
        await readFile(
          path.join(
            repository,
            'packages',
            document.packageDirectory,
            'package.json',
          ),
          'utf8',
        ),
      );
      await reviewDocument(repository, document.source, manifest.version);
      console.log(`Reviewed: ${document.source}`);
    } else {
      const changes = await checkReview(repository, data.sourceReview);
      for (const change of changes)
        console.error(`${document.source}: ${change.status} ${change.path}`);
      if (changes.length) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`${document.source}: ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(
  `${checked} source review(s) ${command === 'review' ? 'processed' : 'checked'}.`,
);
