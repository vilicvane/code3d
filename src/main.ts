import './style.css';
import {
  CodeEditor,
  type ActiveFileChangeReason,
  type CompletionFocus,
  type ProjectEditorChange,
} from './editor';
import {ModelCompilerClient} from './model/compiler-client';
import type {
  DesignArgumentContext,
  ModelModule,
  ObjectCatalogEntry,
} from './model/compiler';
import {ModelDiagnosticError} from './model/diagnostic';
import {defaultProject} from './project/default-project';
import {
  openBrowserProjectFileSystem,
  type ProjectFileSystem,
} from './project/filesystem';
import {filePathFromRoute, fileRoute} from './project/file-route';
import type {ModelProject} from './project/project';
import type {
  ModelSnapshotObject,
  ParameterTarget,
  ParameterUsage,
  SourceRef,
} from './model/runtime';
import {booleanOperationSourceDecoration} from './model/operation-decorations';
import {elementSourceDecoration} from './model/element-decorations';
import type {
  PositionGizmoBinding,
  PositionGizmoEvent,
} from './tools/position-gizmo';
import {parameterRange} from './tools/parameter-policy';
import {
  ToolEngine,
  type ToolIntent,
  type ToolPreview,
  type ToolSession,
} from './tools/tool-system';
import {ModelViewport, type Occurrence} from './viewport';
import {DockPanelCoordinator} from './ui/dock-panels';
import {SourceEditPopover} from './ui/source-edit-popover';

const projectFileSystem = await openBrowserProjectFileSystem();
let initialProject = await projectFileSystem.load();
if (!initialProject) {
  initialProject = await projectFileSystem.replace(defaultProject);
}
const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element.');
}

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>code3d</span>
        <span class="prototype-tag">prototype 01</span>
      </div>
      <div class="run-state" id="run-state" data-state="idle">
        <span class="run-state-dot"></span>
        <span id="run-state-label">Waiting to compile</span>
      </div>
      <div class="topbar-actions">
        <button class="quiet-button" id="reset-button" type="button">Reset example</button>
      </div>
    </header>

    <main class="workspace">
      <section class="pane editor-pane">
        <header class="pane-header">
          <div class="pane-title">
            <span class="language-badge">TS</span>
            <span id="active-file-name">model.ts</span>
          </div>
          <div class="editor-header-actions">
            <span class="pane-meta">TypeScript module · ⇧ Alt F Format</span>
            <aside class="dock-panel object-catalog" id="object-catalog" aria-label="Model outline">
              <button class="dock-panel-handle" id="object-catalog-handle" type="button">
                <span>MODEL OUTLINE</span>
                <span class="dock-panel-handle-meta">
                  <span id="object-catalog-count">0</span>
                  <kbd data-dock-shortcut></kbd>
                </span>
              </button>
              <div class="dock-panel-body object-catalog-body" id="object-catalog-body" hidden>
                <div class="object-catalog-list" id="object-catalog-list"></div>
                <p class="object-catalog-hint">Hover to preview · Click to open source</p>
              </div>
            </aside>
          </div>
        </header>
        <div class="editor-workspace">
          <aside class="project-explorer" aria-label="Project files">
            <header>
              <span>PROJECT</span>
              <div class="project-actions">
                <button id="new-file-button" type="button" title="New file">＋</button>
              </div>
            </header>
            <nav class="project-tree" id="project-tree"></nav>
          </aside>
          <div class="project-context-menu" id="project-context-menu" hidden>
            <button id="context-rename-file" type="button">Rename</button>
            <button id="context-delete-file" type="button">Delete</button>
          </div>
          <section class="editor-document">
            <nav class="editor-tabs" id="editor-tabs" aria-label="Open files"></nav>
            <div class="editor-host" id="editor-host"></div>
          </section>
        </div>
        <div class="error-bar" id="error-bar" hidden></div>
      </section>

      <section class="pane preview-pane">
        <header class="pane-header scope-header">
          <div class="pane-title">
            <span class="preview-icon" aria-hidden="true"></span>
            <span>Model</span>
          </div>
          <nav class="scope-list" id="scope-list" aria-label="Model scope"></nav>
        </header>
        <div class="viewport-host" id="viewport-host">
          <div class="viewport-hint">Drag to orbit · Scroll to zoom · Click an object · Drag a gizmo</div>
          <div class="tool-status" id="tool-status" hidden></div>
          <div class="viewport-render-status" id="viewport-render-status" role="status" aria-live="polite" hidden>
            <span class="viewport-render-status-spinner" aria-hidden="true"></span>
            <span id="viewport-render-status-label"></span>
          </div>
          <div class="viewport-dock-panels">
            <aside class="dock-panel design-arguments-panel" id="design-arguments-panel" aria-label="Design arguments">
              <button class="dock-panel-handle" id="design-arguments-handle" type="button">
                <span>ARGUMENTS</span>
                <span class="dock-panel-handle-meta">
                  <span id="design-arguments-count">0</span>
                  <kbd data-dock-shortcut></kbd>
                </span>
              </button>
              <div class="dock-panel-body design-arguments" id="design-arguments" hidden>
                <div class="design-arguments-heading">
                  <span>FUNCTION</span>
                  <strong id="design-arguments-function">No function context</strong>
                </div>
                <div class="design-arguments-options" id="design-arguments-options"></div>
              </div>
            </aside>
            <aside class="dock-panel inspector-panel" id="inspector-panel" aria-label="Object properties">
              <button class="dock-panel-handle" id="inspector-handle" type="button">
                <span>PROPERTIES</span>
                <kbd data-dock-shortcut></kbd>
              </button>
              <div class="dock-panel-body inspector" id="inspector" hidden></div>
            </aside>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <span>JS/TS OBJECT MODEL</span>
      <span class="footer-separator"></span>
      <span>MONACO + OPENCASCADE</span>
      <span class="footer-note">B-Rep → Three.js mesh</span>
    </footer>
  </div>
`;

const editorHost = requiredElement('editor-host');
const viewportHost = requiredElement('viewport-host');
const runState = requiredElement('run-state');
const runStateLabel = requiredElement('run-state-label');
const errorBar = requiredElement('error-bar');
const scopeList = requiredElement('scope-list');
const objectCatalogList = requiredElement('object-catalog-list');
const objectCatalogCount = requiredElement('object-catalog-count');
const inspector = requiredElement('inspector');
const designArgumentsCount = requiredElement('design-arguments-count');
const designArgumentsFunction = requiredElement('design-arguments-function');
const designArgumentsOptions = requiredElement('design-arguments-options');
const toolStatus = requiredElement('tool-status');
const viewportRenderStatus = requiredElement('viewport-render-status');
const viewportRenderStatusLabel = requiredElement(
  'viewport-render-status-label',
);
const projectTree = requiredElement('project-tree');
const editorTabs = requiredElement('editor-tabs');
const activeFileName = requiredElement('active-file-name');
const resetButton = requiredElement<HTMLButtonElement>('reset-button');
const newFileButton = requiredElement<HTMLButtonElement>('new-file-button');
const projectContextMenu = requiredElement('project-context-menu');
const contextRenameFile = requiredElement<HTMLButtonElement>(
  'context-rename-file',
);
const contextDeleteFile = requiredElement<HTMLButtonElement>(
  'context-delete-file',
);

const dockPanels = new DockPanelCoordinator();
dockPanels.register({
  root: requiredElement('object-catalog'),
  handle: requiredElement<HTMLButtonElement>('object-catalog-handle'),
  body: requiredElement('object-catalog-body'),
  shortcut: {code: 'Digit1', label: 'Alt 1', altKey: true},
});
dockPanels.register({
  root: requiredElement('inspector-panel'),
  handle: requiredElement<HTMLButtonElement>('inspector-handle'),
  body: inspector,
  shortcut: {code: 'Digit2', label: 'Alt 2', altKey: true},
});
dockPanels.register({
  root: requiredElement('design-arguments-panel'),
  handle: requiredElement<HTMLButtonElement>('design-arguments-handle'),
  body: requiredElement('design-arguments'),
  shortcut: {code: 'Digit3', label: 'Alt 3', altKey: true},
});

const codeEditor = new CodeEditor(
  editorHost,
  initialProject,
  initialFilePath(initialProject, window.location.hash),
);
replaceFileRoute(codeEditor.currentFile());
const compiler = new ModelCompilerClient();
let persistenceQueue = Promise.resolve();
let currentModule: ModelModule | null = null;
let compileTimer: number | undefined;
let completionPreviewTimer: number | undefined;
let outlinePreviewTimer: number | undefined;
let explodeValue = 0;
let runRevision = 0;
let positionToolSession: ToolSession | undefined;
let positionToolInterruptedCompile = false;
let contextFilePath: string | undefined;
let preferredEvaluationContextId: string | undefined;
let selectedDesignContextId: string | undefined;
let compilingDesignContextId: string | undefined;
let activeCompletionFocus: CompletionFocus | undefined;
let applyingFileRoute = false;
const expandedCatalogIds = new Set<string>();
const optimisticParameterValues = new Map<string, number>();

const viewport = new ModelViewport(viewportHost, {
  onSelect: occurrence => {
    if (occurrence.view === 'model') {
      preferredEvaluationContextId = undefined;
      selectedDesignContextId = undefined;
    } else {
      preferredEvaluationContextId =
        viewport.sourceEvaluation()?.evaluation.contextId;
    }
    selectOccurrence(occurrence, occurrence.view === 'model');
  },
  onNavigateSource: sourceRef => {
    codeEditor.revealSource(sourceRef);
  },
  onPositionTool: handlePositionTool,
  sourceDecorationProviders: [
    booleanOperationSourceDecoration,
    elementSourceDecoration,
  ],
});
const sourceEditPopover = new SourceEditPopover(viewportHost, sourceRef =>
  codeEditor.revealSource(sourceRef, true),
);
const toolEngine = new ToolEngine({
  sourceVersion: () => codeEditor.sourceVersion(),
  resolveSourceRef: sourceRef => codeEditor.resolveSourceRef(sourceRef),
  readSource: sourceRef => codeEditor.readSource(sourceRef),
  applySourceEdits: (baseVersion, edits) =>
    codeEditor.applySourceEdits(baseVersion, edits),
  applyPreview: preview => applyToolPreview(preview),
  commitPreview: preview => commitToolPreview(preview),
  clearPreview: (preview, reason) => clearToolPreview(preview, reason),
});

codeEditor.onChange(change => {
  persistProjectChange(projectFileSystem, change);
  sourceEditPopover.dismiss();
  renderProjectNavigation();
  activeCompletionFocus = undefined;
  window.clearTimeout(completionPreviewTimer);
  completionPreviewTimer = undefined;
  viewport.restoreTransientPreview();
  hideViewportRenderStatus();
  setRunState('pending', 'Waiting for update');
  runRevision += 1;
  compiler.cancel();
  scheduleModelRun(420);
});

codeEditor.onCursorOffset(({file, offset}) => {
  const matched = viewport.selectBySourceOffset(
    file,
    offset,
    undefined,
    preferredEvaluationContextId,
  );
  if (!matched && currentModule) {
    const designContext = designContextAt(currentModule, file, offset);
    if (
      designContext &&
      currentModule.activeDesignContextId !== designContext.id
    ) {
      activateDesignContext(designContext.id);
      return;
    }
  }
  preferredEvaluationContextId =
    viewport.sourceEvaluation()?.evaluation.contextId;
  const occurrence = viewport.getSelected();
  if (occurrence) {
    selectOccurrence(occurrence, false);
  } else if (currentModule) {
    renderContextControls(currentModule);
  }
});
codeEditor.onCompletionFocus(handleCompletionFocus);
codeEditor.onActiveFile((path, reason) => {
  renderProjectNavigation();
  if (!applyingFileRoute) updateFileRoute(path, reason);
});

window.addEventListener('popstate', () => {
  const path = filePathFromRoute(window.location.hash);
  if (!path || !codeEditor.filePaths().includes(path)) {
    replaceFileRoute(codeEditor.currentFile());
    return;
  }
  applyingFileRoute = true;
  try {
    codeEditor.switchFile(path);
  } finally {
    applyingFileRoute = false;
  }
});

newFileButton.addEventListener('click', () => {
  const path = window.prompt('New file path', '/lib/model.ts')?.trim();
  if (!path) return;
  try {
    codeEditor.createFile(path, "import {box} from 'code3d';\n\n");
  } catch (error) {
    showProjectIssue(error);
  }
});
contextRenameFile.addEventListener('click', () => renameContextFile());
contextDeleteFile.addEventListener('click', () => deleteContextFile());
window.addEventListener('pointerdown', event => {
  if (!projectContextMenu.contains(event.target as Node)) {
    hideProjectContextMenu();
  }
});

resetButton.addEventListener('click', () => {
  if (!window.confirm('Restore the prototype example?')) {
    return;
  }
  void resetProject();
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !projectContextMenu.hidden) {
    hideProjectContextMenu();
    event.preventDefault();
    return;
  }
  const historyAction = sourceHistoryAction(event);
  if (historyAction && !codeEditor.ownsFocus()) {
    codeEditor.runHistoryAction(historyAction);
    event.preventDefault();
    return;
  }
  if (dockPanels.handleKeyDown(event)) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && viewport.cancelPositionTool()) {
    event.preventDefault();
    return;
  }
});

renderProjectNavigation();
runModel();

function persistProjectChange(
  fileSystem: ProjectFileSystem,
  change: ProjectEditorChange,
): void {
  persistenceQueue = persistenceQueue
    .then(async () => {
      if (change.kind === 'content' || change.kind === 'create') {
        await fileSystem.writeFile(change.path, change.source);
      } else if (change.kind === 'rename') {
        await fileSystem.rename(change.from, change.to);
      } else {
        await fileSystem.remove(change.path);
      }
    })
    .catch(error => showProjectIssue(error));
}

async function resetProject(): Promise<void> {
  try {
    await persistenceQueue;
    preferredEvaluationContextId = undefined;
    selectedDesignContextId = undefined;
    initialProject = await projectFileSystem.replace(defaultProject);
    codeEditor.reset(initialProject);
    runModel();
  } catch (error) {
    showProjectIssue(error);
  }
}

function initialFilePath(project: ModelProject, hash: string): string {
  const routed = filePathFromRoute(hash);
  return routed && project.files.some(file => file.path === routed)
    ? routed
    : project.entryPath;
}

function updateFileRoute(path: string, reason: ActiveFileChangeReason): void {
  if (reason === 'switch') {
    pushFileRoute(path);
  } else {
    replaceFileRoute(path);
  }
}

function pushFileRoute(path: string): void {
  const route = fileRoute(path);
  if (window.location.hash === route) return;
  const url = new URL(window.location.href);
  url.hash = route.slice(1);
  window.history.pushState(null, '', url);
}

function replaceFileRoute(path: string): void {
  const route = fileRoute(path);
  if (window.location.hash === route) return;
  const url = new URL(window.location.href);
  url.hash = route.slice(1);
  window.history.replaceState(null, '', url);
}

function renderProjectNavigation(): void {
  const active = codeEditor.currentFile();
  activeFileName.textContent = active.slice(active.lastIndexOf('/') + 1);
  projectTree.replaceChildren(
    ...codeEditor.filePaths().map(path => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'project-file';
      button.classList.toggle('active', path === active);
      button.title = path;
      button.textContent = path.slice(1);
      button.addEventListener('click', () => codeEditor.switchFile(path, true));
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        showProjectContextMenu(path, event.clientX, event.clientY);
      });
      return button;
    }),
  );
  editorTabs.replaceChildren(
    ...codeEditor.openedFiles().map(path => {
      const tab = document.createElement('span');
      tab.className = 'editor-tab';
      tab.classList.toggle('active', path === active);
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = path.slice(path.lastIndexOf('/') + 1);
      open.title = path;
      open.addEventListener('click', () => codeEditor.switchFile(path, true));
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'editor-tab-close';
      close.textContent = '×';
      close.setAttribute('aria-label', `Close ${path}`);
      close.addEventListener('click', event => {
        event.stopPropagation();
        codeEditor.closeFile(path);
        renderProjectNavigation();
      });
      tab.append(open, close);
      return tab;
    }),
  );
}

function showProjectContextMenu(path: string, x: number, y: number): void {
  contextFilePath = path;
  const entry = path === codeEditor.project().entryPath;
  contextRenameFile.disabled = entry;
  contextDeleteFile.disabled = entry;
  projectContextMenu.style.left = `${x}px`;
  projectContextMenu.style.top = `${y}px`;
  projectContextMenu.hidden = false;
}

function hideProjectContextMenu(): void {
  projectContextMenu.hidden = true;
  contextFilePath = undefined;
}

function renameContextFile(): void {
  const current = contextFilePath;
  hideProjectContextMenu();
  if (!current) return;
  const path = window.prompt('Rename file', current)?.trim();
  if (!path || path === current) return;
  try {
    codeEditor.renameFile(current, path);
  } catch (error) {
    showProjectIssue(error);
  }
}

function deleteContextFile(): void {
  const current = contextFilePath;
  hideProjectContextMenu();
  if (
    !current ||
    !window.confirm(`Delete ${current}? Import paths will not be rewritten.`)
  ) {
    return;
  }
  try {
    codeEditor.deleteFile(current);
  } catch (error) {
    showProjectIssue(error);
  }
}

function showProjectIssue(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  setRunState('error', 'Project write failed');
  errorBar.textContent = message;
  errorBar.hidden = false;
}

async function runModel(
  designContextId = selectedDesignContextId,
): Promise<void> {
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  window.clearTimeout(outlinePreviewTimer);
  viewport.restoreTransientPreview();
  hideViewportRenderStatus();
  const revision = ++runRevision;
  const sourceVersion = codeEditor.sourceVersion();
  compilingDesignContextId = designContextId;
  if (designContextId) {
    renderCurrentPanels();
  } else {
    setRunState('running', 'Compiling');
  }
  errorBar.hidden = true;

  try {
    const selectedKey = viewport.getSelected()?.key ?? 'root';
    const firstRun = currentModule === null;
    const nextModule = await compiler.compile(
      codeEditor.project(),
      designContextId,
    );
    if (
      revision !== runRevision ||
      sourceVersion !== codeEditor.sourceVersion()
    ) {
      return;
    }
    currentModule = nextModule;
    codeEditor.setModelDiagnostic();
    optimisticParameterValues.clear();
    codeEditor.setDesignArguments(nextModule.designArguments);
    codeEditor.trackSourceRefs(toolSourceRefs(nextModule));
    selectedDesignContextId = nextModule.activeDesignContextId;
    compilingDesignContextId = undefined;
    if (
      preferredEvaluationContextId === designContextId &&
      !nextModule.activeDesignContextId
    ) {
      preferredEvaluationContextId = undefined;
    }
    viewport.renderModule(currentModule, selectedKey, firstRun);
    explodeValue = 0;
    renderObjectCatalog(currentModule);
    const cursor = codeEditor.cursorSource();
    if (cursor) {
      const matched = viewport.selectBySourceOffset(
        cursor.file,
        cursor.offset,
        selectedKey,
        preferredEvaluationContextId,
      );
      if (!matched) {
        const designContext = designContextAt(
          currentModule,
          cursor.file,
          cursor.offset,
        );
        if (
          designContext &&
          currentModule.activeDesignContextId !== designContext.id
        ) {
          activateDesignContext(designContext.id);
          return;
        }
      }
    }
    preferredEvaluationContextId =
      viewport.sourceEvaluation()?.evaluation.contextId;
    const selected = viewport.getSelected();
    if (selected) {
      selectOccurrence(selected, false);
    } else {
      renderInspectorEmpty();
      renderContextControls(currentModule);
    }
    const objectCount = currentModule.fallback
      ? countObjects(currentModule.fallback)
      : currentModule.objects.size;
    setRunState(
      'ready',
      objectCount > 0
        ? formatObjectCount(objectCount)
        : `${currentModule.designArguments.length} design contexts`,
    );
  } catch (error) {
    if (revision !== runRevision) {
      return;
    }
    compilingDesignContextId = undefined;
    renderCurrentPanels();
    setRunState('error', 'Run failed');
    const diagnostic =
      error instanceof ModelDiagnosticError ? error.diagnostic : undefined;
    if (diagnostic?.sourceRef) {
      codeEditor.setModelDiagnostic(diagnostic);
      errorBar.hidden = true;
    } else {
      codeEditor.setModelDiagnostic();
      errorBar.textContent = diagnostic
        ? [diagnostic.summary, diagnostic.details].filter(Boolean).join('\n')
        : error instanceof Error
          ? error.message
          : String(error);
      errorBar.hidden = false;
    }
  }
}

function handleCompletionFocus(focus: CompletionFocus | undefined): void {
  const previous = activeCompletionFocus;
  activeCompletionFocus = focus;
  window.clearTimeout(completionPreviewTimer);
  completionPreviewTimer = undefined;
  viewport.restoreTransientPreview();
  hideViewportRenderStatus();

  if (!focus) {
    if (previous?.preview) resumeModelAfterCompletion();
    return;
  }

  if (currentModule) {
    const match = completionPreviewTarget(currentModule, focus);
    if (match) {
      viewport.previewCompletion(
        match.target,
        match.evaluationIndex,
        focus.memberName,
      );
    }
  }

  if (!focus.preview) {
    if (previous?.preview) resumeModelAfterCompletion();
    return;
  }

  runRevision += 1;
  compiler.cancel();
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  setRunState('pending', `Completing ${focus.memberName}`);
  showViewportRenderStatus(`Rendering ${focus.memberName}`);
  const revision = runRevision;
  completionPreviewTimer = window.setTimeout(() => {
    completionPreviewTimer = undefined;
    void runCompletionPreview(focus, revision);
  }, 160);
}

async function runCompletionPreview(
  focus: CompletionFocus,
  revision: number,
): Promise<void> {
  const preview = focus.preview;
  if (
    !preview ||
    activeCompletionFocus !== focus ||
    preview.sourceVersion !== codeEditor.sourceVersion()
  ) {
    return;
  }
  setRunState('running', `Previewing ${focus.memberName}`);
  try {
    const module = await compiler.compile(
      preview.project,
      selectedDesignContextId,
    );
    if (
      revision !== runRevision ||
      activeCompletionFocus !== focus ||
      preview.sourceVersion !== codeEditor.sourceVersion()
    ) {
      return;
    }
    viewport.previewCompletedProject(
      module,
      preview.cursor.file,
      preview.cursor.offset,
      preferredEvaluationContextId,
    );
    hideViewportRenderStatus();
    setRunState('ready', `Preview · ${focus.memberName}`);
  } catch {
    if (revision === runRevision && activeCompletionFocus === focus) {
      hideViewportRenderStatus();
      setRunState('pending', `Preview unavailable · ${focus.memberName}`);
    }
  }
}

function resumeModelAfterCompletion(): void {
  runRevision += 1;
  compiler.cancel();
  hideViewportRenderStatus();
  setRunState('pending', 'Waiting for update');
  scheduleModelRun(180);
}

function scheduleModelRun(delay: number): void {
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(() => {
    compileTimer = undefined;
    if (!activeCompletionFocus?.preview) void runModel();
  }, delay);
}

function renderContextControls(module: ModelModule): void {
  renderScopes(module);
  renderDesignArguments(module);
}

function renderScopes(module: ModelModule): void {
  scopeList.replaceChildren();
  if (module.fallback) {
    scopeList.append(
      scopeButton(
        'Overview',
        () => {
          cancelPendingDesignCompile();
          preferredEvaluationContextId = undefined;
          selectedDesignContextId = undefined;
          viewport.selectRoot();
          const selected = viewport.getSelected();
          if (selected) selectOccurrence(selected, false);
        },
        viewport.sourceEvaluation() === undefined,
      ),
    );
  }

  const sourceEvaluation = viewport.sourceEvaluation();
  if (sourceEvaluation?.target.kind === 'constraint') {
    const uses = sourceEvaluation.target.evaluations.flatMap(
      (evaluation, evaluationIndex) => {
        const operation = evaluation.operationId
          ? module.operations.get(evaluation.operationId)
          : undefined;
        return operation ? [{evaluationIndex, operation}] : [];
      },
    );
    if (uses.length > 1) {
      uses.forEach(({evaluationIndex, operation}, index) => {
        const location = operation.sourceRef
          ? ` · ${sourceLocation(operation.sourceRef)}`
          : '';
        scopeList.append(
          scopeButton(
            `Use ${index + 1} · ${operation.kind.toUpperCase()}${location}`,
            () => selectSourceEvaluation(evaluationIndex),
            sourceEvaluation.evaluationIndex === evaluationIndex,
          ),
        );
      });
    }
  }
  const functionId = inspectedFunctionId(module);
  if (!functionId) return;

  const contexts = new Map(
    module.evaluationContexts.map(context => [context.id, context]),
  );
  const callContextIds = sourceEvaluation
    ? [
        ...new Set(
          sourceEvaluation.target.evaluations
            .map(evaluation => evaluation.contextId)
            .filter(contextId => contexts.get(contextId)?.kind === 'call'),
        ),
      ]
    : [];
  callContextIds.forEach((contextId, index) => {
    const context = contexts.get(contextId)!;
    const location = sourceLocation(context.sourceRef);
    scopeList.append(
      scopeButton(
        callContextIds.length === 1
          ? `Call · ${location}`
          : `Call ${index + 1} · ${location}`,
        () => selectCompiledEvaluationContext(contextId, false),
        sourceEvaluation?.evaluation.contextId === contextId,
      ),
    );
  });
}

function selectSourceEvaluation(evaluationIndex: number): void {
  if (!viewport.selectSourceEvaluation(evaluationIndex)) return;
  const evaluation = viewport.sourceEvaluation()?.evaluation;
  preferredEvaluationContextId = evaluation?.contextId;
  const occurrence = viewport.getSelected();
  if (occurrence) selectOccurrence(occurrence, false);
}

function sourceLocation(sourceRef: SourceRef): string {
  const fileName = sourceRef.file.slice(sourceRef.file.lastIndexOf('/') + 1);
  return `${fileName}:${codeEditor.sourceLine(sourceRef)}`;
}

function selectCompiledEvaluationContext(
  contextId: string,
  design: boolean,
): boolean {
  if (!viewport.selectEvaluationContext(contextId)) return false;
  cancelPendingDesignCompile();
  preferredEvaluationContextId = contextId;
  selectedDesignContextId = design ? contextId : undefined;
  const occurrence = viewport.getSelected();
  if (occurrence) selectOccurrence(occurrence, false);
  return true;
}

function activateDesignContext(contextId: string): void {
  preferredEvaluationContextId = contextId;
  selectedDesignContextId = contextId;
  void runModel(contextId);
}

function cancelPendingDesignCompile(): void {
  if (!compilingDesignContextId) return;
  compilingDesignContextId = undefined;
  runRevision += 1;
}

function designContextAt(module: ModelModule, file: string, offset: number) {
  return module.designArguments
    .filter(
      context =>
        context.functionRef.file === file &&
        context.functionRef.start <= offset &&
        offset <= context.functionRef.end,
    )
    .sort(
      (left, right) =>
        left.functionRef.end -
        left.functionRef.start -
        (right.functionRef.end - right.functionRef.start),
    )[0];
}

function inspectedFunctionId(module: ModelModule): string | undefined {
  const sourceFunctionId = viewport.sourceEvaluation()?.target.functionId;
  if (sourceFunctionId) return sourceFunctionId;
  const cursor = codeEditor.cursorSource();
  return cursor
    ? designContextAt(module, cursor.file, cursor.offset)?.functionId
    : undefined;
}

function renderInspectorEmpty(): void {
  inspector.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'inspector-copy';
  empty.textContent = 'Select a model expression to inspect it.';
  inspector.append(empty);
}

function renderObjectCatalog(module: ModelModule): void {
  window.clearTimeout(outlinePreviewTimer);
  objectCatalogList.replaceChildren();
  const entries = module.catalog.filter(
    entry => entry.visibility === 'primary' && entry.nodeIds.length > 0,
  );
  const lineage = module.catalog.filter(
    entry => entry.visibility === 'lineage' && entry.nodeIds.length > 0,
  );
  objectCatalogCount.textContent = String(entries.length);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'object-catalog-empty';
    empty.textContent = 'No named objects';
    objectCatalogList.append(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const localLineage = lineage
      .filter(candidate =>
        containsSourceRef(entry.sourceRef, candidate.sourceRef),
      )
      .sort((left, right) => left.firstOrder - right.firstOrder);
    objectCatalogList.append(
      objectCatalogGroup(entry, String(index + 1).padStart(2, '0'), module, {
        variant: 'primary',
        lineage: localLineage,
      }),
    );
  });
}

function objectCatalogGroup(
  entry: ObjectCatalogEntry,
  orderLabel: string,
  module: ModelModule,
  options: Readonly<{
    variant: 'primary' | 'lineage';
    lineage?: readonly ObjectCatalogEntry[];
  }>,
): HTMLElement {
  const group = document.createElement('section');
  group.className = `object-catalog-group ${options.variant}`;

  const row = document.createElement('div');
  row.className = 'object-catalog-row';
  const details = document.createElement('div');
  details.className = 'object-catalog-details';

  const lineage = options.lineage ?? [];
  const expandable = lineage.length > 0;
  const expanded = expandable && expandedCatalogIds.has(entry.id);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'object-catalog-toggle';
  toggle.textContent = expandable ? '›' : '';
  toggle.disabled = !expandable;
  toggle.tabIndex = expandable ? 0 : -1;
  toggle.setAttribute('aria-label', `${entry.label} details`);
  toggle.setAttribute('aria-expanded', String(expanded));

  const button = objectCatalogEntryButton(
    entry,
    orderLabel,
    module,
    options.variant,
  );
  row.append(toggle, button);

  if (lineage.length > 0) {
    const label = document.createElement('div');
    label.className = 'object-catalog-section-label';
    label.textContent = 'LINEAGE';
    details.append(label);
    lineage.forEach(candidate => {
      details.append(
        objectCatalogGroup(candidate, `@${candidate.firstOrder}`, module, {
          variant: 'lineage',
        }),
      );
    });
  }

  details.hidden = !expanded;
  group.classList.toggle('expanded', expanded);
  toggle.addEventListener('click', () => {
    const nextExpanded = !expandedCatalogIds.has(entry.id);
    if (nextExpanded) {
      expandedCatalogIds.add(entry.id);
    } else {
      expandedCatalogIds.delete(entry.id);
    }
    group.classList.toggle('expanded', nextExpanded);
    details.hidden = !nextExpanded;
    toggle.setAttribute('aria-expanded', String(nextExpanded));
  });
  group.append(row, details);
  return group;
}

function objectCatalogEntryButton(
  entry: ObjectCatalogEntry,
  orderLabel: string,
  module: ModelModule,
  variant: 'primary' | 'lineage',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `object-catalog-entry ${variant}`;
  button.title = `${entry.label}: hover to preview, click to open source`;

  const order = document.createElement('span');
  order.className = 'object-catalog-order';
  order.textContent = orderLabel;

  const copy = document.createElement('span');
  copy.className = 'object-catalog-copy';
  const label = document.createElement('strong');
  label.textContent = entry.label;
  const meta = document.createElement('small');
  meta.textContent = catalogEntryMeta(entry, module);
  copy.append(label, meta);

  const count = document.createElement('span');
  count.className = 'object-catalog-instances';
  count.textContent =
    entry.occurrences.length > 1 ? `×${entry.occurrences.length}` : '';
  button.append(order, copy, count);
  button.addEventListener('pointerenter', () => {
    window.clearTimeout(outlinePreviewTimer);
    outlinePreviewTimer = window.setTimeout(() => {
      viewport.previewOutline(entry.nodeIds);
    }, 90);
  });
  button.addEventListener('pointerleave', () => {
    window.clearTimeout(outlinePreviewTimer);
    outlinePreviewTimer = window.setTimeout(() => {
      viewport.restoreTransientPreview();
    }, 50);
  });
  button.addEventListener('click', () => {
    codeEditor.revealSource(entry.sourceRef, true);
  });
  return button;
}

function catalogEntryMeta(
  entry: ObjectCatalogEntry,
  module: ModelModule,
): string {
  const kinds = new Set(
    entry.nodeIds.flatMap(nodeId => {
      const node = module.objects.get(nodeId);
      return node ? [node.kind] : [];
    }),
  );
  const parts = [kinds.size === 1 ? [...kinds][0].toUpperCase() : 'COLLECTION'];
  if (entry.executions > 1) {
    parts.push(`${entry.executions} RUNS`);
  }
  if (entry.exportNames.length > 0) {
    parts.push(`EXPORT ${entry.exportNames.join(', ')}`);
  }
  return parts.join(' · ');
}

function containsSourceRef(
  container: SourceRef,
  candidate: SourceRef,
): boolean {
  return (
    container.file === candidate.file &&
    container.start <= candidate.start &&
    candidate.end <= container.end
  );
}

function scopeButton(
  label: string,
  action: () => void,
  active = false,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'scope-button';
  button.classList.toggle('active', active);
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function selectOccurrence(occurrence: Occurrence, revealSource: boolean): void {
  renderInspector(occurrence);
  if (currentModule) renderContextControls(currentModule);

  if (revealSource) {
    const sourceRef = primarySource(occurrence.node);
    if (sourceRef) {
      codeEditor.revealSource(sourceRef);
    } else {
      codeEditor.clearSourceHighlight();
    }
  }
}

function renderInspector(occurrence: Occurrence): void {
  inspector.replaceChildren();

  const heading = document.createElement('div');
  heading.className = 'inspector-heading';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'inspector-eyebrow';
  eyebrow.textContent =
    occurrence.view === 'source'
      ? 'SOURCE NODE'
      : occurrence.depth === 0
        ? 'MODEL SCOPE'
        : 'LOCAL SCOPE';
  const title = document.createElement('strong');
  title.textContent = occurrence.node.name;
  heading.append(eyebrow, title);
  inspector.append(heading);

  if (occurrence.view === 'model' && occurrence.depth === 0) {
    renderModelInspector();
  } else {
    renderLocalInspector(occurrence);
  }
}

function renderDesignArguments(module: ModelModule): void {
  const functionId = inspectedFunctionId(module);
  const contexts = module.designArguments.filter(
    context => context.functionId === functionId,
  );
  designArgumentsCount.textContent = String(contexts.length);
  designArgumentsFunction.textContent =
    contexts[0]?.functionName ?? 'No function context';
  designArgumentsOptions.replaceChildren();
  if (contexts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'design-arguments-empty';
    empty.textContent = 'Select a function with @code3d.arguments.';
    designArgumentsOptions.append(empty);
    return;
  }

  const activeContextId =
    viewport.sourceEvaluation()?.evaluation.contextId ??
    selectedDesignContextId;
  contexts.forEach(context => {
    const active = context.id === activeContextId;
    const compiling = context.id === compilingDesignContextId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'design-argument-option';
    button.classList.toggle('active', active);
    button.classList.toggle('compiling', compiling);
    button.setAttribute('aria-pressed', String(active));
    button.title = designArgumentCall(context);
    if (compiling) button.setAttribute('aria-busy', 'true');

    const label = document.createElement('span');
    label.textContent = designArgumentCall(context);
    const state = document.createElement('span');
    state.className = 'design-argument-state';
    if (compiling) {
      const spinner = document.createElement('span');
      spinner.className = 'design-argument-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      state.append(spinner, 'COMPILING');
    } else {
      state.textContent = active ? 'ACTIVE' : 'VIEW';
    }
    button.append(label, state);
    button.addEventListener('click', () => {
      if (compilingDesignContextId === context.id) return;
      if (!selectCompiledEvaluationContext(context.id, true)) {
        activateDesignContext(context.id);
      }
    });
    designArgumentsOptions.append(button);
  });
}

function designArgumentCall(context: DesignArgumentContext): string {
  return `${context.functionName}(${context.label})`;
}

function renderCurrentPanels(): void {
  const occurrence = viewport.getSelected();
  if (occurrence) {
    renderInspector(occurrence);
  } else {
    renderInspectorEmpty();
  }
  if (currentModule) renderContextControls(currentModule);
}

function renderModelInspector(): void {
  const copy = document.createElement('p');
  copy.className = 'inspector-copy';
  copy.textContent =
    'Model scope changes only the current view; it does not modify source.';

  const control = rangeControl(
    'Exploded view',
    explodeValue,
    -0,
    32,
    1,
    value => {
      explodeValue = value;
      viewport.setExplode(value);
    },
  );

  const fitButton = actionButton('Fit model', () => viewport.fit());
  inspector.append(copy, control, fitButton);
}

function renderLocalInspector(occurrence: Occurrence): void {
  const kind = document.createElement('div');
  kind.className = 'object-kind';
  kind.textContent = occurrence.node.kind.toUpperCase();
  inspector.append(kind);

  const hasRelativePositionContext = viewport.hasRelativePositionContext();
  const sourceConstraintParameters = viewport.sourceConstraintParameters();
  const parameters = uniqueParameters(
    sourceConstraintParameters
      ? parametersForConstraint(occurrence.node, sourceConstraintParameters)
      : occurrence.node.parameters.filter(
          parameter =>
            parameter.operation !== 'offset' || hasRelativePositionContext,
        ),
  );
  if (parameters.length > 0) {
    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'parameter-section-label';
    sectionLabel.textContent = 'SOURCE PARAMETERS';
    inspector.append(sectionLabel);
    parameters.forEach(parameter => {
      const impact =
        currentModule?.parameterImpacts.get(parameter.target.id) ?? 1;
      inspector.append(parameterControl(parameter, impact));
    });
  } else {
    const empty = document.createElement('p');
    empty.className = 'inspector-copy';
    empty.textContent =
      'This object has no numeric parameters that can be safely written back.';
    inspector.append(empty);
  }

  const actions = document.createElement('div');
  actions.className = 'inspector-actions';
  actions.append(actionButton('Focus', () => viewport.focusSelection()));
  inspector.append(actions);

  const note = document.createElement('p');
  note.className = 'inspector-note';
  note.textContent =
    'Dragging uses a temporary preview. Committing updates the source and reruns it. Units are UI hints only.';
  inspector.append(note);
}

function parametersForConstraint(
  node: ModelSnapshotObject,
  selected: readonly ParameterUsage[],
): ParameterUsage[] {
  const constraintParameters = new Set(
    node.constraints.flatMap(constraint =>
      constraint.parameters.map(parameterUsageKey),
    ),
  );
  const selectedParameters = new Set(selected.map(parameterUsageKey));
  return node.parameters.filter(parameter => {
    const key = parameterUsageKey(parameter);
    return !constraintParameters.has(key) || selectedParameters.has(key);
  });
}

function parameterUsageKey(parameter: ParameterUsage): string {
  const operation = parameter.operationRef;
  const expression = parameter.expressionRef;
  return [
    parameter.operation,
    parameter.argument,
    operation.file,
    operation.start,
    operation.end,
    expression.file,
    expression.start,
    expression.end,
    parameter.target.id,
  ].join(':');
}

function interruptCompileForTool(): boolean {
  const scheduled = compileTimer !== undefined;
  const compiling = compiler.isCompiling();
  if (!scheduled && !compiling) return false;
  runRevision += 1;
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  compiler.cancel();
  return true;
}

function resumeCompileAfterTool(interrupted: boolean): void {
  if (interrupted) void runModel();
}

function parameterControl(
  parameter: ParameterUsage,
  impact: number,
): HTMLElement {
  const {target} = parameter;
  const rangeBounds = parameterRange(target);
  let toolSession: ToolSession | undefined;
  let interruptedCompile = false;
  const beginToolSession = (): ToolSession => {
    if (!toolSession) {
      interruptedCompile = interruptCompileForTool();
      toolSession = toolEngine.begin(`inspector.parameter:${target.id}`);
    }
    return toolSession;
  };
  const wrapper = document.createElement('section');
  wrapper.className = 'parameter-control';
  wrapper.dataset.targetId = target.id;

  const row = document.createElement('div');
  row.className = 'parameter-control-row';
  const name = document.createElement('span');
  name.className = 'parameter-name';
  name.textContent = target.label;

  const valueGroup = document.createElement('span');
  valueGroup.className = 'parameter-value';
  const numberInput = document.createElement('input');
  numberInput.className = 'parameter-number';
  numberInput.type = 'number';
  if (target.min !== undefined && Number.isFinite(target.min)) {
    numberInput.min = String(target.min);
  }
  if (target.max !== undefined && Number.isFinite(target.max)) {
    numberInput.max = String(target.max);
  }
  numberInput.step =
    target.step !== undefined && Number.isFinite(target.step) && target.step > 0
      ? String(target.step)
      : 'any';
  numberInput.value = String(currentParameterValue(target));
  numberInput.setAttribute('aria-label', target.label);
  valueGroup.append(numberInput);
  if (target.unit) {
    const unit = document.createElement('span');
    unit.textContent = target.unit;
    valueGroup.append(unit);
  }
  row.append(name, valueGroup);

  const range = rangeBounds
    ? Object.assign(document.createElement('input'), {
        type: 'range',
        min: String(rangeBounds.min),
        max: String(rangeBounds.max),
        step: String(rangeBounds.step),
        value: String(currentParameterValue(target)),
      })
    : undefined;

  const details = document.createElement('p');
  details.className = 'parameter-details';
  const context = `${parameter.operation}.${parameter.argument}`;
  details.textContent = target.description
    ? `${target.description} · ${context}`
    : context;
  if (impact > 1) {
    const impactLabel = document.createElement('span');
    impactLabel.className = 'parameter-impact';
    impactLabel.textContent = `Affects ${formatObjectCount(impact)}`;
    details.append(' · ', impactLabel);
  }

  const preview = (value: number): void => {
    if (!Number.isFinite(value)) return;
    if (range) range.value = String(value);
    numberInput.value = String(value);
    const resolution = beginToolSession().preview(
      parameterIntent(target, value),
    );
    if (resolution.status !== 'ready') {
      showToolIssue(resolution.reason);
    }
  };
  const commit = (value: number): void => {
    if (!Number.isFinite(value)) return;
    const session = beginToolSession();
    if (value === currentParameterValue(target)) {
      session.cancel();
      resumeCompileAfterTool(interruptedCompile);
      toolSession = undefined;
      interruptedCompile = false;
      return;
    }
    const committed = commitToolSession(
      session,
      parameterIntent(target, value),
    );
    if (!committed) {
      resumeCompileAfterTool(interruptedCompile);
    }
    toolSession = undefined;
    interruptedCompile = false;
  };

  range?.addEventListener('input', () => {
    preview(Number(range.value));
  });
  range?.addEventListener('change', () => {
    commit(Number(range.value));
  });
  numberInput.addEventListener('input', () => {
    preview(Number(numberInput.value));
  });
  numberInput.addEventListener('change', () => {
    commit(Number(numberInput.value));
  });

  wrapper.append(row);
  if (range) wrapper.append(range);
  wrapper.append(details);
  return wrapper;
}

function parameterIntent(target: ParameterTarget, value: number): ToolIntent {
  return {kind: 'parameter.set', target, value};
}

function currentParameterValue(target: ParameterTarget): number {
  return optimisticParameterValues.get(target.id) ?? target.value;
}

function handlePositionTool(event: PositionGizmoEvent): void {
  if (event.kind === 'begin') {
    positionToolSession?.cancel();
    positionToolInterruptedCompile = interruptCompileForTool();
    positionToolSession = toolEngine.begin(
      `viewport.translate:${event.binding.axis}:${positionBindingId(event.binding)}`,
    );
    errorBar.hidden = true;
    showPositionToolStatus(event.binding, event.binding.value);
    return;
  }

  if (event.kind === 'cancel') {
    positionToolSession?.cancel();
    positionToolSession = undefined;
    resumeCompileAfterTool(positionToolInterruptedCompile);
    positionToolInterruptedCompile = false;
    if (event.binding.kind === 'parameter') {
      updateParameterControl(event.binding.target.id, event.binding.value);
    }
    hidePositionToolStatus();
    return;
  }

  const session = positionToolSession;
  if (!session) {
    showToolIssue('The position tool session expired. Start the drag again.');
    return;
  }
  if (event.binding.kind === 'parameter') {
    updateParameterControl(event.binding.target.id, event.value);
  }
  showPositionToolStatus(event.binding, event.value);

  if (event.kind === 'preview') {
    const resolution = session.preview(
      positionIntent(event.binding, event.value),
    );
    if (resolution.status !== 'ready') {
      showToolIssue(resolution.reason);
    }
    return;
  }

  if (Math.abs(event.value - event.binding.value) < 1e-9) {
    session.cancel();
    resumeCompileAfterTool(positionToolInterruptedCompile);
  } else {
    const committed = commitToolSession(
      session,
      positionIntent(event.binding, event.value),
    );
    if (!committed) resumeCompileAfterTool(positionToolInterruptedCompile);
  }
  positionToolSession = undefined;
  positionToolInterruptedCompile = false;
  hidePositionToolStatus();
}

function positionIntent(
  binding: PositionGizmoBinding,
  value: number,
): ToolIntent {
  if (binding.kind === 'parameter') {
    return parameterIntent(binding.target, value);
  }
  const delta: [number, number, number] = [0, 0, 0];
  delta[positionAxisIndex(binding.axis)] = value;
  return {
    kind: 'relation.offset',
    receiver: binding.receiver,
    occurrenceKeys: binding.occurrenceKeys,
    delta,
    frameQuaternion: binding.frame.quaternion,
  };
}

function positionAxisIndex(axis: PositionGizmoBinding['axis']): 0 | 1 | 2 {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  return 2;
}

function positionBindingId(binding: PositionGizmoBinding): string {
  if (binding.kind === 'parameter') {
    return binding.target.id;
  }
  const {start, end} = binding.receiver.sourceRef;
  return `expression:${binding.receiver.sourceRef.file}:${start}:${end}`;
}

function showPositionToolStatus(
  binding: PositionGizmoBinding,
  value: number,
): void {
  const impact =
    binding.kind === 'parameter'
      ? (currentModule?.parameterImpacts.get(binding.target.id) ?? 1)
      : binding.occurrenceKeys.length;
  const unit = binding.unit ? ` ${binding.unit}` : '';
  const effect = impact > 1 ? ` · Affects ${formatObjectCount(impact)}` : '';
  toolStatus.textContent = `${binding.axis.toUpperCase()} · ${binding.label} ${formatDisplayNumber(value)}${unit}${effect} · Esc to cancel`;
  toolStatus.hidden = false;
}

function hidePositionToolStatus(): void {
  toolStatus.hidden = true;
}

function updateParameterControl(targetId: string, value: number): void {
  const control = [
    ...inspector.querySelectorAll<HTMLElement>('.parameter-control'),
  ].find(candidate => candidate.dataset.targetId === targetId);
  if (!control) return;
  const numberInput =
    control.querySelector<HTMLInputElement>('.parameter-number');
  const rangeInput = control.querySelector<HTMLInputElement>(
    'input[type="range"]',
  );
  if (numberInput) numberInput.value = String(value);
  if (rangeInput) rangeInput.value = String(value);
}

function formatDisplayNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

function applyToolPreview(preview: ToolPreview): void {
  if (preview.kind === 'parameter') {
    viewport.setParameterPreview(preview.targetId, preview.value);
    viewport.hideSourceDecorationsDuringPreview();
  } else if (preview.kind === 'occurrence-translation') {
    viewport.setOccurrenceTranslationPreview(
      preview.occurrenceKeys,
      preview.delta,
    );
    viewport.hideSourceDecorationsDuringPreview();
  } else if (preview.kind === 'viewport-decorations') {
    viewport.setDecorations(preview.owner, preview.decorations);
  }
}

function commitToolPreview(preview: ToolPreview): void {
  if (preview.kind === 'parameter') {
    optimisticParameterValues.set(preview.targetId, preview.value);
    viewport.commitParameterPreview(preview.targetId, preview.value);
  } else if (preview.kind === 'occurrence-translation') {
    viewport.commitOccurrenceTranslationPreview(preview.occurrenceKeys);
  }
}

function clearToolPreview(
  preview: ToolPreview,
  reason: 'replace' | 'end',
): void {
  if (preview.kind === 'parameter') {
    viewport.clearParameterPreview(preview.targetId);
  } else if (preview.kind === 'occurrence-translation') {
    viewport.clearOccurrenceTranslationPreview(preview.occurrenceKeys);
  } else if (preview.kind === 'viewport-decorations') {
    viewport.clearDecorations(preview.owner);
  }
  if (reason === 'end') {
    viewport.restoreSourceDecorations();
  }
}

function commitToolSession(session: ToolSession, intent: ToolIntent): boolean {
  const result = session.commit(intent);
  if (result.status !== 'committed') {
    showToolIssue(result.reason);
    return false;
  }
  sourceEditPopover.show(
    result.plan.summary,
    codeEditor.sourceEditExcerpts(result.plan.edits),
  );
  return true;
}

function toolSourceRefs(module: ModelModule): SourceRef[] {
  const refs = [
    ...module.sourceTargets.flatMap(target => [
      target.sourceRef,
      ...(target.receiverRef ? [target.receiverRef] : []),
    ]),
    ...[...module.operations.values()].flatMap(operation =>
      operation.sourceRef ? [operation.sourceRef] : [],
    ),
    ...[...module.objects.values()].flatMap(node => [
      ...node.sourceRefs,
      ...node.parameters.map(parameter => parameter.target.sourceRef),
      ...node.constraints.flatMap(constraint => [
        ...constraint.sourceRefs,
        ...constraint.parameters.map(parameter => parameter.target.sourceRef),
      ]),
    ]),
  ];
  return [
    ...new Map(
      refs.map(sourceRef => [
        `${sourceRef.file}:${sourceRef.start}:${sourceRef.end}`,
        sourceRef,
      ]),
    ).values(),
  ];
}

function completionPreviewTarget(
  module: ModelModule,
  focus: CompletionFocus,
):
  | Readonly<{
      target: ModelModule['sourceTargets'][number];
      evaluationIndex: number;
    }>
  | undefined {
  const receiverTarget = module.sourceTargets.find(target => {
    if (!focus.receiverRef || target.kind !== 'element' || !target.receiverRef)
      return false;
    const current = codeEditor.resolveSourceRef(target.receiverRef);
    return current ? sameSourceRef(current, focus.receiverRef) : false;
  });
  const definitionTarget = focus.definitionRef
    ? module.sourceTargets
        .filter(target => {
          const current = codeEditor.resolveSourceRef(target.sourceRef);
          return current
            ? containsSourceRef(current, focus.definitionRef!)
            : false;
        })
        .sort(
          (left, right) =>
            sourceRefSpan(left.sourceRef) - sourceRefSpan(right.sourceRef),
        )[0]
    : undefined;
  const target = receiverTarget ?? definitionTarget;
  if (!target) return undefined;
  const matchingContext = preferredEvaluationContextId
    ? target.evaluations.findIndex(
        evaluation => evaluation.contextId === preferredEvaluationContextId,
      )
    : -1;
  return {
    target,
    evaluationIndex: matchingContext >= 0 ? matchingContext : 0,
  };
}

function sameSourceRef(left: SourceRef, right: SourceRef): boolean {
  return (
    left.file === right.file &&
    left.start === right.start &&
    left.end === right.end
  );
}

function sourceRefSpan(sourceRef: SourceRef): number {
  return sourceRef.end - sourceRef.start;
}

function showToolIssue(message: string): void {
  setRunState('pending', 'Tool needs an update');
  errorBar.textContent = message;
  errorBar.hidden = false;
}

function uniqueParameters(
  parameters: readonly ParameterUsage[],
): ParameterUsage[] {
  const unique = new Map<string, ParameterUsage>();
  for (const parameter of parameters) {
    if (!unique.has(parameter.target.id)) {
      unique.set(parameter.target.id, parameter);
    }
  }
  return [...unique.values()];
}

function rangeControl(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'range-control';
  const row = document.createElement('span');
  const name = document.createElement('span');
  name.textContent = label;
  const output = document.createElement('output');
  output.textContent = String(value);
  row.append(name, output);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = String(next);
    onInput(next);
  });
  wrapper.append(row, input);
  return wrapper;
}

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function setRunState(
  state: 'idle' | 'pending' | 'running' | 'ready' | 'error',
  label: string,
): void {
  runState.dataset.state = state;
  runStateLabel.textContent = label;
}

function sourceHistoryAction(
  event: KeyboardEvent,
): 'undo' | 'redo' | undefined {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return undefined;
  if (event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
  if (event.code === 'KeyY' && !event.shiftKey) return 'redo';
  return undefined;
}

function showViewportRenderStatus(label: string): void {
  viewportRenderStatusLabel.textContent = label;
  viewportRenderStatus.hidden = false;
}

function hideViewportRenderStatus(): void {
  viewportRenderStatus.hidden = true;
}

function primarySource(node: ModelSnapshotObject): SourceRef | undefined {
  return node.sourceRefs.at(-1);
}

function countObjects(root: ModelSnapshotObject): number {
  return 1 + root.children.reduce((sum, child) => sum + countObjects(child), 0);
}

function formatObjectCount(count: number): string {
  return `${count} ${count === 1 ? 'object' : 'objects'}`;
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element.`);
  }
  return element as T;
}
