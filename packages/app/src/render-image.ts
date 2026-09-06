import {openBrowserProjectFileSystem} from './project/filesystem';
import {ModelCompilerClient} from './model/compiler-client';
import {
  sourceTokenOffset,
  type SourceToken,
  uniqueSourceOffset,
} from '../render-samples/source-focus';
import {renderSamples} from '../render-samples/catalog';
import {ModelDiagnosticError} from './model/diagnostic';
import {sourceDecorationProviders} from './model/source-decorations';
import type {ModelProject} from './project/project';
import {ModelViewport} from './viewport';
import './render-image.css';

const sources = import.meta.glob<string>('../examples/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const renderProjects: Record<
  string,
  ModelProject & Readonly<{rootPath: string; focus: SourceToken}>
> = Object.fromEntries(
  renderSamples.map(sample => [
    sample.id,
    {
      rootPath: '/' + sample.file,
      files: [
        {
          path: '/' + sample.file,
          source: sources['../examples/' + sample.file]!,
        },
      ],
      focus: sample.focus,
    },
  ]),
);

type ModelName = keyof typeof renderProjects;

function requestedModel(): ModelName {
  const name =
    new URLSearchParams(location.search).get('model') ?? 'first-model';
  if (!(name in renderProjects)) {
    throw new Error(`Unknown render model: ${name}`);
  }
  return name as ModelName;
}

function requestedSourceOffset(
  source: string,
  defaultFocus: SourceToken,
): number | undefined {
  const parameters = new URLSearchParams(location.search);
  const focus = parameters.get('focus');
  return focus
    ? uniqueSourceOffset(source, focus)
    : sourceTokenOffset(source, defaultFocus);
}

async function renderModel(): Promise<void> {
  const root = document.querySelector('#render-root');
  if (!(root instanceof HTMLElement)) {
    throw new Error('The render root is missing.');
  }

  const project = renderProjects[requestedModel()];
  const compiler = new ModelCompilerClient(
    await openBrowserProjectFileSystem(),
  );
  const module = await compiler
    .compile(project, project.rootPath)
    .finally(() => compiler.dispose());
  if (module.diagnostic) {
    throw new ModelDiagnosticError(module.diagnostic);
  }
  const viewport = new ModelViewport(root, {
    onSelect: () => undefined,
    onDrillDown: () => undefined,
    onNavigateSource: () => undefined,
    onPositionTool: () => undefined,
    onTopologySelection: () => undefined,
    showCoordinateReference: false,
    sourceDecorationProviders,
  });
  viewport.renderModule(module);
  const source = project.files.find(
    file => file.path === project.rootPath,
  )!.source;
  const sourceOffset = requestedSourceOffset(source, project.focus);
  if (sourceOffset !== undefined) {
    if (!viewport.selectBySourceOffset(project.rootPath, sourceOffset)) {
      throw new Error(
        'The requested source position has no renderable context.',
      );
    }
    document.documentElement.dataset.renderFocus = 'source';
  } else {
    document.documentElement.dataset.renderFocus = 'model';
  }

  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const {width, height} = root.getBoundingClientRect();
  const image = await viewport.captureImage(
    Math.round(width),
    Math.round(height),
  );
  window.code3dRenderedImage = await blobDataUrl(image);
  document.documentElement.dataset.renderState = 'ready';
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

declare global {
  interface Window {
    code3dRenderedImage?: string;
  }
}

renderModel().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.renderState = 'error';
  document.body.textContent = message;
  console.error(error);
});
