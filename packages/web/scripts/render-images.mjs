import {fileURLToPath} from 'node:url';
import {renderImages} from '../../app/scripts/render-image.mjs';
import {
  renderSamples,
  sourceContextSets,
} from '../../app/render-samples/catalog.ts';

const output = name =>
  fileURLToPath(new URL(`../src/assets/models/${name}.png`, import.meta.url));
const requests = renderSamples.map(sample => ({
  model: sample.id,
  output: output(sample.id),
}));
for (const [model, contexts] of Object.entries(sourceContextSets))
  for (const context of contexts.filter(context => context.image !== model))
    requests.push({model, output: output(context.image), context: context.id});
await renderImages(
  requests.map(request => ({...request, width: 1440, height: 1080})),
);
if (process.env.CODE3D_CHROME_CDP_ENDPOINT) process.exit(0);
