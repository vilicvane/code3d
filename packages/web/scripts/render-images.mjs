import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  renderSamples,
  sourceContextSets,
} from '../../app/render-samples/catalog.ts';

const appDirectory = fileURLToPath(new URL('../../app/', import.meta.url));
function render(id, name, context) {
  execFileSync(
    process.execPath,
    [
      'scripts/render-image.mjs',
      '--model',
      id,
      '--output',
      `../web/src/assets/models/${name}.png`,
      '--width',
      '1440',
      '--height',
      '1080',
      ...(context ? ['--context', context] : []),
    ],
    {cwd: appDirectory, stdio: 'inherit', timeout: 120_000},
  );
}

for (const sample of renderSamples) render(sample.id, sample.id);
for (const [id, contexts] of Object.entries(sourceContextSets)) {
  for (const context of contexts.filter(context => context.image !== id)) {
    render(id, context.image, context.id);
  }
}
