import {glob, type Loader} from 'astro/loaders';
import {reviewedPackage} from './source-review.mjs';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fromMarkdown} from 'mdast-util-from-markdown';
import type {Nodes} from 'mdast';
import {
  documentLocation,
  featuredPackages,
  packageMetadata,
  repository,
  websiteDocumentPatterns,
} from './document-sources.mjs';

function plainText(node: Nodes): string {
  if ('children' in node) return node.children.map(plainText).join('');
  return 'value' in node ? node.value : '';
}

async function overviewDescription(file: string): Promise<string> {
  const paragraph = fromMarkdown(await readFile(file, 'utf8')).children.find(
    node => node.type === 'paragraph',
  )!;
  return plainText(paragraph).replace(/\s+/g, ' ').trim();
}

export function docsLoader(): Loader {
  const source = glob({
    base: repository,
    pattern: websiteDocumentPatterns,
    generateId: ({entry}) =>
      documentLocation(entry).html!.replace(/^\/|\/$/g, ''),
  });
  return {
    name: 'code3d-docs',
    async load(context) {
      const manifests = new Map(
        await Promise.all(
          featuredPackages.map(
            async directory =>
              [
                path.join(repository, 'packages', directory, 'package.json'),
                await packageMetadata(directory),
              ] as const,
          ),
        ),
      );
      const generateDigest = (value: string | Record<string, unknown>) =>
        context.generateDigest({value, manifests: [...manifests.values()]});
      await source.load({
        ...context,
        generateDigest,
        async parseData(entry) {
          const relative = path.relative(repository, entry.filePath!);
          const location = documentLocation(relative);
          if (!location.packageDirectory) return context.parseData(entry);
          const metadata = manifests.get(
            path.join(
              repository,
              'packages',
              location.packageDirectory,
              'package.json',
            ),
          )!;
          const data = entry.data;
          return context.parseData({
            ...entry,
            data: {
              ...data,
              ...(location.overview
                ? {
                    title: metadata.name,
                    description: await overviewDescription(entry.filePath!),
                    sidebar: {label: 'Overview', order: 0},
                  }
                : {}),
              package: reviewedPackage(metadata, data.sourceReview),
              editUrl: `https://github.com/vilicvane/code3d/edit/main/${relative}`,
            },
          });
        },
      });
      if (context.watcher) {
        context.watcher.add([...manifests.keys()]);
        context.watcher.on('change', file => {
          if (!manifests.has(file)) return;
          void (async () => {
            const directory = path.basename(path.dirname(file));
            const metadata = await packageMetadata(directory);
            manifests.set(file, metadata);
            for (const [id, entry] of context.store.entries()) {
              if (
                id === `docs/packages/${directory}` ||
                id.startsWith(`docs/packages/${directory}/`)
              )
                context.store.set({
                  ...entry,
                  data: {
                    ...entry.data,
                    package: reviewedPackage(metadata, entry.data.sourceReview),
                  },
                  digest: generateDigest(
                    await readFile(
                      new URL(entry.filePath!, context.config.root),
                      'utf8',
                    ),
                  ),
                });
            }
          })().catch(error => context.logger.error(String(error)));
        });
      }
    },
  };
}
