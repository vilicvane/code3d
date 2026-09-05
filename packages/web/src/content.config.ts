import {defineCollection} from 'astro:content';
import {z} from 'astro/zod';
import {docsLoader, i18nLoader} from '@astrojs/starlight/loaders';
import {docsSchema, i18nSchema} from '@astrojs/starlight/schema';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderSamples} from '../../app/render-samples/catalog';

const examples = defineCollection({
  loader: {
    name: 'code3d-examples',
    async load({store, parseData, generateDigest, watcher, logger}) {
      const paths = new Map(
        renderSamples.map(sample => [
          fileURLToPath(
            new URL(`../../app/examples/${sample.file}`, import.meta.url),
          ),
          sample,
        ]),
      );
      const loadFile = async (filePath: string) => {
        const sample = paths.get(filePath)!;
        const relativePath = `../app/examples/${sample.file}`;
        const data = await parseData({
          id: sample.id,
          filePath: relativePath,
          data: {
            ...sample,
            tags: [...sample.tags],
            source: await readFile(filePath, 'utf8'),
          },
        });
        store.set({
          id: sample.id,
          data,
          filePath: relativePath,
          digest: generateDigest(data),
        });
      };
      store.clear();
      await Promise.all([...paths.keys()].map(loadFile));
      if (watcher) {
        watcher.add([...paths.keys()]);
        watcher.on('change', filePath => {
          if (paths.has(filePath)) {
            void loadFile(filePath).catch(error => logger.error(String(error)));
          }
        });
      }
    },
  },
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
    file: z.string(),
    source: z.string(),
    tags: z.array(z.string()),
    focus: z.object({context: z.string(), token: z.string()}),
  }),
});

export const collections = {
  docs: defineCollection({loader: docsLoader(), schema: docsSchema()}),
  i18n: defineCollection({loader: i18nLoader(), schema: i18nSchema()}),
  examples,
};
