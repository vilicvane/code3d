import initOpenCascade from 'replicad-opencascadejs';
import openCascadeWasmUrl from 'replicad-opencascadejs/wasm?url';
import {installOpenCascade} from '@code3d/core/tooling';
import fastenerSource from '../examples/fasteners.ts?raw';
import {compileProject} from './model/compiler';
import {elementSourceDecoration} from './model/element-decorations';
import {
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
} from './model/operation-decorations';
import type {ModelProject} from './project/project';
import {ModelViewport} from './viewport';
import './render-image.css';

const renderProjects = {
  fasteners: {
    rootPath: '/examples/fasteners.ts',
    files: [{path: '/examples/fasteners.ts', source: fastenerSource}],
  },
} satisfies Record<string, ModelProject & Readonly<{rootPath: string}>>;

type ModelName = keyof typeof renderProjects;

function requestedModel(): ModelName {
  const name = new URLSearchParams(location.search).get('model') ?? 'fasteners';
  if (!(name in renderProjects)) {
    throw new Error(`Unknown render model: ${name}`);
  }
  return name as ModelName;
}

function requestedSourceOffset(source: string): number | undefined {
  const parameters = new URLSearchParams(location.search);
  const lineValue = parameters.get('line');
  if (lineValue === null) return undefined;

  const line = Number(lineValue);
  const column = Number(parameters.get('column') ?? '1');
  const lines = source.split('\n');
  if (
    !Number.isInteger(line) ||
    !Number.isInteger(column) ||
    line < 1 ||
    line > lines.length ||
    column < 1 ||
    column > lines[line - 1].length + 1
  ) {
    throw new Error(`Invalid source position: ${line}:${column}`);
  }
  return (
    lines
      .slice(0, line - 1)
      .reduce((offset, value) => offset + value.length + 1, 0) +
    column -
    1
  );
}

async function renderModel(): Promise<void> {
  const root = document.querySelector('#render-root');
  if (!(root instanceof HTMLElement)) {
    throw new Error('The render root is missing.');
  }

  const openCascade = await initOpenCascade({
    locateFile: () => openCascadeWasmUrl,
  });
  installOpenCascade(openCascade);

  const project = renderProjects[requestedModel()];
  const module = compileProject(project, project.rootPath);
  const viewport = new ModelViewport(root, {
    onSelect: () => undefined,
    onDrillDown: () => undefined,
    onNavigateSource: () => undefined,
    onPositionTool: () => undefined,
    onEdgeSelection: () => undefined,
    sourceDecorationProviders: [
      booleanOperationSourceDecoration,
      edgeModificationSourceDecoration,
      elementSourceDecoration,
    ],
  });
  viewport.renderModule(module);
  const source = project.files.find(
    file => file.path === project.rootPath,
  )!.source;
  const sourceOffset = requestedSourceOffset(source);
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
  document.documentElement.dataset.renderState = 'ready';
}

renderModel().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.renderState = 'error';
  document.body.textContent = message;
  console.error(error);
});
