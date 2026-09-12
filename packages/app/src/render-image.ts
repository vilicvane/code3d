import {BrowserPackageManager} from './project/browser-package-manager';
import {bundledExamples} from './project/bundled-examples';
import {openBrowserProjectFileSystem} from './project/filesystem';
import {ModelCompilerClient} from './model/compiler-client';
import {
  sourceTokenOffset,
  type SourceToken,
} from '../render-samples/source-focus';
import {renderSamples, sourceContextSets} from '../render-samples/catalog';
import {ModelDiagnosticError} from './model/diagnostic';
import {sourceDecorationProviders} from './model/source-decorations';
import {ModelViewport} from './viewport';
import './render-image.css';

const renderProjects = Object.fromEntries(
  renderSamples.map(sample => [
    sample.id,
    {
      rootPath: '/examples/' + sample.file,
      files: bundledExamples.files,
      focus: sample.focus,
      view: 'view' in sample ? sample.view : undefined,
    },
  ]),
);

type ModelName = keyof typeof renderProjects;

function requestedModel(): ModelName {
  const name =
    new URLSearchParams(location.search).get('model') ?? 'desktop-stand';
  if (!(name in renderProjects)) {
    throw new Error(`Unknown render model: ${name}`);
  }
  return name as ModelName;
}

function requestedSourceOffset(
  name: ModelName,
  source: string,
  defaultFocus: SourceToken,
): number {
  const parameters = new URLSearchParams(location.search);
  const contextId = parameters.get('context');
  if (!contextId) return sourceTokenOffset(source, defaultFocus);
  const context = sourceContextSets[name]?.find(
    context => context.id === contextId,
  );
  if (!context)
    throw new Error(`Unknown source context for ${name}: ${contextId}`);
  return sourceTokenOffset(source, context.focus);
}

async function renderModel(): Promise<void> {
  const root = document.querySelector('#render-root');
  if (!(root instanceof HTMLElement)) {
    throw new Error('The render root is missing.');
  }

  const name = requestedModel();
  const project = renderProjects[name];
  const files = await openBrowserProjectFileSystem();
  await files.initialize();
  await files.syncDirectory(bundledExamples);
  const packages = new BrowserPackageManager(files);
  await packages.prepare(project.rootPath);
  const compiler = new ModelCompilerClient(packages.dependencies);
  const module = await compiler
    .compile(project, project.rootPath)
    .finally(() => compiler.dispose());
  if (module.diagnostic) {
    throw new ModelDiagnosticError(module.diagnostic);
  }
  const viewport = new ModelViewport(root, {
    animateViewChanges: false,
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
  const sourceOffset = requestedSourceOffset(name, source, project.focus);
  if (!viewport.selectBySourceOffset(project.rootPath, sourceOffset)) {
    throw new Error('The requested source position has no renderable context.');
  }
  document.documentElement.dataset.renderFocus = 'source';

  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const {width, height} = root.getBoundingClientRect();
  const image = await viewport.captureImage(
    Math.round(width),
    Math.round(height),
    project.view,
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
