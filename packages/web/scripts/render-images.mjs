import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  renderSamples,
  firstModelContexts,
} from '../../app/render-samples/catalog.ts';

const appDirectory = fileURLToPath(new URL('../../app/', import.meta.url));
function render(id, name, focus) {
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
      ...(focus ? ['--focus', focus] : []),
    ],
    {cwd: appDirectory, stdio: 'inherit', timeout: 120_000},
  );
}

for (const sample of renderSamples) render(sample.id, sample.id);
for (const context of firstModelContexts.filter(
  context => context.id !== 'model',
)) {
  // Include the remaining source so each focus string uniquely identifies the
  // argument occurrence, not the preceding declaration or relation.
  const source = context.focus.context;
  const focus = source.slice(source.indexOf(context.focus.token));
  render('first-model', `first-model-${context.id}`, focus);
}
