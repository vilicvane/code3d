import './style.css';
import brandMark from '../../../assets/brand/mark.svg?raw';
import {
  CodeEditor,
  type ActiveFileChangeReason,
  type CompletionFocus,
  type ProjectEditorChange,
} from './editor';
import {ModelCompilerClient} from './model/compiler-client';
import {compilationPhaseLabels} from './model/compilation-progress';
import type {
  DesignArgumentContext,
  EdgeArgumentTarget,
  ModelModule,
} from './model/compiler';
import {ModelDiagnosticError, type ModelDiagnostic} from './model/diagnostic';
import {
  originDecoration,
  originSourceDecoration,
} from './model/origin-decorations';
import {spatialIntent} from './tools/model-spatial-tool';
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
  TopologyKind,
} from '@code3d/core/tooling';
import {
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
} from './model/operation-decorations';
import {
  elementSourceDecoration,
  boundRelationSourceDecoration,
  namedElementDecorations,
} from './model/element-decorations';
import type {
  TransformGizmoBinding,
  TransformGizmoEvent,
} from './tools/transform-gizmo';
import {
  ToolEngine,
  type ToolCommitOptions,
  type ToolIntent,
  type ToolPreview,
  type ToolSession,
} from './tools/tool-system';
import {
  ModelViewport,
  type Occurrence,
  type TopologySelectionEvent,
} from './viewport';
import {DockPanelCoordinator} from './ui/dock-panels';
import {ElementsPanel} from './ui/elements-panel';
import {ImageExportDialog} from './ui/image-export';
import {ModelExportDialog} from './ui/model-export';
import {ViewportContextMenu} from './ui/viewport-context-menu';
import {ProjectTree} from './ui/project-tree';
import {SourceEditPopover} from './ui/source-edit-popover';
import {
  ContextualToolPanel,
  type ContextualToolPanelView,
} from './ui/contextual-tool-panel';
import type {
  ToolArgumentSource,
  ToolArgumentEditTarget,
  ToolSelectionParameterSchema,
  ToolSignatureSchema,
} from './model/tool-schema';
import {isToolSelectionParameter} from './model/tool-schema';
import {
  contextualToolParameters,
  contextualParameterIntent,
  contextualParameterView,
  validContextualParameter,
  type ContextualToolParameterState,
} from './tools/contextual-tool-parameters';

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
        <span class="brand-mark" aria-hidden="true">${brandMark}</span>
        <span>Code3D</span>
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
          <div class="viewport-feedback-stack" id="viewport-feedback-stack">
            <div class="viewport-diagnostic-stack" id="viewport-diagnostic-stack" role="status" aria-live="polite" aria-atomic="true" hidden></div>
          </div>
          <div class="viewport-status" id="viewport-status" data-state="busy" role="status" aria-live="polite" aria-busy="true">
            <span class="viewport-status-indicator" aria-hidden="true">
              <svg class="viewport-status-ready" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6" />
                <path d="m5 8 2 2 4-4" />
              </svg>
              <svg class="viewport-status-error" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6" />
                <path d="m6 6 4 4m0-4-4 4" />
              </svg>
            </span>
            <span id="viewport-status-label">Loading editor</span>
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
const viewportFeedbackStack = requiredElement('viewport-feedback-stack');
const viewportDiagnosticStack = requiredElement('viewport-diagnostic-stack');
const viewportStatus = requiredElement('viewport-status');
const viewportStatusLabel = requiredElement('viewport-status-label');
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
const compiler = new ModelCompilerClient(projectFileSystem, language =>
  codeEditor.setProjectLanguage(language),
);
let persistenceQueue = Promise.resolve();
let currentModule: ModelModule | null = null;
let currentModuleSourceVersion: number | undefined;
let modelStatus: 'ready' | 'error' = 'ready';
let compileTimer: number | undefined;
let completionPreviewTimer: number | undefined;
let runRevision = 0;
let positionToolSession: ToolSession | undefined;
let positionToolInterruptedCompile = false;
let edgeSelectionTool: EdgeSelectionTool | undefined;
let topologyReferenceSelectionTool: TopologyReferenceSelectionTool | undefined;
let edgeEditSession: EdgeEditSession | undefined;
let edgeEditSessionCounter = 0;
let contextualTool: ContextualToolState | undefined;
let contextualToolCounter = 0;
const toolParameterCommitTimers = new Map<string, number>();
let contextFilePath: string | undefined;
let preferredEvaluationContextId: string | undefined;
let selectedDesignContextId: string | undefined;
let compilingDesignContextId: string | undefined;
let activeCompletionFocus: CompletionFocus | undefined;
let applyingFileRoute = false;
type EdgeSelectionTool = {
  targetId: string;
  evaluationIndex: number;
  session: EdgeEditSession;
  operation: 'fillet' | 'chamfer';
  edgeArgument: EdgeArgumentTarget;
  occurrenceKey: string;
  availableEdgeIds: readonly EdgeId[];
  selectedEdgeIds: readonly EdgeId[];
  hasExplicitEdgeSelection: boolean;
};
type EdgeEditSession = {
  targetId: string;
  sourceFile: string;
  undoGroup: string;
  baselineEdgeIds: readonly EdgeId[];
  baselineHasExplicitEdgeSelection: boolean;
  appliedEdgeIds: readonly EdgeId[];
  appliedHasExplicitEdgeSelection: boolean;
  hasEdits: boolean;
  historyState: 'applied' | 'undone';
};
type TopologyReferenceSelectionTool = {
  targetId: string;
  evaluationIndex: number;
  sourceFile: string;
  parameter: ToolSelectionParameterSchema;
  argument: ToolArgumentEditTarget;
  occurrenceKey: string;
  availableIds: readonly number[];
  selectedIds: readonly number[];
};
type ContextualToolState = {
  callId: string;
  contextId: string;
  targetId: string;
  evaluationIndex: number;
  sourceFile: string;
  signature: ToolSignatureSchema;
  presentArguments: Map<
    string,
    Extract<ToolArgumentEditTarget, Readonly<{kind: 'present'}>>
  >;
  parameters: Map<string, ContextualToolParameterState>;
  undoGroup: string;
  baselineValues: Map<string, number>;
  appliedValues: Map<string, number>;
  removedArguments: Set<string>;
  hasEdits: boolean;
  historyState: 'applied' | 'undone';
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
  onTopologySelection: handleTopologySelection,
  sourceDecorationProviders: [
    booleanOperationSourceDecoration,
    edgeModificationSourceDecoration,
    elementSourceDecoration,
    boundRelationSourceDecoration,
    originSourceDecoration,
  ],
});
const imageExportDialog = new ImageExportDialog(viewportHost, {
  capture: (width, height) => viewport.captureImage(width, height),
  fileName: () => viewport.exportName(),
});
const modelExportDialog = new ModelExportDialog(viewportHost, () => {
  const scene = viewport.exportScene();
  const sourceVersion = codeEditor.sourceVersion();
  return {
    fileName: viewport.exportName(),
    export: async options => {
      if (
        !scene ||
        currentModule !== scene.module ||
        sourceVersion !== codeEditor.sourceVersion() ||
        currentModuleSourceVersion !== sourceVersion
      ) {
        throw new Error(
          'The model has changed or is only a preview. Run the model and reopen export.',
        );
      }
      return compiler.export(scene.module, scene.instances, options);
    },
  };
});
new ViewportContextMenu(
  viewportHost.querySelector<HTMLCanvasElement>('.viewport-canvas')!,
  [
    {label: 'Export image…', run: () => imageExportDialog.open()},
    {label: 'Export model…', run: () => modelExportDialog.open()},
  ],
);
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
const sourceEditPopover = new SourceEditPopover(
  viewportFeedbackStack,
  sourceRef => codeEditor.revealSource(sourceRef, true),
);
const contextualToolPanel = new ContextualToolPanel(viewportHost, {
  onParameterInput: updateContextualToolParameter,
  onParameterCommit: commitContextualToolParameter,
  onAction: runContextualToolAction,
});
const toolEngine = new ToolEngine({
  sourceVersion: () => codeEditor.sourceVersion(),
  resolveSourceRef: sourceRef => codeEditor.resolveSourceRef(sourceRef),
  readSource: sourceRef => codeEditor.readSource(sourceRef),
  applySourceEdits: (baseVersion, edits, options) =>
    codeEditor.applySourceEdits(baseVersion, edits, options),
  applyPreview: preview => applyToolPreview(preview),
  commitPreview: preview => commitToolPreview(preview),
  clearPreview: (preview, reason) => clearToolPreview(preview, reason),
});

codeEditor.onChange(change => {
  const toolChange = change.kind === 'content' && change.origin === 'tool';
  const historyChange =
    change.kind === 'content' &&
    (change.origin === 'undo' || change.origin === 'redo');
  const editingHistoryChange =
    historyChange && handleContextualEditingHistory(change);
  if (!toolChange && !editingHistoryChange) abandonContextualTool();
  persistProjectChange(projectFileSystem, change);
  if (!toolChange) sourceEditPopover.dismiss();
  if (change.kind !== 'content') renderProjectNavigation();
  requestModelUpdate(toolChange || historyChange ? 0 : 420);
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
  syncContextualTool(matched);
});
codeEditor.onCompletionFocus(handleCompletionFocus);
codeEditor.onEditorActivation(cursor => {
  if (!codeEditor.hasPendingToolEdits()) return;
  void codeEditor
    .formatPendingToolEdits(cursor)
    .catch(error =>
      console.error('Prettier failed after a Code3D source edit.', error),
    );
});
codeEditor.onActiveFile((path, reason) => {
  finishContextualTool();
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
    codeEditor.createFile(path, "import {box} from '@code3d/core';\n\n");
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
  if (event.key === 'Escape' && viewport.cancelPositionTool()) {
    event.preventDefault();
    return;
  }
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
  renderViewportDiagnostic();
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
  setViewportStatus('busy', 'Preparing model');
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
      phase => setViewportStatus('busy', compilationPhaseLabels[phase]),
    );
    if (
      revision !== runRevision ||
      sourceVersion !== codeEditor.sourceVersion()
    ) {
      return;
    }
    currentModule = nextModule;
    currentModuleSourceVersion = sourceVersion;
    modelStatus = nextModule.diagnostic ? 'error' : 'ready';
    if (
      !(await presentModelDiagnostic(
        nextModule.diagnostic,
        revision,
        sourceVersion,
      ))
    ) {
      return;
    }
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
    syncContextualTool();
    restoreModelStatus();
  } catch (error) {
    if (revision !== runRevision) {
      return;
    }
    compilingDesignContextId = undefined;
    renderCurrentPanels();
    modelStatus = 'error';
    restoreModelStatus();
    const diagnostic =
      error instanceof ModelDiagnosticError ? error.diagnostic : undefined;
    if (diagnostic) {
      await presentModelDiagnostic(diagnostic, revision, sourceVersion);
    } else {
      codeEditor.setModelDiagnostic();
      renderViewportDiagnostic();
      errorBar.textContent =
        error instanceof Error ? error.message : String(error);
      errorBar.hidden = false;
    }
  }
}

async function presentModelDiagnostic(
  diagnostic: ModelDiagnostic | undefined,
  revision: number,
  sourceVersion: number,
): Promise<boolean> {
  codeEditor.setModelDiagnostic(diagnostic);
  renderViewportDiagnostic(
    diagnostic?.relatedModelNodeIds?.length ? diagnostic : undefined,
  );
  if (!diagnostic || diagnostic.sourceRef) {
    errorBar.hidden = true;
    return true;
  }
  const hasLanguageError = await codeEditor.hasLanguageError();
  if (
    revision !== runRevision ||
    sourceVersion !== codeEditor.sourceVersion()
  ) {
    return false;
  }
  if (hasLanguageError) {
    errorBar.hidden = true;
    return true;
  }
  errorBar.textContent = [diagnostic.summary, diagnostic.details]
    .filter(Boolean)
    .join('\n');
  errorBar.hidden = false;
  return true;
}

function renderViewportDiagnostic(diagnostic?: ModelDiagnostic): void {
  viewportDiagnosticStack.replaceChildren();
  viewportDiagnosticStack.hidden = !diagnostic;
  if (!diagnostic) return;

  const item = document.createElement('section');
  item.className = 'viewport-diagnostic';
  const summary = document.createElement('strong');
  summary.textContent = diagnostic.summary;
  item.append(summary);
  if (diagnostic.details) {
    const details = document.createElement('p');
    details.textContent = diagnostic.details;
    item.append(details);
  }
  viewportDiagnosticStack.append(item);
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
  setViewportStatus('busy', `Rendering preview · ${focus.memberName}`);
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
      phase =>
        setViewportStatus(
          'busy',
          `${compilationPhaseLabels[phase]} · ${focus.memberName}`,
        ),
    );
    if (
      revision !== runRevision ||
      activeCompletionFocus !== focus ||
      preview.sourceVersion !== codeEditor.sourceVersion()
    ) {
      return;
    }
    if (module.diagnostic) {
      restoreModelStatus();
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
    restoreModelStatus();
  } catch {
    if (revision === runRevision && activeCompletionFocus === focus) {
      restoreModelStatus();
    }
  }
}

function resumeModelAfterCompletion(): void {
  runRevision += 1;
  compiler.cancel();
  setViewportStatus('busy', 'Updating model');
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
  setViewportStatus('busy', 'Updating model');
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
  restoreModelStatus();
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

function syncContextualTool(sourceTargetFocused = true): void {
  if (!sourceTargetFocused) {
    finishContextualTool();
    return;
  }
  const scope = viewport.sourceEvaluation();
  const previous = contextualTool;
  const continuesPrevious =
    previous !== undefined &&
    scope !== undefined &&
    scope.target.tool !== undefined &&
    previous.callId === scope.target.tool.callId &&
    previous.contextId === scope.evaluation.contextId &&
    previous.signature.id === scope.target.tool.signature.id;
  if (currentModuleSourceVersion !== codeEditor.sourceVersion()) {
    if (previous && !continuesPrevious) finishContextualTool();
    return;
  }
  const occurrence = viewport.getSelected();
  const sourceTool = scope?.target.tool;
  if (!scope || !sourceTool) {
    finishContextualTool();
    return;
  }
  if (previous && !continuesPrevious) finishContextualTool();
  const parameters = contextualToolParameters(
    sourceTool.signature,
    sourceTool.arguments,
    scope.target.sourceRef,
    scope.evaluation.parameters ?? [],
    scope.evaluation.toolArguments,
  );
  const baselineValues = continuesPrevious
    ? previous.baselineValues
    : parameterValues(parameters);
  const appliedValues =
    continuesPrevious && previous.historyState === 'undone'
      ? previous.appliedValues
      : parameterValues(parameters);
  const removedArguments = continuesPrevious
    ? new Set(previous.removedArguments)
    : new Set<string>();
  if (!continuesPrevious || previous.historyState === 'applied') {
    sourceTool.arguments.forEach(argument => {
      if (argument.target?.kind === 'present') {
        removedArguments.delete(argument.name);
      }
    });
  }
  contextualTool = {
    callId: sourceTool.callId,
    contextId: scope.evaluation.contextId,
    targetId: scope.target.id,
    evaluationIndex: scope.evaluationIndex,
    sourceFile: scope.target.sourceRef.file,
    signature: sourceTool.signature,
    presentArguments: continuesPrevious
      ? mergePresentArguments(previous.presentArguments, sourceTool.arguments)
      : presentArguments(sourceTool.arguments),
    parameters,
    undoGroup: continuesPrevious
      ? previous.undoGroup
      : `contextual-tool:${sourceTool.callId}:${scope.evaluation.contextId}:${++contextualToolCounter}`,
    baselineValues,
    appliedValues,
    removedArguments,
    hasEdits: continuesPrevious ? previous.hasEdits : false,
    historyState: continuesPrevious ? previous.historyState : 'applied',
  };
  applyContextualHistoryValues(contextualTool);
  syncSelectionProvider(scope, occurrence);
  renderContextualToolPanel();
}

const contextualParameterCommitDelayMilliseconds = 240;

function parameterValues(
  parameters: ReadonlyMap<string, ContextualToolParameterState>,
): Map<string, number> {
  return new Map(
    [...parameters].flatMap(([name, parameter]) =>
      parameter.value === undefined ? [] : [[name, parameter.value]],
    ),
  );
}

function presentArguments(
  arguments_: readonly ToolArgumentSource[],
): ContextualToolState['presentArguments'] {
  return new Map(
    arguments_.flatMap(argument =>
      argument.target?.kind === 'present'
        ? [[argument.name, argument.target]]
        : [],
    ),
  );
}

function mergePresentArguments(
  previous: ContextualToolState['presentArguments'],
  arguments_: readonly ToolArgumentSource[],
): ContextualToolState['presentArguments'] {
  const result = new Map(previous);
  presentArguments(arguments_).forEach((target, name) =>
    result.set(name, target),
  );
  return result;
}

function applyContextualHistoryValues(tool: ContextualToolState): void {
  const values =
    tool.historyState === 'applied' ? tool.appliedValues : tool.baselineValues;
  tool.parameters.forEach((parameter, name) => {
    parameter.value = values.get(name);
  });
}

function updateContextualToolParameter(
  name: string,
  value: number | undefined,
): void {
  cancelContextualParameterCommit(name);
  const tool = contextualTool;
  const parameter = tool?.parameters.get(name);
  if (!tool || !parameter) return;
  parameter.value = value;
  const invalid = !validContextualParameter(parameter);
  contextualToolPanel.setInvalid(name, invalid);
  if (invalid || !parameter.binding) return;
  const timer = window.setTimeout(() => {
    toolParameterCommitTimers.delete(name);
    commitContextualToolParameter(
      name,
      contextualTool?.parameters.get(name)?.value,
    );
  }, contextualParameterCommitDelayMilliseconds);
  toolParameterCommitTimers.set(name, timer);
}

function commitContextualToolParameter(
  name: string,
  value: number | undefined,
): boolean {
  cancelContextualParameterCommit(name);
  const tool = contextualTool;
  const parameter = tool?.parameters.get(name);
  if (!tool || !parameter) return false;
  parameter.value = value;
  const invalid = !validContextualParameter(parameter);
  contextualToolPanel.setInvalid(name, invalid);
  if (invalid || !parameter.binding) return false;
  const appliedValue = tool.appliedValues.get(name);
  if (appliedValue !== undefined && Math.abs(value! - appliedValue) < 1e-9) {
    return currentModuleSourceVersion !== codeEditor.sourceVersion();
  }
  const intent = contextualParameterIntent(parameter);
  if (!intent) return false;
  const committed = commitToolSession(
    toolEngine.begin(
      `contextual-tool.parameter:${tool.callId}:${tool.contextId}:${name}`,
    ),
    intent,
    {undoGroup: tool.undoGroup},
  );
  if (!committed) {
    parameter.value =
      appliedValue ??
      (parameter.binding.kind === 'parameter'
        ? parameter.binding.usage.value
        : undefined);
    renderContextualToolPanel();
    return false;
  }
  tool.appliedValues.set(name, value!);
  tool.hasEdits = true;
  tool.historyState = 'applied';
  const edgeSession = edgeSelectionTool?.session;
  if (edgeSession && edgeSelectionTool?.targetId === tool.targetId) {
    edgeSession.hasEdits = true;
    edgeSession.historyState = 'applied';
  }
  return true;
}

function cancelContextualParameterCommit(name: string): void {
  const timer = toolParameterCommitTimers.get(name);
  if (timer !== undefined) window.clearTimeout(timer);
  toolParameterCommitTimers.delete(name);
}

function cancelContextualParameterCommits(): void {
  toolParameterCommitTimers.forEach(timer => window.clearTimeout(timer));
  toolParameterCommitTimers.clear();
}

function runContextualToolAction(id: string): void {
  const tool = contextualTool;
  if (!tool) return;
  const separator = id.lastIndexOf(':');
  const parameterName = id.slice(0, separator);
  const actionKind = id.slice(separator + 1);
  const parameter = tool.signature.parameters.find(
    candidate => candidate.name === parameterName,
  );
  const action = parameter?.actions.find(
    candidate => candidate.action === actionKind,
  );
  const target = tool.presentArguments.get(parameterName);
  if (!action || action.action !== 'remove-argument' || !target) return;
  const committed = commitToolSession(
    toolEngine.begin(
      `contextual-tool.action:${tool.callId}:${tool.contextId}:${parameterName}`,
    ),
    {kind: 'argument.remove', parameter: parameterName, target},
    {undoGroup: tool.undoGroup},
  );
  if (!committed) return;
  tool.removedArguments.add(parameterName);
  tool.hasEdits = true;
  tool.historyState = 'applied';
  const topology = topologyReferenceSelectionTool;
  if (
    topology?.targetId === tool.targetId &&
    topology.parameter.name === parameterName
  ) {
    topology.selectedIds = [];
    viewport.setSelectedTopologyIds(topology.selectedIds);
  }
  const edge = edgeSelectionTool;
  if (edge && parameter?.kind === 'edge') {
    edge.selectedEdgeIds = [];
    edge.hasExplicitEdgeSelection = false;
    edge.edgeArgument = {
      kind: 'append',
      sourceRef: target.removalSourceRef,
      needsComma: true,
    };
    edge.session.appliedEdgeIds = [];
    edge.session.appliedHasExplicitEdgeSelection = false;
    edge.session.hasEdits = true;
    edge.session.historyState = 'applied';
    viewport.setSelectedTopologyIds([]);
  }
  renderContextualToolPanel();
}

function renderContextualToolPanel(forceParameterValues = false): void {
  const tool = contextualTool;
  if (!tool) {
    contextualToolPanel.hide();
    return;
  }
  const edge =
    edgeSelectionTool?.targetId === tool.targetId
      ? edgeSelectionTool
      : undefined;
  const topology =
    topologyReferenceSelectionTool?.targetId === tool.targetId
      ? topologyReferenceSelectionTool
      : undefined;
  const parameters = [...tool.parameters.values()].map(contextualParameterView);
  const actions = tool.signature.parameters.flatMap(parameter =>
    parameter.actions.map(action => ({
      id: `${parameter.name}:${action.action}`,
      label: action.label,
      disabled:
        !tool.presentArguments.has(parameter.name) ||
        (tool.historyState === 'applied' &&
          tool.removedArguments.has(parameter.name)) ||
        (edge !== undefined &&
          parameter.kind === 'edge' &&
          !edge.hasExplicitEdgeSelection),
    })),
  );
  const view: ContextualToolPanelView = {
    id: `${tool.callId}:${tool.contextId}:${tool.signature.id}`,
    title: humanizeToolName(tool.signature.name),
    meta: edge
      ? `${edge.availableEdgeIds.length} AVAILABLE`
      : topology
        ? `${topology.availableIds.length} AVAILABLE`
        : undefined,
    parameters,
    selection: topology
      ? {
          label: topology.parameter.label.toUpperCase(),
          summary:
            topology.parameter.multiple &&
            topology.selectedIds.length > 0 &&
            topology.selectedIds.length === topology.availableIds.length
              ? `All ${topologySelectionLabel(topology.parameter).toLowerCase()}`
              : formatTopologyIds(
                  topology.parameter.kind,
                  topology.selectedIds,
                ),
        }
      : edge
        ? {
            label: 'SELECTED EDGES',
            summary: edge.hasExplicitEdgeSelection
              ? formatEdgeIds(edge.selectedEdgeIds)
              : 'All edges',
          }
        : undefined,
    actions,
  };
  contextualToolPanel.show(view, forceParameterValues);
}

function humanizeToolName(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim();
  return words.length === 0
    ? value
    : `${words[0].toUpperCase()}${words.slice(1)}`;
}

function syncSelectionProvider(
  scope: NonNullable<ReturnType<ModelViewport['sourceEvaluation']>>,
  occurrence: Occurrence | undefined,
): void {
  if (scope.target.kind === 'topology-selection') {
    finishEdgeSelectionTool();
    syncTopologyReferenceSelectionProvider(scope, occurrence);
  } else {
    dismissTopologyReferenceSelectionTool();
    syncEdgeSelectionProvider(scope, occurrence);
  }
}

function syncTopologyReferenceSelectionProvider(
  scope: NonNullable<ReturnType<ModelViewport['sourceEvaluation']>>,
  occurrence: Occurrence | undefined,
): void {
  const selection = scope.evaluation.selection;
  const parameter = scope.target.tool?.signature.parameters.find(
    (candidate): candidate is ToolSelectionParameterSchema =>
      isToolSelectionParameter(candidate) && candidate.kind === selection?.kind,
  );
  const argument = parameter
    ? scope.target.tool?.arguments.find(
        candidate => candidate.index === parameter.index,
      )?.target
    : undefined;
  if (
    !selection ||
    selection.kind === 'edges' ||
    !parameter ||
    !argument ||
    !occurrence ||
    (occurrence.node.kind === 'group' &&
      !('scope' in selection && selection.scope))
  ) {
    dismissTopologyReferenceSelectionTool();
    return;
  }
  const current = topologyReferenceSelectionTool;
  const selectedIds = selection.ids;
  if (
    current?.targetId === scope.target.id &&
    current.evaluationIndex === scope.evaluationIndex &&
    current.occurrenceKey === occurrence.key
  ) {
    current.argument = argument;
    current.selectedIds = selectedIds;
    viewport.setSelectedTopologyIds(selectedIds);
    return;
  }
  dismissTopologyReferenceSelectionTool();
  viewport.cancelPositionTool();
  let availableIds: readonly number[];
  try {
    availableIds = viewport.beginTopologySelection(
      occurrence.key,
      selection.inputNodeId,
      selection.kind,
      parameter.multiple,
      selectedIds,
      selection.scope,
    );
  } catch (error) {
    showToolIssue(error instanceof Error ? error.message : String(error));
    return;
  }
  topologyReferenceSelectionTool = {
    targetId: scope.target.id,
    evaluationIndex: scope.evaluationIndex,
    sourceFile: scope.target.sourceRef.file,
    parameter,
    argument,
    occurrenceKey: occurrence.key,
    availableIds,
    selectedIds,
  };
  errorBar.hidden = true;
}

function syncEdgeSelectionProvider(
  scope: NonNullable<ReturnType<ModelViewport['sourceEvaluation']>>,
  occurrence: Occurrence | undefined,
): void {
  const operation = scope?.target.operation?.kind;
  const edgeArgument = scope?.target.operation?.edgeArgument;
  const selection = scope?.evaluation.selection;
  const eligible =
    scope?.target.kind === 'operation-selection' &&
    selection?.kind === 'edges' &&
    edgeArgument !== undefined &&
    (operation === 'fillet' || operation === 'chamfer') &&
    occurrence?.node.kind === 'solid';
  if (!eligible || !occurrence || !edgeArgument) {
    finishEdgeSelectionTool();
    return;
  }
  if (
    edgeSelectionTool?.targetId === scope.target.id &&
    edgeSelectionTool.evaluationIndex === scope.evaluationIndex &&
    edgeSelectionTool.occurrenceKey === occurrence.key
  ) {
    edgeSelectionTool.edgeArgument = edgeArgument;
    return;
  }
  startEdgeSelection(
    scope.target.id,
    scope.evaluationIndex,
    scope.target.sourceRef.file,
    operation,
    edgeArgument,
    selection.inputNodeId,
    selection.ids,
    occurrence,
  );
}

function startEdgeSelection(
  targetId: string,
  evaluationIndex: number,
  sourceFile: string,
  operation: 'fillet' | 'chamfer',
  edgeArgument: EdgeArgumentTarget,
  inputNodeId: string,
  initialEdgeIds: readonly EdgeId[],
  occurrence: Occurrence,
): void {
  dismissEdgeSelectionTool();
  if (edgeEditSession && edgeEditSession.targetId !== targetId) {
    finishEdgeEditSession(edgeEditSession);
  }
  const hasExplicitEdgeSelection = edgeArgument.kind === 'replace';
  const sourceSelectedEdgeIds = hasExplicitEdgeSelection
    ? sortedEdgeIds(initialEdgeIds)
    : [];
  const session =
    edgeEditSession ??
    (edgeEditSession = {
      targetId,
      sourceFile,
      undoGroup:
        contextualTool?.targetId === targetId
          ? contextualTool.undoGroup
          : `edge-operation:${targetId}:${++edgeEditSessionCounter}`,
      baselineEdgeIds: sourceSelectedEdgeIds,
      baselineHasExplicitEdgeSelection: hasExplicitEdgeSelection,
      appliedEdgeIds: sourceSelectedEdgeIds,
      appliedHasExplicitEdgeSelection: hasExplicitEdgeSelection,
      hasEdits: false,
      historyState: 'applied',
    });
  const selectedEdgeIds = edgeSessionEdgeIds(session);
  viewport.cancelPositionTool();
  let availableEdgeIds: readonly EdgeId[];
  try {
    availableEdgeIds = viewport.beginTopologySelection(
      occurrence.key,
      inputNodeId,
      'edge',
      true,
      selectedEdgeIds,
    );
  } catch (error) {
    showToolIssue(error instanceof Error ? error.message : String(error));
    return;
  }
  edgeSelectionTool = {
    targetId,
    evaluationIndex,
    session,
    operation,
    edgeArgument,
    occurrenceKey: occurrence.key,
    availableEdgeIds,
    selectedEdgeIds,
    hasExplicitEdgeSelection: edgeSessionHasExplicitEdgeSelection(session),
  };
  errorBar.hidden = true;
  renderContextualToolPanel();
}

function handleTopologySelection(event: TopologySelectionEvent): void {
  if (event.kind === 'cancel') {
    if (topologyReferenceSelectionTool) {
      dismissTopologyReferenceSelectionTool(false);
    } else {
      dismissEdgeSelectionTool(false);
    }
    renderContextualToolPanel();
    return;
  }
  if (topologyReferenceSelectionTool) {
    handleTopologyReferenceSelection(event);
  } else {
    handleEdgeOperationSelection(event);
  }
}

function handleTopologyReferenceSelection(
  event: Exclude<TopologySelectionEvent, Readonly<{kind: 'cancel'}>>,
): void {
  const tool = topologyReferenceSelectionTool;
  if (
    !tool ||
    event.kind === 'hover' ||
    event.topology !== tool.parameter.kind
  ) {
    return;
  }
  tool.selectedIds = tool.parameter.multiple
    ? sortedTopologyIds(event.selectedIds)
    : [event.id];
  renderContextualToolPanel();
  const contextual = contextualTool;
  const committed = commitToolSession(
    toolEngine.begin(
      `viewport.topology-reference:${tool.targetId}:${tool.evaluationIndex}`,
    ),
    {
      kind: 'argument.set',
      parameter: tool.parameter.name,
      target: tool.argument,
      expression: tool.parameter.multiple
        ? {
            kind: 'array',
            elements: tool.selectedIds.map(value => ({kind: 'number', value})),
          }
        : {kind: 'number', value: event.id},
    },
    {undoGroup: contextual?.undoGroup},
  );
  if (!committed) {
    dismissTopologyReferenceSelectionTool();
    renderContextualToolPanel();
    return;
  }
  if (contextual?.targetId === tool.targetId) {
    contextual.hasEdits = true;
    contextual.historyState = 'applied';
  }
}

function handleEdgeOperationSelection(event: TopologySelectionEvent): void {
  if (event.kind === 'cancel') {
    dismissEdgeSelectionTool(false);
    renderContextualToolPanel();
    return;
  }
  const tool = edgeSelectionTool;
  if (!tool) return;
  if (event.kind === 'hover') return;
  if (event.topology !== 'edge') return;
  const selectedEdgeIds = sortedEdgeIds(event.selectedIds);
  if (selectedEdgeIds.length === 0) {
    const hadExplicitSelection = tool.hasExplicitEdgeSelection;
    tool.selectedEdgeIds = [];
    tool.hasExplicitEdgeSelection = false;
    viewport.setSelectedTopologyIds(tool.selectedEdgeIds);
    renderContextualToolPanel();
    if (!hadExplicitSelection) return;
  } else {
    tool.selectedEdgeIds = selectedEdgeIds;
    tool.hasExplicitEdgeSelection = true;
    renderContextualToolPanel();
  }
  commitEdgeOperationChange(tool, edgeSelectionIntent(tool));
}

function commitEdgeOperationChange(
  tool: EdgeSelectionTool,
  intent: ToolIntent,
): void {
  if (edgeSelectionTool !== tool) return;
  errorBar.hidden = true;
  const committed = commitToolSession(
    toolEngine.begin(
      `viewport.edge-operation:${tool.targetId}:${tool.evaluationIndex}`,
    ),
    intent,
    {undoGroup: tool.session.undoGroup},
  );
  if (committed) {
    if (intent.kind === 'edge-operation.set') {
      if (intent.edges) {
        tool.session.appliedEdgeIds = [...tool.selectedEdgeIds];
        tool.session.appliedHasExplicitEdgeSelection =
          tool.hasExplicitEdgeSelection;
      }
    }
    tool.session.hasEdits = true;
    tool.session.historyState = 'applied';
    if (contextualTool?.targetId === tool.targetId) {
      contextualTool.hasEdits = true;
      contextualTool.historyState = 'applied';
    }
  } else {
    finishEdgeSelectionTool();
    renderContextualToolPanel();
  }
}

function dismissEdgeSelectionTool(updateViewport = true): void {
  if (!edgeSelectionTool) return;
  edgeSelectionTool = undefined;
  if (updateViewport) viewport.endTopologySelection();
}

function dismissTopologyReferenceSelectionTool(updateViewport = true): void {
  if (!topologyReferenceSelectionTool) return;
  topologyReferenceSelectionTool = undefined;
  if (updateViewport) viewport.endTopologySelection();
}

function finishEdgeSelectionTool(): void {
  dismissEdgeSelectionTool();
  const session = edgeEditSession;
  if (session) finishEdgeEditSession(session);
}

function finishContextualTool(): void {
  cancelContextualParameterCommits();
  dismissTopologyReferenceSelectionTool();
  finishEdgeSelectionTool();
  const tool = contextualTool;
  contextualTool = undefined;
  contextualToolPanel.hide();
  if (!tool) return;
  if (!tool.hasEdits || tool.historyState === 'undone') {
    codeEditor.discardPendingToolFormat(tool.sourceFile, tool.undoGroup);
    codeEditor.endSourceEditGroup(tool.undoGroup);
  }
}

function finishEdgeEditSession(session: EdgeEditSession): void {
  if (edgeEditSession === session) edgeEditSession = undefined;
  if (!session.hasEdits || session.historyState === 'undone') {
    codeEditor.discardPendingToolFormat(session.sourceFile, session.undoGroup);
    codeEditor.endSourceEditGroup(session.undoGroup);
  }
}

function abandonEdgeSelectionTool(): void {
  dismissEdgeSelectionTool();
  const session = edgeEditSession;
  if (!session) return;
  edgeEditSession = undefined;
  codeEditor.discardPendingToolFormat(session.sourceFile, session.undoGroup);
  codeEditor.endSourceEditGroup(session.undoGroup);
}

function abandonContextualTool(): void {
  cancelContextualParameterCommits();
  dismissTopologyReferenceSelectionTool();
  abandonEdgeSelectionTool();
  const tool = contextualTool;
  contextualTool = undefined;
  contextualToolPanel.hide();
  if (!tool) return;
  codeEditor.discardPendingToolFormat(tool.sourceFile, tool.undoGroup);
  codeEditor.endSourceEditGroup(tool.undoGroup);
}

function handleContextualEditingHistory(
  change: Extract<ProjectEditorChange, Readonly<{kind: 'content'}>>,
): boolean {
  let handled = false;
  const tool = contextualTool;
  if (tool?.sourceFile === change.path && tool.hasEdits) {
    if (change.origin === 'undo' && tool.historyState === 'applied') {
      tool.historyState = 'undone';
      applyContextualHistoryValues(tool);
      handled = true;
    } else if (change.origin === 'redo' && tool.historyState === 'undone') {
      tool.historyState = 'applied';
      codeEditor.resumeSourceEditGroup(tool.sourceFile, tool.undoGroup);
      applyContextualHistoryValues(tool);
      handled = true;
    }
  }
  const handledEdge = handleEdgeEditingHistory(change);
  if (handled || handledEdge) renderContextualToolPanel(true);
  return handled || handledEdge;
}

function handleEdgeEditingHistory(
  change: Extract<ProjectEditorChange, Readonly<{kind: 'content'}>>,
): boolean {
  const session = edgeEditSession;
  if (!session || change.path !== session.sourceFile) return false;
  if (
    change.origin === 'undo' &&
    session.hasEdits &&
    session.historyState === 'applied'
  ) {
    session.historyState = 'undone';
    applyEdgeEditSessionToTool(session);
    return true;
  }
  if (
    change.origin === 'redo' &&
    session.hasEdits &&
    session.historyState === 'undone'
  ) {
    session.historyState = 'applied';
    codeEditor.resumeSourceEditGroup(session.sourceFile, session.undoGroup);
    applyEdgeEditSessionToTool(session);
    return true;
  }
  return false;
}

function applyEdgeEditSessionToTool(session: EdgeEditSession): void {
  const tool = edgeSelectionTool;
  if (!tool || tool.session !== session) return;
  tool.selectedEdgeIds = edgeSessionEdgeIds(session);
  tool.hasExplicitEdgeSelection = edgeSessionHasExplicitEdgeSelection(session);
  viewport.setSelectedTopologyIds(tool.selectedEdgeIds);
  renderContextualToolPanel();
}

function edgeSessionEdgeIds(session: EdgeEditSession): readonly EdgeId[] {
  return session.historyState === 'applied'
    ? session.appliedEdgeIds
    : session.baselineEdgeIds;
}

function edgeSessionHasExplicitEdgeSelection(
  session: EdgeEditSession,
): boolean {
  return session.historyState === 'applied'
    ? session.appliedHasExplicitEdgeSelection
    : session.baselineHasExplicitEdgeSelection;
}

function edgeSelectionIntent(tool: EdgeSelectionTool): ToolIntent {
  return {
    kind: 'edge-operation.set',
    operation: tool.operation,
    edges: tool.hasExplicitEdgeSelection
      ? {
          kind: 'explicit',
          argument: tool.edgeArgument,
          ids: tool.selectedEdgeIds,
        }
      : {kind: 'all', argument: tool.edgeArgument},
  };
}

function formatEdgeIds(edgeIds: readonly EdgeId[]): string {
  if (edgeIds.length === 0) return 'None';
  const visible = edgeIds.slice(0, 8).map(edgeId => `E${edgeId}`);
  return edgeIds.length > visible.length
    ? `${visible.join(', ')} +${edgeIds.length - visible.length}`
    : visible.join(', ');
}

function formatTopologyId(kind: TopologyKind, id: number): string {
  const prefixes = {
    vertex: 'V',
    edge: 'E',
    surface: 'S',
  } as const satisfies Record<TopologyKind, string>;
  return `${prefixes[kind]}${id}`;
}

function formatTopologyIds(kind: TopologyKind, ids: readonly number[]): string {
  if (ids.length === 0) return 'None';
  const visible = ids.slice(0, 8).map(id => formatTopologyId(kind, id));
  return ids.length > visible.length
    ? `${visible.join(', ')} +${ids.length - visible.length}`
    : visible.join(', ');
}

function topologySelectionLabel(
  parameter: ToolSelectionParameterSchema,
): string {
  if (!parameter.multiple) return parameter.kind.toUpperCase();
  return {
    vertex: 'VERTICES',
    edge: 'EDGES',
    surface: 'SURFACES',
  }[parameter.kind];
}

function sortedTopologyIds(ids: readonly number[]): number[] {
  return [...ids].sort((left, right) => left - right);
}

function sortedEdgeIds(edgeIds: readonly EdgeId[]): EdgeId[] {
  return [...edgeIds].sort((left, right) => left - right);
}

function interruptCompileForTool(): boolean {
  const scheduled = compileTimer !== undefined;
  const compiling = compiler.isCompiling();
  if (!scheduled && !compiling) return false;
  runRevision += 1;
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  compiler.cancel();
  restoreModelStatus();
  return true;
}

function resumeCompileAfterTool(interrupted: boolean): void {
  if (interrupted) void runModel();
}

function parameterIntent(target: ParameterTarget, value: number): ToolIntent {
  return {kind: 'parameter.set', target, value};
}

function handlePositionTool(event: TransformGizmoEvent): void {
  if (event.kind === 'begin') {
    positionToolSession?.cancel();
    positionToolInterruptedCompile = interruptCompileForTool();
    positionToolSession = toolEngine.begin(
      `viewport.${event.binding.mode}:${event.binding.axis}:${positionBindingId(event.binding)}`,
    );
    errorBar.hidden = true;
    return;
  }

  if (event.kind === 'cancel') {
    positionToolSession?.cancel();
    positionToolSession = undefined;
    resumeCompileAfterTool(positionToolInterruptedCompile);
    positionToolInterruptedCompile = false;
    return;
  }

  const session = positionToolSession;
  if (!session) {
    showToolIssue('The position tool session expired. Start the drag again.');
    return;
  }

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
}

function positionIntent(
  binding: TransformGizmoBinding,
  value: number,
): ToolIntent {
  if (binding.kind === 'spatial') return spatialIntent(binding, value);
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
    direction: binding.sensitivity as 1 | -1,
  };
}

function positionAxisIndex(axis: TransformGizmoBinding['axis']): 0 | 1 | 2 {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  return 2;
}

function positionBindingId(binding: TransformGizmoBinding): string {
  if (binding.kind === 'spatial') {
    const source = binding.spatial.source;
    if (source.kind === 'parameter') return source.target.id;
    return `spatial:${source.sourceRef.file}:${source.sourceRef.start}:${source.sourceRef.end}`;
  }
  if (binding.kind === 'parameter') {
    return binding.target.id;
  }
  const {start, end} = binding.receiver.sourceRef;
  return `expression:${binding.receiver.sourceRef.file}:${start}:${end}`;
}

function applyToolPreview(preview: ToolPreview): void {
  if (preview.kind === 'model-spatial') {
    viewport.hideSourceDecorationsDuringPreview();
    viewport.setSpatialPreview(preview.objects);
    viewport.setDecorations(
      'spatial-preview',
      preview.objects.map(object =>
        originDecoration(object.nodeId, object.spatial.origin),
      ),
    );
  } else if (preview.kind === 'parameter') {
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
  if (preview.kind === 'model-spatial') {
    viewport.commitSpatialPreview(preview.objects, preview.parameter);
  } else if (preview.kind === 'parameter') {
    viewport.commitParameterPreview(preview.targetId, preview.value);
  } else if (preview.kind === 'occurrence-translation') {
    viewport.commitOccurrenceTranslationPreview(preview.occurrenceKeys);
  }
}

function clearToolPreview(
  preview: ToolPreview,
  reason: 'replace' | 'end',
): void {
  if (preview.kind === 'model-spatial') {
    viewport.clearSpatialPreview(preview.objects);
    viewport.clearDecorations('spatial-preview');
  } else if (preview.kind === 'parameter') {
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

function commitToolSession(
  session: ToolSession,
  intent: ToolIntent,
  options: ToolCommitOptions = {},
): boolean {
  const compiledSourceVersion = currentModuleSourceVersion;
  currentModuleSourceVersion = undefined;
  const result = session.commit(intent, options);
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
      ...(target.tool?.arguments.flatMap(({target}) =>
        target
          ? [
              target.sourceRef,
              ...(target.kind === 'present' ? [target.removalSourceRef] : []),
            ]
          : [],
      ) ?? []),
      ...target.evaluations.flatMap(
        evaluation =>
          evaluation.parameters?.map(parameter => parameter.target.sourceRef) ??
          [],
      ),
      ...(target.operation?.edgeArgument
        ? [
            target.operation.edgeArgument.sourceRef,
            ...(target.operation.edgeArgument.kind === 'replace'
              ? [target.operation.edgeArgument.removalSourceRef]
              : []),
          ]
        : []),
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

function setViewportStatus(
  state: 'busy' | 'ready' | 'error',
  label: string,
): void {
  viewportStatus.dataset.state = state;
  viewportStatusLabel.textContent = label;
  viewportStatus.setAttribute('aria-busy', String(state === 'busy'));
}

function restoreModelStatus(): void {
  setViewportStatus(
    modelStatus,
    modelStatus === 'ready' ? 'Ready' : 'Model error',
  );
}

function primarySource(node: ModelSnapshotObject): SourceRef | undefined {
  return node.sourceRefs.at(-1);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element.`);
  }
  return element as T;
}
