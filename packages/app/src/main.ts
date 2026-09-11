import {resolveRenderView} from '@code3d/agent';
import {
  compareTopologyIds,
  formatTopologyId,
  type EdgeId,
  type ModelSnapshotObject,
  type ParameterTarget,
  type SourceRef,
  type TopologyId,
  type TopologyKind,
} from '@code3d/core/tooling';
import {
  File,
  FilePlus,
  FolderOpen,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  X,
} from 'lucide';
import {reaction} from 'mobx';
import brandMark from '../../../assets/brand/mark.svg?raw';
import {AgentConnections} from './agent/connections';
import {AgentObserver} from './agent/observer';
import {AgentPanel} from './agent/panel';
import {AgentProjectSession, type AgentUpdate} from './agent/project-session';
import {AgentRenderHistory} from './agent/render-history';
import {
  CodeEditor,
  type ActiveFileChangeReason,
  type CompletionFocus,
  type ProjectEditorChange,
} from './editor';
import {compilationPhaseLabels} from './model/compilation-progress';
import type {
  DesignArgumentContext,
  DesignContext,
  DesignInvocation,
  EdgeArgumentTarget,
  ModelModule,
  TopologySelectionScope,
} from './model/compiler';
import {ModelCompilerClient} from './model/compiler-client';
import {ModelDiagnosticError, type ModelDiagnostic} from './model/diagnostic';
import {
  elementSourceDecoration,
  namedElementDecorations,
} from './model/element-decorations';
import {originDecoration} from './model/origin-decorations';
import {
  ModelPreviewState,
  type ModelPreviewRequest,
} from './model/preview-state';
import {sourceDecorationProviders} from './model/source-decorations';
import {sourceParameterAt} from './model/tool-arguments';
import {isToolSelectionParameter} from './model/tool-parameter-config';
import type {
  ToolArgumentEditTarget,
  ToolArgumentSource,
  ToolSelectionParameterSchema,
  ToolSignatureSchema,
} from './model/tool-schema';
import {viewportDiagnostic} from './model/viewport-diagnostic';
import {ViewportToolFeedback} from './ui/viewport-tool-feedback';
import {
  BrowserPackageManager,
  PackageInstallationError,
} from './project/browser-package-manager';
import {
  browserPackageFiles,
  developmentWorkspaces,
} from './project/browser-packages';
import {bundledExamples} from './project/bundled-examples';
import {defaultProject} from './project/default-project';
import {
  pickProjectDirectory,
  projectDirectoryPermission,
  rememberProjectDirectory,
  requestProjectDirectoryPermission,
  storedProjectDirectory,
  supportsProjectDirectories,
} from './project/directory-access';
import {
  listProjectEntries,
  readProjectTextFile,
  searchProjectEntries,
  type ProjectEntry,
} from './project/file-operations';
import {decodeProjectFile} from './project/file-reader';
import {filePathFromRoute, fileRoute} from './project/file-route';
import type {BrowserProjectFileSystem} from './project/filesystem';
import {
  openBrowserProjectFileSystem,
  openDirectoryProjectFileSystem,
} from './project/filesystem';
import {mapProjectIO} from './project/io';
import {
  addPackageDependency,
  packageInstallDirectory,
  parsePackageManifest,
} from './project/package-manifest';
import {
  isSourceFile,
  normalizeProjectPath,
  projectDirectory as parentProjectDirectory,
  type ModelProject,
} from './project/project';
import {ProjectPackages} from './project/project-packages';
import {WorkspaceFileReader} from './project/workspace-packages';
import './style.css';
import {
  contextualParameterIntent,
  contextualParameterView,
  contextualToolParameters,
  validContextualParameter,
  type ContextualToolParameterState,
} from './tools/contextual-tool-parameters';
import {spatialIntent} from './tools/model-spatial-tool';
import {SketchEditorController} from './tools/sketch-editor-controller';
import {
  ToolEngine,
  type ToolCommitOptions,
  type ToolIntent,
  type ToolPreview,
  type ToolSession,
} from './tools/tool-system';
import {topologyIdExpression} from './tools/topology-expression';
import type {
  TransformGizmoBinding,
  TransformGizmoEvent,
} from './tools/transform-gizmo';
import {AgentRenderView} from './ui/agent-renders';
import {
  ContextualToolPanel,
  type ContextualToolPanelView,
} from './ui/contextual-tool-panel';
import {DockPanelCoordinator} from './ui/dock-panels';
import {EditorSplitLayout} from './ui/editor-split-layout';
import {ElementsPanel} from './ui/elements-panel';
import {createIcon} from './ui/icons';
import {ImageExportDialog} from './ui/image-export';
import {ModelExportDialog} from './ui/model-export';
import {ProjectTree, askInstallPackage} from './ui/project-tree';
import {SourceEditPopover} from './ui/source-edit-popover';
import {ViewportContextMenu} from './ui/viewport-context-menu';
import {ViewportEmptyState} from './ui/viewport-empty-state';
import {ViewportGridScale} from './ui/viewport-grid-scale';
import {
  ModelViewport,
  type Occurrence,
  type TopologySelectionEvent,
} from './viewport';

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
await projectFileSystem.initialize(
  directoryConnected
    ? undefined
    : async () => {
        await mapProjectIO(defaultProject.files, file =>
          projectFileSystem.writeFile(file.path, file.source),
        );
      },
);
await projectFileSystem.syncDirectory(
  bundledExamples,
  directoryConnected
    ? async () => {
        const entries = await projectFileSystem.list('/');
        return (
          entries.every(entry => entry.name === '.code3d') &&
          window.confirm(
            'This folder is empty. Create bundled examples in /examples?',
          )
        );
      }
    : undefined,
);
const localPackageFiles = directoryWorkspaceId
  ? new WorkspaceFileReader(
      projectFileSystem,
      browserPackageFiles,
      developmentWorkspaces,
    )
  : projectFileSystem;
const requestedFile = filePathFromRoute(window.location.hash);
let initialFileError: unknown;
const initialProject: ModelProject = await loadInitialProject();
const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element.');
}

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="https://www.code3d.org/" target="_blank" rel="noopener noreferrer" aria-label="Code3D home (opens in a new tab)">
        <span class="brand-mark" aria-hidden="true">${brandMark}</span>
        <span>Code3D</span>
        <span class="prototype-tag">prototype 01</span>
      </a>
      <div class="topbar-actions">
        <button class="quiet-button" id="retry-save-button" type="button" hidden>Retry saving</button>
        <div class="agent-nav">
          <button class="quiet-button button-primary agent-connect-button" id="agents-button" type="button">Connect Agent</button>
        </div>
      </div>
    </header>

    <main class="workspace" id="workspace">
      <section class="pane editor-pane">
        <div class="editor-workspace">
          <aside class="project-explorer" id="project-explorer" aria-label="Project files">
            <header>
              <button class="project-location" id="project-location" type="button" aria-expanded="false" aria-controls="project-storage-menu"></button>
              <div class="project-context-menu project-storage-menu" id="project-storage-menu" popover="auto" role="group" aria-label="Project storage">
                <button id="reconnect-folder-button" type="button" hidden>Reconnect folder</button>
                <button id="reload-folder-button" type="button" hidden>Reload folder</button>
                <button id="browser-storage-button" type="button" hidden>Use browser storage</button>
              </div>
              <div class="project-actions">
                <button id="open-folder-button" type="button" title="Open folder" aria-label="Open folder"></button>
                <button id="new-file-button" type="button" title="New file" aria-label="New file"></button>
                <button id="new-folder-button" type="button" title="New folder" aria-label="New folder"></button>
                <button id="refresh-files-button" type="button" title="Refresh files and dependencies" aria-label="Refresh files and dependencies"></button>
              </div>
            </header>
            <nav class="project-tree" id="project-tree"></nav>
          </aside>
          <div class="pane-resizer project-explorer-resizer" id="project-explorer-resizer" role="separator" aria-label="Resize file explorer" aria-orientation="vertical" aria-controls="project-explorer" tabindex="0" title="Drag to resize · Arrow keys to adjust"></div>
          <section class="editor-document" id="editor-document">
            <div class="editor-tab-bar">
              <button class="project-explorer-toggle" id="project-explorer-toggle" type="button" aria-controls="project-explorer"></button>
              <nav class="editor-tabs" id="editor-tabs" aria-label="Open files"></nav>
            </div>
            <div class="editor-host" id="editor-host"></div>
            <div class="editor-empty-state" id="editor-empty-state" hidden>Open a file from the explorer</div>
          </section>
        </div>
        <div class="error-bar" id="error-bar" hidden></div>
        <div class="pane-resizer workspace-resizer" id="workspace-resizer" role="separator" aria-label="Resize code editor" aria-orientation="vertical" aria-controls="editor-document" tabindex="0" title="Drag to resize · Arrow keys to adjust"></div>
      </section>

      <section class="pane preview-pane">
        <div class="viewport-host" id="viewport-host">
          <div class="viewport-empty-state" id="viewport-empty-state" role="status" aria-live="polite" hidden>
            <span class="viewport-preview-selection" aria-hidden="true">
              <span class="viewport-preview-word"><span class="viewport-preview-text"></span><span class="viewport-preview-caret"></span></span>
            </span>
            <strong>Select to preview</strong>
          </div>
          <div class="viewport-feedback-stack" id="viewport-feedback-stack">
            <div class="viewport-diagnostic-stack" id="viewport-diagnostic-stack" role="status" aria-live="polite" aria-atomic="true" hidden></div>
          </div>
          <div class="viewport-header">
            <div class="viewport-mode" role="group" aria-label="Viewport mode">
              <button id="viewport-mode-modeling" type="button" aria-pressed="true" title="Show modeling guides and outlines">Modeling</button>
              <button id="viewport-mode-render" type="button" aria-pressed="false" title="Show the model without guides or outlines · Also applies to image export">Render</button>
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
          </div>
          <div class="viewport-dock-panels">
            <aside class="dock-panel design-arguments-panel" id="design-arguments-panel" aria-label="Design arguments" hidden>
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
const viewportEmptyState = new ViewportEmptyState(
  requiredElement('viewport-empty-state'),
);
const previewState = new ModelPreviewState();
const errorBar = requiredElement('error-bar');
const designArgumentsPanel = requiredElement('design-arguments-panel');
const designArgumentsCount = requiredElement('design-arguments-count');
const designArgumentsFunction = requiredElement('design-arguments-function');
const designArgumentsOptions = requiredElement('design-arguments-options');
const elements = requiredElement('elements');
const elementsCount = requiredElement('elements-count');
const viewportFeedbackStack = requiredElement('viewport-feedback-stack');
const viewportDiagnosticStack = requiredElement('viewport-diagnostic-stack');
// Keep sketch numeric entry above both compact feedback and expanded diffs.
new ResizeObserver(([entry]) => {
  viewportHost.style.setProperty(
    '--viewport-feedback-height',
    `${entry.borderBoxSize[0].blockSize}px`,
  );
}).observe(viewportFeedbackStack);
const viewportStatus = requiredElement('viewport-status');
const viewportStatusLabel = requiredElement('viewport-status-label');
const projectTree = requiredElement('project-tree');
const projectExplorer = requiredElement('project-explorer');
const projectExplorerToggle = requiredElement<HTMLButtonElement>(
  'project-explorer-toggle',
);
const editorTabs = requiredElement('editor-tabs');
const projectLocation = requiredElement<HTMLButtonElement>('project-location');
const projectStorageMenu = requiredElement('project-storage-menu');
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
const newFileButton = requiredElement<HTMLButtonElement>('new-file-button');
const newFolderButton = requiredElement<HTMLButtonElement>('new-folder-button');
const refreshFilesButton = requiredElement<HTMLButtonElement>(
  'refresh-files-button',
);
openFolderButton.append(createIcon(FolderOpen));
newFileButton.append(createIcon(FilePlus));
newFolderButton.append(createIcon(FolderPlus));
refreshFilesButton.append(createIcon(RefreshCw));

projectLocation.addEventListener('click', () => {
  if (projectStorageMenu.matches(':popover-open')) {
    projectStorageMenu.hidePopover();
    return;
  }
  projectStorageMenu.showPopover();
  const anchor = projectLocation.getBoundingClientRect();
  const menu = projectStorageMenu.getBoundingClientRect();
  projectStorageMenu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - menu.width - 8))}px`;
  projectStorageMenu.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - menu.height - 8))}px`;
});
projectStorageMenu.addEventListener('toggle', () => {
  projectLocation.setAttribute(
    'aria-expanded',
    String(projectStorageMenu.matches(':popover-open')),
  );
});
projectStorageMenu.addEventListener('click', event => {
  if ((event.target as Element).closest('button'))
    projectStorageMenu.hidePopover();
});
window.addEventListener('resize', () => projectStorageMenu.hidePopover());

const projectExplorerStorageKey = 'code3d:project-explorer-expanded';
setProjectExplorerExpanded(
  localStorage.getItem(projectExplorerStorageKey) !== 'false',
);
projectExplorerToggle.addEventListener('click', () => {
  setProjectExplorerExpanded(projectExplorer.hidden === true);
  localStorage.setItem(
    projectExplorerStorageKey,
    String(!projectExplorer.hidden),
  );
});

new EditorSplitLayout(
  requiredElement('workspace'),
  projectExplorer,
  requiredElement('workspace-resizer'),
  requiredElement('project-explorer-resizer'),
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
  initialProject.files[0]?.path,
);
replaceFileRoute(codeEditor.currentFile());
const packageManager = !directoryWorkspaceId
  ? new BrowserPackageManager(
      projectFileSystem as BrowserProjectFileSystem,
      progress => projectDirectory.setPackageProgress(progress),
      undefined,
      async ({directory}) => {
        await codeEditor.refreshPackageInstallation(
          directory,
          projectFileSystem,
        );
        await projectDirectory.refresh();
        renderProjectNavigation();
      },
      developmentWorkspaces,
    )
  : undefined;
const packageFiles = packageManager?.dependencies ?? localPackageFiles;
const navigationPackages = new ProjectPackages(
  localPackageFiles,
  browserPackageFiles,
);
codeEditor.fileReader = {
  async readFile(path) {
    // Editable project files retain their source, not runtime package metadata.
    if (!path.includes('/node_modules/'))
      return projectFileSystem.readFile(path);
    // Browsing an already installed file does not wait for a replacement download.
    const installed = await localPackageFiles.readFile(path);
    if (installed !== undefined) return installed;
    await navigationPackages.update(
      codeEditor.project(),
      codeEditor.currentFile() ?? '/model.ts',
    );
    return navigationPackages.readFile(path);
  },
  async stat(path) {
    if (!path.includes('/node_modules/')) return projectFileSystem.stat(path);
    return (
      (await localPackageFiles.stat(path)) ?? navigationPackages.stat(path)
    );
  },
};
const preparePackages = async (_project: ModelProject, file: string) => {
  if (!packageManager) return;
  await agentProject.flush();
  await packageManager.prepare(file);
};
const compiler = new ModelCompilerClient(
  packageFiles,
  language => codeEditor.setProjectLanguage(language),
  preparePackages,
  directoryWorkspaceId ? `directory:${directoryWorkspaceId}` : 'browser',
);
const retrySaveButton = requiredElement<HTMLButtonElement>('retry-save-button');
const agentObserver = new AgentObserver(
  packageFiles,
  () => agentProject.currentRevision,
  preparePackages,
);
const agentRenders = new AgentRenderHistory();
const agentProject = new AgentProjectSession(
  projectFileSystem,
  codeEditor,
  request => agentObserver.observe(request),
  error => showProjectIssue(error),
);
const projectDirectory = new ProjectTree(projectTree, {
  async entries(directory) {
    const entries = new Map(
      (await listProjectEntries(projectFileSystem, directory)).map(entry => [
        entry.path,
        entry,
      ]),
    );
    for (const path of agentProject.unsavedFilePaths()) {
      if (parentProjectDirectory(path) === directory)
        entries.set(path, {path, kind: 'file'} satisfies ProjectEntry);
    }
    return [...entries.values()];
  },
  searchEntries: (cancelled, onEntries) =>
    searchProjectEntries(projectFileSystem, cancelled, onEntries),
  onOpenFile: (path, takeFocus) => activateProjectFile(path, takeFocus),
  onOperation: operation => agentProject.changeEntries(operation),
  examples: {directory: bundledExamples.directory, reset: resetExamples},
  onInstallPackage: packageManager ? installProjectPackage : undefined,
  onUpdateDependencies: packageManager ? updateProjectDependencies : undefined,
  async onClearBuildCache() {
    await compiler.clearBuildCache();
    await runModel();
  },
  onBusy: busy => {
    if (busy) fileOpenVersion++;
    codeEditor.setReadOnly(busy);
    for (const button of [newFileButton, newFolderButton, refreshFilesButton])
      button.disabled = busy;
  },
});
codeEditor.onAgentLocations(locations =>
  projectDirectory.setAgentLocations(locations),
);
agentProject.onEntriesChange(reason => {
  void projectDirectory.refresh();
  if (reason === 'operation') requestModelUpdate(0);
});
const agentConnections = new AgentConnections(
  codeEditor,
  agentProject,
  agentRenders,
  directoryWorkspaceId
    ? directoryConnected
      ? `directory:${directoryWorkspaceId}`
      : undefined
    : 'browser',
);
const agentRenderView = new AgentRenderView(
  viewportHost,
  agentRenders,
  agentConnections,
);
const agentPanel = new AgentPanel(
  agentConnections,
  agentProject,
  requiredElement<HTMLButtonElement>('agents-button'),
);
const stopAgentRevision = reaction(
  () => agentProject.currentRevision,
  () => agentObserver.invalidate(),
);
const stopSaveStatus = reaction(
  () => agentProject.hasUnsaved,
  unsaved => {
    retrySaveButton.hidden = !unsaved;
  },
  {fireImmediately: true},
);
window.addEventListener(
  'pagehide',
  () => {
    stopAgentRevision();
    stopSaveStatus();
    stopAgentFollow();
    stopAgentUpdates();
    agentConnections.dispose();
    stopViewportModes();
    stopPreviewPresentation();
    viewportGridScale.dispose();
    toolFeedback.dispose();
    sketchEditor.dispose();
  },
  {once: true},
);
window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload();
});
retrySaveButton.addEventListener('click', () => {
  void agentProject.retrySaves().catch(showProjectIssue);
});
window.addEventListener('beforeunload', event => {
  if (agentProject.hasUnsaved) {
    event.preventDefault();
    event.returnValue = '';
  }
});
async function installProjectPackage(selectedDirectory: string): Promise<void> {
  await agentProject.flush();
  const directory = await packageInstallDirectory(
    projectFileSystem,
    selectedDirectory,
  );
  const specifier = await askInstallPackage(directory);
  if (!specifier) return;
  const path = normalizeProjectPath(directory + '/package.json');
  await packageManager!.install(directory, async () => {
    await agentProject.update(async () => {
      const bytes = await projectFileSystem.readFile(path);
      const manifest =
        bytes === undefined
          ? undefined
          : parsePackageManifest(decodeProjectFile(bytes), path);
      const updated = addPackageDependency(manifest, specifier);
      codeEditor.applyFiles([
        {path, content: JSON.stringify(updated, null, 2) + '\n'},
      ]);
      await codeEditor.openFile(path);
    });
    await agentProject.flush();
  });
}

async function updateProjectDependencies(directory: string): Promise<void> {
  await packageManager!.update(directory, () => agentProject.flush());
}

let sourcePreviewDiagnostic: ModelDiagnostic | undefined;
let compileTimer: number | undefined;
let completionPreviewTimer: number | undefined;
let positionToolSession: ToolSession | undefined;
let positionToolInterruptedCompile = false;
let edgeSelectionTool: EdgeSelectionTool | undefined;
let topologyReferenceSelectionTool: TopologyReferenceSelectionTool | undefined;
let edgeEditSession: EdgeEditSession | undefined;
let edgeEditSessionCounter = 0;
let contextualTool: ContextualToolState | undefined;
let contextualToolCounter = 0;
const toolParameterCommitTimers = new Map<string, number>();
let fileOpenVersion = 0;
let preferredEvaluationContextId: string | undefined;
let selectedDesignContextId: string | undefined;
let selectedDesignInvocation: DesignInvocation | undefined;
let pendingAgentFollow: AgentUpdate | undefined;
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
  availableIds: readonly TopologyId[];
  selectedIds: readonly TopologyId[];
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
  onViewChange: observeViewportTarget,
  isViewVisible: () =>
    sketchEditor.navigation.gridStep === undefined && !previewState.empty,
  onSourcePreviewDiagnostic: diagnostic => {
    sourcePreviewDiagnostic = diagnostic;
    refreshViewportFeedback();
  },
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
  sourceDecorationProviders,
});
const viewportModes = (['modeling', 'render'] as const).map(mode => ({
  mode,
  button: requiredElement<HTMLButtonElement>(`viewport-mode-${mode}`),
}));
for (const {mode, button} of viewportModes) {
  button.addEventListener('click', () => {
    viewport.setRenderMode(mode);
  });
}
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
        previewState.module !== scene.module ||
        sourceVersion !== codeEditor.sourceVersion() ||
        previewState.sourceVersion !== sourceVersion
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
  onPreview: preview => {
    viewport.clearDecorations(elementsDecorationOwner);
    const occurrence = viewport.getSelected();
    const sourceElement = viewport.sourceEvaluation()?.evaluation.element;
    const element = preview?.kind === 'reference' ? preview.element : undefined;
    const previewsSourceElement =
      element !== undefined &&
      occurrence !== undefined &&
      sourceElement?.nodeId === occurrence.node.nodeId &&
      sourceElement.name === element.name &&
      sourceElement.kind === element.kind;
    viewport.setSourceDecorationVisible(
      elementSourceDecoration.id,
      preview === undefined || previewsSourceElement,
    );
    if (!preview || !occurrence || previewsSourceElement) return;
    viewport.setDecorations(
      elementsDecorationOwner,
      preview.kind === 'reference'
        ? namedElementDecorations(occurrence.node, preview.element)
        : [
            {
              kind: 'topology',
              id: 'element-topology',
              nodeId: occurrence.node.nodeId,
              mesh: occurrence.node.mesh!,
              topologyKind: preview.topologyKind,
              ids: [preview.id],
              transform: {
                position: [0, 0, 0],
                quaternion: [0, 0, 0, 1],
                scale: [1, 1, 1],
              },
              appearance: {color: '#63dcff'},
            },
          ],
      {occurrenceKeys: [occurrence.key]},
    );
  },
});
const toolFeedback = new ViewportToolFeedback(viewportFeedbackStack);
const sourceEditPopover = new SourceEditPopover(
  viewportFeedbackStack,
  sourceRef => codeEditor.revealSource(sourceRef, true),
);
const contextualToolPanel = new ContextualToolPanel(viewportHost, {
  onParameterInput: updateContextualToolParameter,
  onParameterCommit: commitContextualToolParameter,
  onAction: runContextualToolAction,
});
codeEditor.setParameterFocusHandler(() => {
  const scope = viewport.sourceEvaluation();
  const cursor = codeEditor.cursorSource();
  if (
    !scope ||
    !cursor ||
    contextualTool?.targetId !== scope.target.id ||
    contextualTool.contextId !== scope.evaluation.contextId
  )
    return false;
  const parameter = sourceParameterAt(
    scope.target,
    cursor.file,
    cursor.offset,
    ref => codeEditor.resolveSourceRef(ref),
  );
  return (
    parameter !== undefined &&
    contextualToolPanel.focusParameter(parameter.name)
  );
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
const sketchEditor = new SketchEditorController(viewportHost, {
  reportResult: (operation, error) =>
    toolFeedback.report(`sketch:${operation}`, error),
  solve: (layers, drag) => compiler.previewSketchDrag(layers, drag),
  resolveSourceRef: ref => codeEditor.resolveSourceRef(ref),
  readSource: ref => {
    const current = codeEditor.resolveSourceRef(ref);
    return current && codeEditor.readSource(current);
  },
  commit: intent =>
    commitToolSession(toolEngine.begin(`sketch:${intent.layer}`), intent),
});

const viewportGridScale = new ViewportGridScale(
  viewportFeedbackStack,
  () => sketchEditor.navigation.gridStep ?? viewport.gridStep,
);
const stopViewportModes = reaction(
  () => viewport.renderMode,
  mode => {
    for (const candidate of viewportModes)
      candidate.button.setAttribute(
        'aria-pressed',
        String(candidate.mode === mode),
      );
  },
  {fireImmediately: true},
);
const stopPreviewPresentation = reaction(
  () => ({
    status: previewState.presentation,
    empty: previewState.empty,
    hint: previewState.showHint,
    retaining: previewState.retainingView,
  }),
  ({status, empty, hint, retaining}) => {
    viewportStatus.dataset.state = status.state;
    viewportStatusLabel.textContent = status.label;
    viewportStatus.setAttribute('aria-busy', String(status.state === 'busy'));
    viewportHost.dataset.empty = String(empty);
    viewportEmptyState.setVisible(hint);
    for (const element of viewportHost.querySelectorAll<HTMLElement>(
      '.viewport-canvas, .sketch-editor, .viewport-mode, .viewport-dock-panels, .viewport-coordinate-reference',
    ))
      element.inert = retaining;
  },
  {fireImmediately: true},
);

codeEditor.onChange(change => {
  const toolChange = change.kind === 'content' && change.origin === 'tool';
  const historyChange =
    change.kind === 'content' &&
    (change.origin === 'undo' || change.origin === 'redo');
  const editingHistoryChange =
    historyChange && handleContextualEditingHistory(change);
  if (!toolChange && !editingHistoryChange) abandonContextualTool();
  if (toolChange) renderContextualToolPanel();
  if (!toolChange) sketchEditor.invalidate();
  agentProject.recordEditorChange(change);
  if (!toolChange) sourceEditPopover.dismiss();
  if (change.kind !== 'content') renderProjectNavigation();
  requestModelUpdate(toolChange || historyChange ? 0 : 420);
});

codeEditor.onCursorOffset(({file, offset}) => {
  pendingAgentFollow = undefined;
  if (previewState.pendingFile) return;
  const matched = viewport.selectBySourceOffset(
    file,
    offset,
    undefined,
    preferredEvaluationContextId,
  );
  if (!matched && previewState.module) {
    const designContext = designContextAt(previewState.module, file, offset);
    if (
      designContext &&
      previewState.module.activeDesignContextId !== designContext.id
    ) {
      activateDesignContext(designContext.id);
      return;
    }
  }
  preferredEvaluationContextId =
    viewport.sourceEvaluation()?.evaluation.contextId;
  if (
    selectedDesignInvocation &&
    preferredEvaluationContextId !== selectedDesignContextId
  ) {
    selectedDesignInvocation = undefined;
    selectedDesignContextId = undefined;
  }
  const occurrence = viewport.getSelected();
  if (occurrence) {
    selectOccurrence(occurrence, false);
  } else if (previewState.module) {
    renderDesignArguments(previewState.module);
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
  toolFeedback.dismiss();
  if (reason === 'reset') sketchEditor.navigation.reset();
  activatePreviewFile(reason === 'reset');
  pendingAgentFollow = undefined;
  selectedDesignInvocation = undefined;
  finishContextualTool();
  refreshViewportFeedback();
  renderProjectNavigation();
  if (!applyingFileRoute) updateFileRoute(path, reason);
  preferredEvaluationContextId = undefined;
  selectedDesignContextId = undefined;
  requestModelUpdate(0);
});

function followAgentUpdate(update: AgentUpdate): void {
  if (agentConnections.followingAgentId !== update.agentId) return;
  pendingAgentFollow = undefined;
  fileOpenVersion++;
  if (update.kind !== 'apply') {
    pendingAgentFollow = update;
    const cancelled = () =>
      pendingAgentFollow !== update ||
      agentConnections.followingAgentId !== update.agentId;
    if (update.kind === 'list') setProjectExplorerExpanded(true);
    const navigation =
      update.kind === 'read'
        ? activateProjectFile(update.path, 'tab', false, cancelled)
        : projectDirectory.focusDirectory(update.path, cancelled);
    void navigation
      .catch(error => {
        if (!cancelled()) projectDirectory.showError(error);
      })
      .finally(() => {
        if (pendingAgentFollow === update) pendingAgentFollow = undefined;
      });
    return;
  }
  if (!update.cursor) return;
  finishContextualTool();
  activeCompletionFocus = undefined;
  window.clearTimeout(completionPreviewTimer);
  completionPreviewTimer = undefined;
  codeEditor.revealSource(update.cursor, false, 'start');
  const invocation = {
    file: update.cursor.file,
    offset: update.cursor.start,
    ...(update.arguments === undefined ? {} : {arguments: update.arguments}),
  };
  selectedDesignInvocation =
    invocation.arguments === undefined ? undefined : invocation;
  selectedDesignContextId = undefined;
  preferredEvaluationContextId = undefined;
  pendingAgentFollow = update;
  void runModel(invocation);
}

const stopAgentUpdates = agentProject.onAgentUpdate(followAgentUpdate);
const stopAgentFollow = reaction(
  () => agentConnections.followingAgentId,
  agentId => {
    pendingAgentFollow = undefined;
    const update = agentId && agentProject.latestAgentUpdate(agentId);
    if (update) followAgentUpdate(update);
  },
);

// A later user gesture takes precedence over a view requested before compilation.
for (const event of ['pointerdown', 'wheel', 'keydown'])
  document.addEventListener(
    event,
    () => {
      pendingAgentFollow = undefined;
    },
    {capture: true, passive: true},
  );

window.addEventListener('popstate', () => {
  const path = filePathFromRoute(window.location.hash);
  if (window.location.hash !== fileRoute(undefined) && !path) {
    replaceFileRoute(codeEditor.currentFile());
    return;
  }
  void activateProjectFile(path, false, true).catch(error => {
    projectDirectory.showError(error);
    replaceFileRoute(codeEditor.currentFile());
  });
});

newFileButton.addEventListener(
  'click',
  () => void projectDirectory.create('file'),
);
newFolderButton.addEventListener(
  'click',
  () => void projectDirectory.create('directory'),
);
refreshFilesButton.addEventListener('click', () => {
  compiler.refreshDependencies();
  void projectDirectory.refresh();
  void runModel();
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

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && viewport.cancelPositionTool()) {
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
void projectDirectory.refresh();
if (initialFileError) projectDirectory.showError(initialFileError);
runModel();

function renderProjectLocation(): void {
  if (directoryConnected) {
    projectLocation.textContent = storedDirectoryHandle.name;
    projectLocation.dataset.kind = 'local';
    projectLocation.title = `Files are stored directly in ${storedDirectoryHandle.name}`;
    openFolderButton.title = 'Change folder';
    openFolderButton.setAttribute('aria-label', 'Change folder');
    reconnectFolderButton.hidden = true;
    reloadFolderButton.hidden = false;
    browserStorageButton.hidden = false;
    return;
  }

  projectLocation.textContent = 'Browser storage';
  projectLocation.dataset.kind = 'browser';
  projectLocation.title = 'Files are stored in this browser';
  projectLocation.disabled = storedDirectoryHandle === undefined;
  openFolderButton.title = 'Open folder';
  openFolderButton.setAttribute('aria-label', 'Open folder');
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
    await agentProject.flush();
    const handle = await pickProjectDirectory();
    if (!handle) return;
    const workspaceId = await rememberProjectDirectory(handle);
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
  try {
    await agentProject.flush();
    window.location.reload();
  } catch (error) {
    showProjectIssue(error);
    setProjectLocationBusy(false);
  }
}

async function useBrowserStorage(): Promise<void> {
  setProjectLocationBusy(true);
  try {
    await agentProject.flush();
    openBrowserWorkspace();
  } catch (error) {
    showProjectIssue(error);
    setProjectLocationBusy(false);
  }
}

function openDirectoryWorkspace(workspaceId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('workspace', workspaceId);
  url.hash = '';
  window.location.replace(url);
}

function openBrowserWorkspace(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('workspace');
  url.hash = '';
  window.location.replace(url);
}

function setProjectLocationBusy(busy: boolean): void {
  openFolderButton.disabled = busy || !supportsProjectDirectories();
  reconnectFolderButton.disabled = busy;
  reloadFolderButton.disabled = busy;
  browserStorageButton.disabled = busy;
}

async function resetExamples(): Promise<void> {
  try {
    const existing = await projectFileSystem.stat(bundledExamples.directory);
    if (
      !window.confirm(
        existing
          ? 'Reset bundled examples? Files under /examples will be replaced. Other project files will not change.'
          : 'Create bundled examples in /examples?',
      )
    )
      return;
    await agentProject.flush();
    await agentProject.update(async () => {
      await projectFileSystem.resetDirectory(bundledExamples);
      codeEditor.replaceDirectory(
        {files: bundledExamples.files},
        bundledExamples.directory,
      );
      await projectDirectory.refresh();
    });
  } catch (error) {
    showProjectIssue(error);
  }
}

async function loadInitialProject(): Promise<ModelProject> {
  if (window.location.hash === fileRoute(undefined)) return {files: []};
  if (requestedFile) {
    try {
      return {
        files: [
          {
            path: requestedFile,
            source: await readProjectTextFile(localPackageFiles, requestedFile),
          },
        ],
      };
    } catch (error) {
      initialFileError = error;
    }
  }
  const entries = await listProjectEntries(projectFileSystem, '/');
  const paths = entries
    .filter(entry => entry.kind === 'file' && isSourceFile(entry.path))
    .map(entry => entry.path);
  const path =
    ['/model.ts', '/index.ts'].find(path => paths.includes(path)) ??
    paths.find(path => !/\.d\.[cm]?ts$/.test(path));
  return {
    files: path
      ? [{path, source: await readProjectTextFile(projectFileSystem, path)}]
      : [],
  };
}

function updateFileRoute(
  path: string | undefined,
  reason: ActiveFileChangeReason,
): void {
  if (reason === 'switch') {
    pushFileRoute(path);
  } else {
    replaceFileRoute(path);
  }
}

function pushFileRoute(path: string | undefined): void {
  const route = fileRoute(path);
  if (window.location.hash === route) return;
  const url = new URL(window.location.href);
  url.hash = route.slice(1);
  window.history.pushState(null, '', url);
}

function replaceFileRoute(path: string | undefined): void {
  const route = fileRoute(path);
  if (window.location.hash === route) return;
  const url = new URL(window.location.href);
  url.hash = route.slice(1);
  window.history.replaceState(null, '', url);
}

function setProjectExplorerExpanded(expanded: boolean): void {
  projectExplorer.hidden = !expanded;
  projectExplorerToggle.replaceChildren(
    createIcon(expanded ? PanelLeftClose : PanelLeftOpen),
  );
  projectExplorerToggle.setAttribute('aria-expanded', String(expanded));
  const label = expanded ? 'Hide file explorer' : 'Show file explorer';
  projectExplorerToggle.setAttribute('aria-label', label);
  projectExplorerToggle.title = label;
}

function renderProjectNavigation(): void {
  const active = codeEditor.currentFile();
  requiredElement('editor-empty-state').hidden = active !== undefined;
  projectDirectory.setActiveFile(active);
  editorTabs.replaceChildren(
    ...codeEditor.openedFiles().map(path => {
      const tab = document.createElement('span');
      tab.className = 'editor-tab';
      tab.classList.toggle('active', path === active);
      const open = document.createElement('button');
      open.type = 'button';
      const label = document.createElement('span');
      label.className = 'editor-tab-label';
      label.textContent = path.slice(path.lastIndexOf('/') + 1);
      open.append(createIcon(File, 'project-entry-icon file-icon'), label);
      open.title = path;
      open.addEventListener('click', () => codeEditor.switchFile(path, true));
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'editor-tab-close';
      close.append(createIcon(X));
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

async function activateProjectFile(
  path: string | undefined,
  takeFocus: boolean | 'tab' = false,
  fromHistory = false,
  cancelled: () => boolean = () => false,
): Promise<void> {
  const version = ++fileOpenVersion;
  if (cancelled()) return;
  if (path && !codeEditor.fileState(path)) {
    let source: string;
    try {
      source = await readProjectTextFile(
        codeEditor.fileReader ?? projectFileSystem,
        path,
      );
    } catch (error) {
      if (version !== fileOpenVersion || cancelled()) return;
      throw error;
    }
    if (version !== fileOpenVersion || cancelled()) return;
    codeEditor.loadFile(path, source);
  }
  applyingFileRoute = fromHistory;
  try {
    codeEditor.switchFile(path, takeFocus === true);
    if (takeFocus === 'tab') {
      const tab = editorTabs.querySelector<HTMLButtonElement>(
        '.editor-tab.active > button',
      );
      tab?.scrollIntoView({block: 'nearest', inline: 'nearest'});
      tab?.focus({preventScroll: true});
    }
  } finally {
    applyingFileRoute = false;
  }
}

function showProjectIssue(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  refreshViewportFeedback();
  errorBar.textContent = message;
  errorBar.hidden = false;
}

function activeDesignContext(
  cursor = codeEditor.cursorSource(),
): DesignContext | undefined {
  if (selectedDesignInvocation) return {...selectedDesignInvocation, ...cursor};
  const context = previewState.module?.designArguments.find(
    context => context.id === selectedDesignContextId,
  );
  return context && {file: context.functionRef.file, id: context.id};
}

async function runModel(designContext = activeDesignContext()): Promise<void> {
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  viewport.restoreTransientPreview();
  const sourceVersion = codeEditor.sourceVersion();
  activatePreviewFile();
  const request = previewState.begin(sourceVersion);
  const file = previewState.file;
  if (!file) {
    compiler.cancel();
    errorBar.hidden = true;
    restoreModelStatus();
    return;
  }
  const following =
    pendingAgentFollow?.kind === 'apply' ? pendingAgentFollow : undefined;
  const designContextId =
    designContext && 'id' in designContext ? designContext.id : undefined;
  compilingDesignContextId = designContextId;
  previewState.showStatus('busy', 'Updating model');
  if (designContextId) {
    renderCurrentPanels();
  }
  errorBar.hidden = true;

  const stopProgress = reaction(
    () => compiler.phase,
    phase => {
      if (phase && previewState.isCurrent(request, codeEditor.sourceVersion()))
        previewState.showStatus('busy', compilationPhaseLabels[phase]);
    },
  );
  const stopRestore = reaction(
    () => compiler.restored,
    restored => {
      if (
        !restored ||
        restored.rootPath !== file ||
        !previewState.isCurrent(request, codeEditor.sourceVersion()) ||
        previewState.module
      )
        return;
      previewState.restore(request, restored.module);
      viewport.renderModule(restored.module, 'root');
      previewState.presented(hasViewportTarget());
      syncContextualTool();
    },
  );

  try {
    const selectedKey = viewport.getSelected()?.key ?? 'root';
    const nextModule = await compiler.compile(
      codeEditor.project(),
      file,
      designContext,
    );
    if (!previewState.isCurrent(request, codeEditor.sourceVersion())) return;
    const cursor = codeEditor.cursorSource();
    const focusedScope =
      cursor &&
      viewport.sourceEvaluationAt(
        nextModule,
        cursor.file,
        cursor.offset,
        preferredEvaluationContextId,
      );
    const focusedEvaluation = focusedScope?.evaluation;
    const availablePreview =
      focusedEvaluation &&
      (focusedEvaluation.runtime.outcome === 'completed' ||
        focusedScope?.target.tool?.arguments.some(
          argument => argument.target,
        )) &&
      (focusedEvaluation.nodeIds.some(id => nextModule.objects.has(id)) ||
        focusedEvaluation.sketchIds?.some(id => nextModule.sketches.has(id)));
    if (nextModule.diagnostic && previewState.module && !availablePreview) {
      previewState.fail(nextModule.diagnostic);
      compilingDesignContextId = undefined;
      finishContextualTool();
      sketchEditor.invalidate();
      renderCurrentPanels();
      if (await presentModelDiagnostic(request)) restoreModelStatus();
      return;
    }
    if (
      cursor &&
      !nextModule.sourceTargets.some(
        ({sourceRef}) =>
          sourceRef.file === cursor.file &&
          sourceRef.start <= cursor.offset &&
          cursor.offset <= sourceRef.end,
      )
    ) {
      const context = designContextAt(nextModule, cursor.file, cursor.offset);
      if (context && nextModule.activeDesignContextId !== context.id) {
        preferredEvaluationContextId = context.id;
        selectedDesignContextId = context.id;
        selectedDesignInvocation = undefined;
        void runModel({file: context.functionRef.file, id: context.id});
        return;
      }
    }
    previewState.accept(request, nextModule);
    codeEditor.setDesignArguments(nextModule.designArguments);
    sketchEditor.retain(
      nextModule.diagnostic,
      codeEditor.cursorSource(),
      nextModule.sketches,
    );
    codeEditor.trackSourceRefs([
      ...toolSourceRefs(nextModule),
      ...sketchEditor.sourceRefs(),
    ]);
    selectedDesignContextId = nextModule.activeDesignContextId;
    compilingDesignContextId = undefined;
    if (
      preferredEvaluationContextId === designContextId &&
      !nextModule.activeDesignContextId
    ) {
      preferredEvaluationContextId = undefined;
    }
    viewport.renderModule(
      nextModule,
      selectedKey,
      cursor ? {...cursor, contextId: preferredEvaluationContextId} : undefined,
    );
    preferredEvaluationContextId =
      viewport.sourceEvaluation()?.evaluation.contextId;
    const selected = viewport.getSelected();
    if (selected) {
      selectOccurrence(selected, false);
    } else {
      renderElementsPanel();
      renderDesignArguments(nextModule);
    }
    syncContextualTool();
    previewState.presented(hasViewportTarget());
    if (following && pendingAgentFollow === following) {
      pendingAgentFollow = undefined;
      if (
        agentConnections.followingAgentId === following.agentId &&
        !sketchEditor.hasTarget
      ) {
        if (following.mode) viewport.setRenderMode(following.mode);
        if (following.view) viewport.setView(resolveRenderView(following.view));
      }
    }
    if (!(await presentModelDiagnostic(request))) return;
    restoreModelStatus();
  } catch (error) {
    if (!previewState.isCurrent(request, codeEditor.sourceVersion())) return;
    compilingDesignContextId = undefined;
    const diagnostic =
      error instanceof ModelDiagnosticError ? error.diagnostic : undefined;
    if (previewState.pendingFile || previewState.retainingView)
      clearPresentedView();
    previewState.fail(diagnostic);
    finishContextualTool();
    sketchEditor.invalidate();
    renderCurrentPanels();
    if (!(await presentModelDiagnostic(request))) return;
    if (!diagnostic) {
      errorBar.textContent =
        error instanceof Error ? error.message : String(error);
      errorBar.hidden = error instanceof PackageInstallationError;
    }
    restoreModelStatus();
  } finally {
    stopProgress();
    stopRestore();
  }
}

function activatePreviewFile(reload = false): void {
  const file = codeEditor.currentFile();
  if (
    !previewState.activate(
      file && codeEditor.isModelFile(file) ? file : undefined,
      reload,
    )
  )
    return;
  compiler.cancel();
  sourcePreviewDiagnostic = undefined;
  compilingDesignContextId = undefined;
  codeEditor.setModelDiagnostics();
  codeEditor.setDesignArguments([]);
  codeEditor.trackSourceRefs([]);
  if (previewState.retainingView) sketchEditor.invalidate();
  else clearPresentedView();
  renderElementsPanel();
  renderDesignArguments(null);
  errorBar.hidden = true;
}

function clearPresentedView(): void {
  sketchEditor.hide();
  viewport.renderModule(null);
}

async function presentModelDiagnostic(
  request: ModelPreviewRequest,
): Promise<boolean> {
  const {diagnostic, warnings} = previewState;
  codeEditor.setModelDiagnostics([
    ...(diagnostic ? [diagnostic] : []),
    ...warnings,
  ]);
  refreshViewportFeedback();
  if (!diagnostic || diagnostic.sourceRef) {
    errorBar.hidden = true;
    return true;
  }
  const hasLanguageError = await codeEditor.hasLanguageError();
  if (!previewState.isCurrent(request, codeEditor.sourceVersion()))
    return false;
  errorBar.hidden = hasLanguageError;
  if (!hasLanguageError) {
    errorBar.textContent = [diagnostic.summary, diagnostic.details]
      .filter(Boolean)
      .join('\n');
  }
  return true;
}

function activeViewportDiagnostic(): ModelDiagnostic | undefined {
  const scope = sketchEditor.diagnosticScope;
  return (
    viewportDiagnostic(
      previewState.diagnostic,
      sourcePreviewDiagnostic,
      scope,
    ) ??
    [...previewState.warnings]
      .sort(
        (a, b) =>
          Number(!!b.relatedSketchIds?.includes(scope?.at(-1)?.id ?? '')) -
          Number(!!a.relatedSketchIds?.includes(scope?.at(-1)?.id ?? '')),
      )
      .find(warning => viewportDiagnostic(warning, undefined, scope))
  );
}

function refreshViewportFeedback(): void {
  observeViewportTarget();
  const diagnostic = activeViewportDiagnostic();
  viewportDiagnosticStack.replaceChildren();
  viewportDiagnosticStack.hidden = !diagnostic;
  if (!previewState.busy) restoreModelStatus();
  if (!diagnostic) return;

  const item = document.createElement('section');
  item.className = 'viewport-diagnostic';
  item.dataset.severity = diagnostic.severity ?? 'error';
  const summary = document.createElement('strong');
  summary.textContent = diagnostic.summary;
  item.append(summary);
  if (diagnostic.details) {
    const details = document.createElement('p');
    details.textContent = diagnostic.details;
    item.append(details);
  }
  for (const action of diagnostic.actions ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'viewport-diagnostic-action';
    button.textContent = action.label;
    const active = sketchEditor.diagnosticScope?.at(-1)?.id;
    const upstream =
      !!diagnostic.relatedSketchIds?.length &&
      (!active || !diagnostic.relatedSketchIds.includes(active));
    button.disabled =
      upstream || previewState.sourceVersion !== codeEditor.sourceVersion();
    if (upstream) button.title = 'Open the owning sketch to apply this fix.';
    button.addEventListener('click', () => {
      if (previewState.sourceVersion !== codeEditor.sourceVersion()) {
        refreshViewportFeedback();
        return;
      }
      if (
        commitToolSession(toolEngine.begin('diagnostic-fix'), action.intent)
      ) {
        refreshViewportFeedback();
      }
    });
    item.append(button);
  }
  viewportDiagnosticStack.append(item);
}

function handleCompletionFocus(focus: CompletionFocus | undefined): void {
  if (previewState.pendingFile) return;
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

  if (previewState.module) {
    const match = completionPreviewTarget(previewState.module, focus);
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

  previewState.invalidate();
  compiler.cancel();
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  previewState.showStatus('busy', `Rendering preview · ${focus.memberName}`);
  const revision = previewState.revision;
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
  const stopProgress = reaction(
    () => compiler.phase,
    phase => {
      if (
        phase &&
        revision === previewState.revision &&
        activeCompletionFocus === focus &&
        preview.sourceVersion === codeEditor.sourceVersion()
      )
        previewState.showStatus(
          'busy',
          `${compilationPhaseLabels[phase]} · ${focus.memberName}`,
        );
    },
  );
  try {
    const module = await compiler.compile(
      preview.project,
      preview.cursor.file,
      activeDesignContext(preview.cursor),
      undefined,
      false,
    );
    if (
      revision !== previewState.revision ||
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
    if (revision === previewState.revision && activeCompletionFocus === focus) {
      restoreModelStatus();
    }
  } finally {
    stopProgress();
  }
}

function resumeModelAfterCompletion(): void {
  previewState.invalidate();
  compiler.cancel();
  previewState.showStatus('busy', 'Updating model');
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
  pendingAgentFollow = undefined;
  activeCompletionFocus = undefined;
  window.clearTimeout(completionPreviewTimer);
  completionPreviewTimer = undefined;
  viewport.restoreTransientPreview();
  renderElementsPanel(viewport.getSelected());
  previewState.showStatus('busy', 'Updating model');
  previewState.invalidate();
  compiler.cancel();
  refreshViewportFeedback();
  if (codeEditor.currentFile()) scheduleModelRun(delay);
  else void runModel();
}

function selectCompiledEvaluationContext(
  contextId: string,
  design: boolean,
): boolean {
  if (!viewport.selectEvaluationContext(contextId)) return false;
  selectedDesignInvocation = undefined;
  cancelPendingDesignCompile();
  preferredEvaluationContextId = contextId;
  selectedDesignContextId = design ? contextId : undefined;
  const occurrence = viewport.getSelected();
  if (occurrence) selectOccurrence(occurrence, false);
  else renderDesignArguments(previewState.module);
  syncContextualTool();
  return true;
}

function activateDesignContext(contextId: string): void {
  selectedDesignInvocation = undefined;
  preferredEvaluationContextId = contextId;
  selectedDesignContextId = contextId;
  void runModel();
}

function cancelPendingDesignCompile(): void {
  if (!compilingDesignContextId) return;
  compilingDesignContextId = undefined;
  previewState.invalidate();
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
  if (previewState.module) renderDesignArguments(previewState.module);

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
  if (previewState.pendingFile) occurrence = undefined;
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
  if (!previewState.module) return;
  const compiledSource = preferredObjectSource(previewState.module, node);
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

function renderDesignArguments(module: ModelModule | null): void {
  const functionId = module ? inspectedFunctionId(module) : undefined;
  const contexts =
    module?.designArguments.filter(
      context => context.functionId === functionId,
    ) ?? [];
  designArgumentsPanel.hidden = contexts.length === 0;
  designArgumentsCount.textContent = String(contexts.length);
  designArgumentsFunction.textContent =
    contexts[0]?.functionName ?? 'No function context';
  designArgumentsOptions.replaceChildren();
  if (contexts.length === 0) return;

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
  if (!occurrence && previewState.module)
    renderDesignArguments(previewState.module);
}

function syncContextualTool(sourceTargetFocused = true): void {
  const scope = viewport.sourceEvaluation();
  if (
    sourceTargetFocused &&
    previewState.module &&
    previewState.sourceVersion === codeEditor.sourceVersion() &&
    scope?.evaluation.sketchIds?.[0]
  ) {
    sketchEditor.show(
      scope.evaluation.sketchIds[0],
      previewState.module.sketches,
      scope.target.sourceRef,
      JSON.stringify([
        codeEditor.currentFile(),
        previewState.module.activeDesignContextId ?? null,
      ]),
      previewState.module.objects,
    );
  } else if (
    (!sourceTargetFocused ||
      previewState.sourceVersion === codeEditor.sourceVersion()) &&
    !sketchEditor.retain(
      previewState.diagnostic,
      codeEditor.cursorSource(),
      previewState.module?.sketches ?? new Map(),
    )
  ) {
    sketchEditor.hide();
  }
  refreshViewportFeedback();
  if (!sourceTargetFocused) {
    finishContextualTool();
    return;
  }
  const previous = contextualTool;
  const continuesPrevious =
    previous !== undefined &&
    scope !== undefined &&
    scope.target.tool !== undefined &&
    previous.callId === scope.target.tool.callId &&
    previous.contextId === scope.evaluation.contextId &&
    previous.signature.id === scope.target.tool.signature.id;
  if (previewState.sourceVersion !== codeEditor.sourceVersion()) {
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
    return previewState.sourceVersion !== codeEditor.sourceVersion();
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
  const parameters = [...tool.parameters.values()].map(parameter => {
    const binding = parameter.binding;
    const sourceRef =
      binding?.kind === 'parameter'
        ? binding.usage.target.sourceRef
        : binding?.target.sourceRef;
    return {
      ...contextualParameterView(parameter),
      // Full-document formatting can invalidate source ranges before the next
      // compile replaces this panel. Do not accept edits that cannot be written.
      disabled: !sourceRef || !codeEditor.resolveSourceRef(sourceRef),
    };
  });
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
  let availableIds: readonly TopologyId[];
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
    selection.scope,
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
  scope?: TopologySelectionScope,
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
      scope,
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
            elements: tool.selectedIds.map(topologyIdExpression),
          }
        : topologyIdExpression(event.id),
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
  const visible = edgeIds
    .slice(0, 8)
    .map(edgeId => formatTopologyId('edge', edgeId));
  return edgeIds.length > visible.length
    ? `${visible.join(', ')} +${edgeIds.length - visible.length}`
    : visible.join(', ');
}

function formatTopologyIds(
  kind: TopologyKind,
  ids: readonly TopologyId[],
): string {
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

function sortedTopologyIds(ids: readonly TopologyId[]): TopologyId[] {
  return [...ids].sort(compareTopologyIds);
}

function sortedEdgeIds(edgeIds: readonly EdgeId[]): EdgeId[] {
  return [...edgeIds].sort(compareTopologyIds);
}

function interruptCompileForTool(): boolean {
  const scheduled = compileTimer !== undefined;
  const compiling = compiler.isCompiling();
  if (!scheduled && !compiling) return false;
  previewState.invalidate();
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
    if (previewState.sourceVersion === undefined) {
      viewport.cancelPositionTool();
      return;
    }
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
    if (event.kind === 'preview') return;
    showToolIssue('The position tool session expired. Start the drag again.');
    return;
  }

  if (event.kind === 'preview') {
    session.preview(positionIntent(event.binding, event.value));
    return;
  }

  if (Math.abs(event.value - event.binding.value) < 1e-9) {
    session.cancel();
    toolFeedback.report('model');
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
    return {
      ...parameterIntent(binding.target, value),
      completeArguments: binding.completeArguments,
    };
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
    const sourceRef =
      source.kind === 'omitted-argument'
        ? source.target.sourceRef
        : source.sourceRef;
    return `spatial:${sourceRef.file}:${sourceRef.start}:${sourceRef.end}`;
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
      [
        ...new Map(
          preview.objects.map(object => [object.nodeId, object]),
        ).values(),
      ].map(object => originDecoration(object.nodeId, object.spatial.origin)),
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
  const result = previewState.editSource(() => session.commit(intent, options));
  toolFeedback.report(
    intent.kind === 'sketch.edit' ? `sketch:${intent.change.kind}` : 'model',
    result.status === 'committed' ? undefined : result.reason,
  );
  if (result.status !== 'committed') return false;
  sourceEditPopover.show(codeEditor.sourceEditDiffs(result.plan.edits));
  return true;
}

function toolSourceRefs(module: ModelModule): SourceRef[] {
  const refs = [
    ...[...module.sketches.values()].flatMap(sketch =>
      sketch.definitionRef ? [sketch.definitionRef] : [],
    ),
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
  toolFeedback.report('model', message);
}

function sourceHistoryAction(
  event: KeyboardEvent,
): 'undo' | 'redo' | undefined {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return undefined;
  if (event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
  if (event.code === 'KeyY' && !event.shiftKey) return 'redo';
  return undefined;
}

function observeViewportTarget(): void {
  previewState.observeTarget(hasViewportTarget());
}

function hasViewportTarget(): boolean {
  return (
    viewport.hasRenderableGeometry() ||
    viewport.sourceEvaluation() !== undefined ||
    sketchEditor.hasTarget
  );
}

function restoreModelStatus(): void {
  const sketch = sketchEditor.diagnosticScope;
  const diagnostic = activeViewportDiagnostic();
  const state = sketch
    ? diagnostic && diagnostic.severity !== 'warning'
      ? 'error'
      : 'ready'
    : previewState.status;
  previewState.showStatus(
    state,
    state === 'error'
      ? 'Model error'
      : sketchEditor.isStale
        ? 'Last valid sketch'
        : 'Ready',
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
