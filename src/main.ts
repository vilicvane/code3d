import './style.css';
import {
  CodeEditor,
  type ActiveFileChangeReason,
  type CompletionFocus,
  type ProjectEditorChange,
} from './editor';
import {ModelCompilerClient} from './model/compiler-client';
import type {DesignArgumentContext, ModelModule} from './model/compiler';
import {ModelDiagnosticError} from './model/diagnostic';
import {bundledExamples} from './project/bundled-examples';
import {defaultProject} from './project/default-project';
import {
  pickProjectDirectory,
  projectDirectoryPermission,
  requestProjectDirectoryPermission,
  storedProjectDirectory,
  storeProjectDirectory,
  supportsProjectDirectories,
} from './project/directory-access';
import {
  openBrowserProjectFileSystem,
  openDirectoryProjectFileSystem,
  type ProjectFileSystem,
} from './project/filesystem';
import {filePathFromRoute, fileRoute} from './project/file-route';
import type {ModelProject} from './project/project';
import type {
  EdgeId,
  ModelSnapshotObject,
  ParameterTarget,
  SourceRef,
} from './model/runtime';
import {
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
} from './model/operation-decorations';
import {
  elementSourceDecoration,
  namedElementDecorations,
} from './model/element-decorations';
import type {
  PositionGizmoBinding,
  PositionGizmoEvent,
} from './tools/position-gizmo';
import {
  ToolEngine,
  type ToolIntent,
  type ToolPreview,
  type ToolSession,
} from './tools/tool-system';
import {
  ModelViewport,
  type EdgeSelectionEvent,
  type Occurrence,
} from './viewport';
import {DockPanelCoordinator} from './ui/dock-panels';
import {ElementsPanel} from './ui/elements-panel';
import {ProjectTree} from './ui/project-tree';
import {SourceEditPopover} from './ui/source-edit-popover';

const directoryWorkspaceId = new URL(window.location.href).searchParams.get(
  'workspace',
);
const storedDirectoryHandle = directoryWorkspaceId
  ? await storedProjectDirectory(directoryWorkspaceId)
  : undefined;
const directoryConnected =
  storedDirectoryHandle !== undefined &&
  (await projectDirectoryPermission(storedDirectoryHandle)) === 'granted';
const projectFileSystem = directoryConnected
  ? await openDirectoryProjectFileSystem(storedDirectoryHandle)
  : await openBrowserProjectFileSystem();
await projectFileSystem.initialize(defaultProject);
const initialProject = await projectFileSystem.syncDirectory(bundledExamples);
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
      <div class="topbar-actions">
        <span class="project-location" id="project-location"></span>
        <button class="quiet-button" id="open-folder-button" type="button">Open folder</button>
        <button class="quiet-button" id="reconnect-folder-button" type="button" hidden>Reconnect folder</button>
        <button class="quiet-button" id="reload-folder-button" type="button" hidden>Reload folder</button>
        <button class="quiet-button" id="browser-storage-button" type="button" hidden>Use browser storage</button>
        <button class="quiet-button" id="reset-button" type="button">Reset examples</button>
      </div>
    </header>

    <main class="workspace">
      <section class="pane editor-pane">
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
        <div class="viewport-host" id="viewport-host">
          <div class="viewport-hint">Drag to orbit · Scroll to zoom · Click to select · Double-click active to open source</div>
          <div class="tool-status" id="tool-status" hidden></div>
          <section class="edge-selection-toolbar" id="edge-selection-toolbar" aria-label="Edge selection" hidden>
            <header class="edge-selection-header">
              <strong id="edge-selection-title"></strong>
              <span id="edge-selection-available"></span>
            </header>
            <div class="edge-selection-field">
              <span>SELECTED EDGES</span>
              <output id="edge-selection-summary"></output>
            </div>
            <div class="edge-selection-actions">
              <button id="edge-selection-clear" type="button">Clear</button>
              <button id="edge-selection-cancel" type="button">Cancel</button>
              <button class="primary" id="edge-selection-apply" type="button">Apply</button>
            </div>
          </section>
          <div class="viewport-progress" id="viewport-progress" role="status" aria-live="polite" hidden>
            <span class="viewport-progress-spinner" aria-hidden="true"></span>
            <span id="viewport-progress-label"></span>
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
            <aside class="dock-panel elements-panel" id="elements-panel" aria-label="Model elements">
              <button class="dock-panel-handle" id="elements-handle" type="button">
                <span>ELEMENTS</span>
                <span class="dock-panel-handle-meta">
                  <span id="elements-count">0</span>
                  <kbd data-dock-shortcut></kbd>
                </span>
              </button>
              <div class="dock-panel-body elements" id="elements" hidden></div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  </div>
`;

const editorHost = requiredElement('editor-host');
const viewportHost = requiredElement('viewport-host');
const errorBar = requiredElement('error-bar');
const designArgumentsCount = requiredElement('design-arguments-count');
const designArgumentsFunction = requiredElement('design-arguments-function');
const designArgumentsOptions = requiredElement('design-arguments-options');
const elements = requiredElement('elements');
const elementsCount = requiredElement('elements-count');
const toolStatus = requiredElement('tool-status');
const edgeSelectionToolbar = requiredElement('edge-selection-toolbar');
const edgeSelectionTitle = requiredElement('edge-selection-title');
const edgeSelectionAvailable = requiredElement('edge-selection-available');
const edgeSelectionSummary = requiredElement('edge-selection-summary');
const edgeSelectionClear = requiredElement<HTMLButtonElement>(
  'edge-selection-clear',
);
const edgeSelectionCancel = requiredElement<HTMLButtonElement>(
  'edge-selection-cancel',
);
const edgeSelectionApply = requiredElement<HTMLButtonElement>(
  'edge-selection-apply',
);
const viewportProgress = requiredElement('viewport-progress');
const viewportProgressLabel = requiredElement('viewport-progress-label');
const projectTree = requiredElement('project-tree');
const editorTabs = requiredElement('editor-tabs');
const projectLocation = requiredElement('project-location');
const openFolderButton =
  requiredElement<HTMLButtonElement>('open-folder-button');
const reconnectFolderButton = requiredElement<HTMLButtonElement>(
  'reconnect-folder-button',
);
const reloadFolderButton = requiredElement<HTMLButtonElement>(
  'reload-folder-button',
);
const browserStorageButton = requiredElement<HTMLButtonElement>(
  'browser-storage-button',
);
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
  root: requiredElement('design-arguments-panel'),
  handle: requiredElement<HTMLButtonElement>('design-arguments-handle'),
  body: requiredElement('design-arguments'),
  shortcut: {code: 'Digit1', label: 'Alt 1', altKey: true},
});
dockPanels.register({
  root: requiredElement('elements-panel'),
  handle: requiredElement<HTMLButtonElement>('elements-handle'),
  body: elements,
  shortcut: {code: 'Digit2', label: 'Alt 2', altKey: true},
});

const codeEditor = new CodeEditor(
  editorHost,
  initialProject,
  initialFilePath(initialProject, window.location.hash),
);
const projectDirectory = new ProjectTree(projectTree, {
  onOpenFile: path => codeEditor.switchFile(path, true),
  onFileContextMenu: (path, event) =>
    showProjectContextMenu(path, event.clientX, event.clientY),
});
replaceFileRoute(codeEditor.currentFile());
const compiler = new ModelCompilerClient();
let persistenceQueue = Promise.resolve();
let currentModule: ModelModule | null = null;
let currentModuleSourceVersion: number | undefined;
let compileTimer: number | undefined;
let completionPreviewTimer: number | undefined;
let runRevision = 0;
let positionToolSession: ToolSession | undefined;
let positionToolInterruptedCompile = false;
let edgeSelectionTool: EdgeSelectionTool | undefined;
let contextFilePath: string | undefined;
let preferredEvaluationContextId: string | undefined;
let selectedDesignContextId: string | undefined;
let compilingDesignContextId: string | undefined;
let activeCompletionFocus: CompletionFocus | undefined;
let applyingFileRoute = false;
type EdgeSelectionTool = {
  targetId: string;
  evaluationIndex: number;
  contextId: string;
  operation: 'fillet' | 'chamfer';
  sourceRef: SourceRef;
  occurrenceKey: string;
  availableEdgeIds: readonly EdgeId[];
  initialEdgeIds: readonly EdgeId[];
  selectedEdgeIds: readonly EdgeId[];
  session: ToolSession;
  interruptedCompile: boolean;
  previewRevision: number;
  previewTimer?: number;
  previewCompiling: boolean;
};

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
  onDrillDown: node => drillToObjectSource(node),
  onNavigateSource: sourceRef => {
    codeEditor.revealSource(sourceRef);
  },
  onPositionTool: handlePositionTool,
  onEdgeSelection: handleEdgeSelection,
  sourceDecorationProviders: [
    booleanOperationSourceDecoration,
    edgeModificationSourceDecoration,
    elementSourceDecoration,
  ],
});
const elementsDecorationOwner = 'elements-panel';
const elementsPanel = new ElementsPanel(elements, elementsCount, {
  onPreview: element => {
    viewport.clearDecorations(elementsDecorationOwner);
    const occurrence = viewport.getSelected();
    const sourceElement = viewport.sourceEvaluation()?.evaluation.element;
    const previewsSourceElement =
      element !== undefined &&
      occurrence !== undefined &&
      sourceElement?.nodeId === occurrence.node.nodeId &&
      sourceElement.name === element.name &&
      sourceElement.kind === element.kind;
    viewport.setSourceDecorationVisible(
      elementSourceDecoration.id,
      element === undefined || previewsSourceElement,
    );
    if (!element || !occurrence || previewsSourceElement) return;
    viewport.setDecorations(
      elementsDecorationOwner,
      namedElementDecorations(occurrence.node, element),
      {occurrenceKeys: [occurrence.key]},
    );
  },
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
  cancelEdgeSelectionTool();
  persistProjectChange(projectFileSystem, change);
  sourceEditPopover.dismiss();
  if (change.kind !== 'content') renderProjectNavigation();
  requestModelUpdate(420);
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
    renderDesignArguments(currentModule);
  }
  syncEdgeSelectionTool();
});
codeEditor.onCompletionFocus(handleCompletionFocus);
codeEditor.onActiveFile((path, reason) => {
  renderProjectNavigation();
  if (!applyingFileRoute) updateFileRoute(path, reason);
  preferredEvaluationContextId = undefined;
  selectedDesignContextId = undefined;
  requestModelUpdate(0);
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
openFolderButton.addEventListener('click', () => {
  void openProjectDirectory();
});
reconnectFolderButton.addEventListener('click', () => {
  void reconnectProjectDirectory();
});
reloadFolderButton.addEventListener('click', () => {
  void reloadProjectDirectory();
});
browserStorageButton.addEventListener('click', () => {
  void useBrowserStorage();
});
contextRenameFile.addEventListener('click', () => renameContextFile());
contextDeleteFile.addEventListener('click', () => deleteContextFile());
edgeSelectionClear.addEventListener('click', clearSelectedEdges);
edgeSelectionCancel.addEventListener('click', () => cancelEdgeSelectionTool());
edgeSelectionApply.addEventListener('click', commitEdgeSelectionTool);
window.addEventListener('pointerdown', event => {
  if (!projectContextMenu.contains(event.target as Node)) {
    hideProjectContextMenu();
  }
});

resetButton.addEventListener('click', () => {
  if (
    !window.confirm(
      'Reset bundled examples? Files under /examples will be replaced. Other project files will not change.',
    )
  ) {
    return;
  }
  void resetExamples();
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
  if (event.key === 'Escape' && cancelEdgeSelectionTool()) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Enter' && edgeSelectionTool && !codeEditor.ownsFocus()) {
    commitEdgeSelectionTool();
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

renderProjectLocation();
renderProjectNavigation();
runModel();

function renderProjectLocation(): void {
  if (directoryConnected) {
    projectLocation.textContent = `Local · ${storedDirectoryHandle.name}`;
    projectLocation.dataset.kind = 'local';
    projectLocation.title = `Files are stored directly in ${storedDirectoryHandle.name}`;
    openFolderButton.textContent = 'Change folder';
    reconnectFolderButton.hidden = true;
    reloadFolderButton.hidden = false;
    browserStorageButton.hidden = false;
    return;
  }

  projectLocation.textContent = 'Browser storage';
  projectLocation.dataset.kind = 'browser';
  projectLocation.title = 'Files are stored in this browser';
  openFolderButton.textContent = 'Open folder';
  openFolderButton.disabled = !supportsProjectDirectories();
  reconnectFolderButton.hidden = storedDirectoryHandle === undefined;
  reconnectFolderButton.textContent = storedDirectoryHandle
    ? `Reconnect ${storedDirectoryHandle.name}`
    : 'Reconnect folder';
  reloadFolderButton.hidden = true;
  browserStorageButton.hidden = true;
}

async function openProjectDirectory(): Promise<void> {
  setProjectLocationBusy(true);
  try {
    await persistenceQueue;
    const handle = await pickProjectDirectory();
    if (!handle) return;
    const target = await openDirectoryProjectFileSystem(handle);
    await target.initialize(codeEditor.project());
    await target.syncDirectory(bundledExamples);
    const workspaceId = crypto.randomUUID();
    await storeProjectDirectory(workspaceId, handle);
    openDirectoryWorkspace(workspaceId);
  } catch (error) {
    showProjectIssue(error);
  } finally {
    setProjectLocationBusy(false);
  }
}

async function reconnectProjectDirectory(): Promise<void> {
  if (!storedDirectoryHandle) return;
  setProjectLocationBusy(true);
  try {
    if (
      (await requestProjectDirectoryPermission(storedDirectoryHandle)) !==
      'granted'
    ) {
      throw new Error('Write access to the project folder was not granted.');
    }
    window.location.reload();
  } catch (error) {
    showProjectIssue(error);
  } finally {
    setProjectLocationBusy(false);
  }
}

async function reloadProjectDirectory(): Promise<void> {
  setProjectLocationBusy(true);
  await persistenceQueue;
  window.location.reload();
}

async function useBrowserStorage(): Promise<void> {
  setProjectLocationBusy(true);
  try {
    await persistenceQueue;
    openBrowserWorkspace();
  } catch (error) {
    showProjectIssue(error);
    setProjectLocationBusy(false);
  }
}

function openDirectoryWorkspace(workspaceId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('workspace', workspaceId);
  window.location.replace(url);
}

function openBrowserWorkspace(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('workspace');
  window.location.replace(url);
}

function setProjectLocationBusy(busy: boolean): void {
  openFolderButton.disabled = busy || !supportsProjectDirectories();
  reconnectFolderButton.disabled = busy;
  reloadFolderButton.disabled = busy;
  browserStorageButton.disabled = busy;
}

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

async function resetExamples(): Promise<void> {
  try {
    await persistenceQueue;
    const project = await projectFileSystem.resetDirectory(bundledExamples);
    codeEditor.replaceDirectory(project, bundledExamples.directory);
  } catch (error) {
    showProjectIssue(error);
  }
}

function initialFilePath(project: ModelProject, hash: string): string {
  const routed = filePathFromRoute(hash);
  if (routed && project.files.some(file => file.path === routed)) return routed;
  const paths = project.files.map(file => file.path);
  return (
    ['/model.ts', '/index.ts'].find(path => paths.includes(path)) ??
    paths.find(path => !path.endsWith('.d.ts')) ??
    paths[0]!
  );
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
  projectDirectory.update(codeEditor.filePaths(), active);
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
  contextDeleteFile.disabled = codeEditor.filePaths().length === 1;
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
  hideViewportProgress();
  errorBar.textContent = message;
  errorBar.hidden = false;
}

async function runModel(
  designContextId = selectedDesignContextId,
): Promise<void> {
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  viewport.restoreTransientPreview();
  const revision = ++runRevision;
  const sourceVersion = codeEditor.sourceVersion();
  compilingDesignContextId = designContextId;
  showViewportProgress('Compiling model');
  if (designContextId) {
    renderCurrentPanels();
  }
  errorBar.hidden = true;

  try {
    const selectedKey = viewport.getSelected()?.key ?? 'root';
    const firstRun = currentModule === null;
    const nextModule = await compiler.compile(
      codeEditor.project(),
      codeEditor.currentFile(),
      designContextId,
    );
    if (
      revision !== runRevision ||
      sourceVersion !== codeEditor.sourceVersion()
    ) {
      return;
    }
    currentModule = nextModule;
    currentModuleSourceVersion = sourceVersion;
    codeEditor.setModelDiagnostic();
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
      renderElementsPanel();
      renderDesignArguments(currentModule);
    }
    syncEdgeSelectionTool();
    hideViewportProgress();
  } catch (error) {
    if (revision !== runRevision) {
      return;
    }
    compilingDesignContextId = undefined;
    renderCurrentPanels();
    hideViewportProgress();
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
  renderElementsPanel(viewport.getSelected());

  if (!focus) {
    if (previous?.preview) resumeModelAfterCompletion();
    return;
  }

  if (currentModule) {
    const match = completionPreviewTarget(currentModule, focus);
    if (match) {
      if (
        viewport.previewCompletion(
          match.target,
          match.evaluationIndex,
          focus.memberName,
        )
      ) {
        renderElementsPanel(viewport.getSelected());
      }
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
  showViewportProgress(`Rendering preview · ${focus.memberName}`);
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
  try {
    const module = await compiler.compile(
      preview.project,
      preview.cursor.file,
      selectedDesignContextId,
    );
    if (
      revision !== runRevision ||
      activeCompletionFocus !== focus ||
      preview.sourceVersion !== codeEditor.sourceVersion()
    ) {
      return;
    }
    if (
      viewport.previewCompletedProject(
        module,
        preview.cursor.file,
        preview.cursor.offset,
        preferredEvaluationContextId,
      )
    ) {
      renderElementsPanel(viewport.getSelected());
    }
    hideViewportProgress();
  } catch {
    if (revision === runRevision && activeCompletionFocus === focus) {
      hideViewportProgress();
    }
  }
}

function resumeModelAfterCompletion(): void {
  runRevision += 1;
  compiler.cancel();
  showViewportProgress('Updating model');
  scheduleModelRun(180);
}

function scheduleModelRun(delay: number): void {
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(() => {
    compileTimer = undefined;
    if (!activeCompletionFocus?.preview) void runModel();
  }, delay);
}

function requestModelUpdate(delay: number): void {
  activeCompletionFocus = undefined;
  window.clearTimeout(completionPreviewTimer);
  completionPreviewTimer = undefined;
  viewport.restoreTransientPreview();
  renderElementsPanel(viewport.getSelected());
  showViewportProgress('Updating model');
  runRevision += 1;
  compiler.cancel();
  scheduleModelRun(delay);
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
  compiler.cancel();
  hideViewportProgress();
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

function selectOccurrence(occurrence: Occurrence, revealSource: boolean): void {
  renderElementsPanel(occurrence);
  if (currentModule) renderDesignArguments(currentModule);

  if (revealSource) {
    const sourceRef = primarySource(occurrence.node);
    if (sourceRef) {
      codeEditor.revealSource(sourceRef);
    } else {
      codeEditor.clearSourceHighlight();
    }
  }
}

function renderElementsPanel(occurrence?: Occurrence): void {
  if (!occurrence) {
    elementsPanel.render();
    return;
  }
  const sourceElement = viewport.sourceEvaluation()?.evaluation.element;
  elementsPanel.render(
    occurrence.node,
    sourceElement?.nodeId === occurrence.node.nodeId
      ? sourceElement.name
      : undefined,
  );
}

function drillToObjectSource(node: ModelSnapshotObject): void {
  if (!currentModule) return;
  const compiledSource = preferredObjectSource(currentModule, node);
  if (!compiledSource) return;
  const sourceRef =
    codeEditor.resolveSourceRef(compiledSource) ?? compiledSource;
  const evaluationContextId = viewport.sourceEvaluation()?.evaluation.contextId;
  codeEditor.revealSource(sourceRef, true);
  const matched = viewport.selectBySourceOffset(
    sourceRef.file,
    sourceRef.start,
    undefined,
    evaluationContextId,
  );
  preferredEvaluationContextId = matched ? evaluationContextId : undefined;
  const selected = matched ? viewport.getSelected() : undefined;
  if (selected) selectOccurrence(selected, false);
}

function preferredObjectSource(
  module: ModelModule,
  node: ModelSnapshotObject,
): SourceRef | undefined {
  const binding = module.catalog
    .filter(
      entry =>
        entry.category === 'binding' && entry.nodeIds.includes(node.nodeId),
    )
    .sort((left, right) => left.firstOrder - right.firstOrder)[0];
  if (binding) return binding.sourceRef;

  return (
    module.sourceTargets
      .filter(
        target =>
          (target.kind === 'value' || target.kind === 'operation-output') &&
          target.evaluations.some(evaluation =>
            evaluation.nodeIds.includes(node.nodeId),
          ),
      )
      .sort(
        (left, right) =>
          sourceRefSpan(left.sourceRef) - sourceRefSpan(right.sourceRef),
      )[0]?.sourceRef ?? primarySource(node)
  );
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
  renderElementsPanel(occurrence);
  if (!occurrence && currentModule) renderDesignArguments(currentModule);
}

function syncEdgeSelectionTool(): void {
  if (currentModuleSourceVersion !== codeEditor.sourceVersion()) {
    cancelEdgeSelectionTool();
    return;
  }
  const scope = viewport.sourceEvaluation();
  const occurrence = viewport.getSelected();
  const operation = scope?.target.operation?.kind;
  const selection = scope?.evaluation.selection;
  const eligible =
    scope?.target.kind === 'operation-selection' &&
    selection?.kind === 'edge' &&
    (operation === 'fillet' || operation === 'chamfer') &&
    occurrence?.node.kind === 'solid';
  if (!eligible || !scope || !occurrence) {
    cancelEdgeSelectionTool();
    return;
  }
  if (
    edgeSelectionTool?.targetId === scope.target.id &&
    edgeSelectionTool.evaluationIndex === scope.evaluationIndex &&
    edgeSelectionTool.occurrenceKey === occurrence.key
  ) {
    return;
  }
  startEdgeSelection(
    scope.target.id,
    scope.evaluationIndex,
    operation,
    scope.target.sourceRef,
    scope.evaluation.contextId,
    selection.inputNodeId,
    selection.ids,
    occurrence,
  );
}

function startEdgeSelection(
  targetId: string,
  evaluationIndex: number,
  operation: 'fillet' | 'chamfer',
  sourceRef: SourceRef,
  contextId: string,
  inputNodeId: string,
  initialEdgeIds: readonly EdgeId[],
  occurrence: Occurrence,
): void {
  cancelEdgeSelectionTool();
  viewport.cancelPositionTool();
  const interruptedCompile = interruptCompileForTool();
  let availableEdgeIds: readonly EdgeId[];
  try {
    availableEdgeIds = viewport.beginEdgeSelection(
      occurrence.key,
      inputNodeId,
      initialEdgeIds,
    );
  } catch (error) {
    resumeCompileAfterTool(interruptedCompile);
    showToolIssue(error instanceof Error ? error.message : String(error));
    return;
  }
  edgeSelectionTool = {
    targetId,
    evaluationIndex,
    contextId,
    operation,
    sourceRef,
    occurrenceKey: occurrence.key,
    availableEdgeIds,
    initialEdgeIds: sortedEdgeIds(initialEdgeIds),
    selectedEdgeIds: sortedEdgeIds(initialEdgeIds),
    session: toolEngine.begin(
      `viewport.edge-selection:${sourceRef.file}:${sourceRef.start}:${sourceRef.end}`,
    ),
    interruptedCompile,
    previewRevision: 0,
    previewCompiling: false,
  };
  sourceEditPopover.dismiss();
  errorBar.hidden = true;
  updateEdgeSelectionToolbar(edgeSelectionTool);
}

function clearSelectedEdges(): void {
  const tool = edgeSelectionTool;
  if (!tool || tool.selectedEdgeIds.length === 0) return;
  tool.selectedEdgeIds = [];
  viewport.clearSelectedEdges();
  updateEdgeSelectionToolbar(tool);
  scheduleEdgeSelectionResultPreview(tool);
}

function updateEdgeSelectionToolbar(tool: EdgeSelectionTool): void {
  edgeSelectionTitle.textContent = edgeOperationLabel(tool.operation);
  edgeSelectionAvailable.textContent = `${tool.availableEdgeIds.length} AVAILABLE`;
  edgeSelectionSummary.textContent = formatEdgeIds(tool.selectedEdgeIds);
  edgeSelectionClear.disabled = tool.selectedEdgeIds.length === 0;
  edgeSelectionApply.disabled = sameEdgeIds(
    tool.selectedEdgeIds,
    tool.initialEdgeIds,
  );
  edgeSelectionToolbar.hidden = false;
}

function handleEdgeSelection(event: EdgeSelectionEvent): void {
  if (event.kind === 'cancel') {
    cancelEdgeSelectionTool(false);
    return;
  }
  const tool = edgeSelectionTool;
  if (!tool) return;
  if (event.kind === 'hover') return;
  tool.selectedEdgeIds = event.selectedEdgeIds;
  updateEdgeSelectionToolbar(tool);
  scheduleEdgeSelectionResultPreview(tool);
}

function commitEdgeSelectionTool(): void {
  const tool = edgeSelectionTool;
  if (!tool) return;
  if (sameEdgeIds(tool.selectedEdgeIds, tool.initialEdgeIds)) return;
  const intent = edgeSelectionIntent(tool);
  stopEdgeSelectionResultPreview(tool);
  edgeSelectionTool = undefined;
  viewport.endEdgeSelection();
  edgeSelectionToolbar.hidden = true;
  errorBar.hidden = true;
  const committed = commitToolSession(tool.session, intent);
  if (!committed) resumeCompileAfterTool(tool.interruptedCompile);
  renderCurrentPanels();
}

function cancelEdgeSelectionTool(updateViewport = true): boolean {
  const tool = edgeSelectionTool;
  if (!tool) return false;
  stopEdgeSelectionResultPreview(tool);
  edgeSelectionTool = undefined;
  tool.session.cancel();
  if (updateViewport) viewport.endEdgeSelection();
  edgeSelectionToolbar.hidden = true;
  resumeCompileAfterTool(tool.interruptedCompile);
  return true;
}

function scheduleEdgeSelectionResultPreview(tool: EdgeSelectionTool): void {
  tool.previewRevision += 1;
  window.clearTimeout(tool.previewTimer);
  tool.previewTimer = undefined;
  if (tool.previewCompiling) {
    compiler.cancel();
    tool.previewCompiling = false;
  }
  errorBar.hidden = true;
  if (sameEdgeIds(tool.selectedEdgeIds, tool.initialEdgeIds)) {
    viewport.clearEdgeSelectionResultPreview();
    hideViewportProgress();
    return;
  }

  const resolution = toolEngine.resolve(
    tool.session.toolId,
    edgeSelectionIntent(tool),
  );
  if (resolution.status !== 'ready') {
    showToolIssue(resolution.reason);
    return;
  }
  const project = codeEditor.projectWithSourceEdits(resolution.plan.edits);
  if (!project) {
    showToolIssue('The edge selection no longer maps to the current source.');
    return;
  }
  const revision = tool.previewRevision;
  tool.previewTimer = window.setTimeout(() => {
    tool.previewTimer = undefined;
    void runEdgeSelectionResultPreview(tool, project, revision);
  }, 140);
}

async function runEdgeSelectionResultPreview(
  tool: EdgeSelectionTool,
  project: ModelProject,
  revision: number,
): Promise<void> {
  if (edgeSelectionTool !== tool || tool.previewRevision !== revision) return;
  tool.previewCompiling = true;
  showViewportProgress(`Previewing ${edgeOperationLabel(tool.operation)}`);
  try {
    const module = await compiler.compile(
      project,
      codeEditor.currentFile(),
      selectedDesignContextId,
    );
    if (edgeSelectionTool !== tool || tool.previewRevision !== revision) return;
    const target = module.sourceTargets.find(
      candidate => candidate.id === tool.targetId,
    );
    const evaluation =
      target?.evaluations.find(
        candidate => candidate.contextId === tool.contextId,
      ) ?? target?.evaluations[tool.evaluationIndex];
    const result = evaluation?.nodeIds
      .map(nodeId => module.objects.get(nodeId))
      .find(node => node?.kind === 'solid' && node.mesh);
    if (!result) {
      throw new Error('The edge operation preview produced no solid result.');
    }
    viewport.setEdgeSelectionResultPreview(result);
    errorBar.hidden = true;
  } catch (error) {
    if (edgeSelectionTool !== tool || tool.previewRevision !== revision) return;
    const diagnostic =
      error instanceof ModelDiagnosticError ? error.diagnostic : undefined;
    showToolIssue(
      diagnostic
        ? [diagnostic.summary, diagnostic.details].filter(Boolean).join('\n')
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    if (edgeSelectionTool === tool && tool.previewRevision === revision) {
      tool.previewCompiling = false;
      hideViewportProgress();
    }
  }
}

function stopEdgeSelectionResultPreview(tool: EdgeSelectionTool): void {
  tool.previewRevision += 1;
  window.clearTimeout(tool.previewTimer);
  tool.previewTimer = undefined;
  if (tool.previewCompiling) compiler.cancel();
  tool.previewCompiling = false;
  viewport.clearEdgeSelectionResultPreview();
  hideViewportProgress();
}

function edgeSelectionIntent(tool: EdgeSelectionTool): ToolIntent {
  return {
    kind: 'expression.replace',
    target: {sourceRef: tool.sourceRef},
    expression: {
      kind: 'array',
      elements: tool.selectedEdgeIds.map(value => ({kind: 'number', value})),
    },
  };
}

function edgeOperationLabel(operation: EdgeSelectionTool['operation']): string {
  return operation === 'fillet' ? 'Fillet' : 'Chamfer';
}

function formatEdgeIds(edgeIds: readonly EdgeId[]): string {
  if (edgeIds.length === 0) return 'None';
  const visible = edgeIds.slice(0, 8).map(edgeId => `E${edgeId}`);
  return edgeIds.length > visible.length
    ? `${visible.join(', ')} +${edgeIds.length - visible.length}`
    : visible.join(', ');
}

function sortedEdgeIds(edgeIds: readonly EdgeId[]): EdgeId[] {
  return [...edgeIds].sort((left, right) => left - right);
}

function sameEdgeIds(
  left: readonly EdgeId[],
  right: readonly EdgeId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((edgeId, index) => edgeId === right[index])
  );
}

function interruptCompileForTool(): boolean {
  const scheduled = compileTimer !== undefined;
  const compiling = compiler.isCompiling();
  if (!scheduled && !compiling) return false;
  runRevision += 1;
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  compiler.cancel();
  hideViewportProgress();
  return true;
}

function resumeCompileAfterTool(interrupted: boolean): void {
  if (interrupted) void runModel();
}

function parameterIntent(target: ParameterTarget, value: number): ToolIntent {
  return {kind: 'parameter.set', target, value};
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
    hidePositionToolStatus();
    return;
  }

  const session = positionToolSession;
  if (!session) {
    showToolIssue('The position tool session expired. Start the drag again.');
    return;
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
  const compiledSourceVersion = currentModuleSourceVersion;
  currentModuleSourceVersion = undefined;
  const result = session.commit(intent);
  if (result.status !== 'committed') {
    currentModuleSourceVersion = compiledSourceVersion;
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
  hideViewportProgress();
  errorBar.textContent = message;
  errorBar.hidden = false;
}

function sourceHistoryAction(
  event: KeyboardEvent,
): 'undo' | 'redo' | undefined {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return undefined;
  if (event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
  if (event.code === 'KeyY' && !event.shiftKey) return 'redo';
  return undefined;
}

function showViewportProgress(label: string): void {
  viewportProgressLabel.textContent = label;
  viewportProgress.hidden = false;
}

function hideViewportProgress(): void {
  viewportProgress.hidden = true;
}

function primarySource(node: ModelSnapshotObject): SourceRef | undefined {
  return node.sourceRefs.at(-1);
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
