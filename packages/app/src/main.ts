import {
  contextualToolContext,
  contextualToolCallId,
  contextualParameterAt,
  contextualToolSource,
  contextualToolActivation,
} from './tools/contextual-tool-context';
import {SpatialToolbar} from './ui/spatial-toolbar';
import {AnimationControls} from './ui/animation-controls';
import {ModelInputsPanel} from './ui/model-inputs';
import {ModelInputs} from './model/inputs';
import {relationSelfExpression} from './tools/source-expression';
import {ToolDragPreviewView} from './ui/tool-drag-preview';
import {movedExamplePaths} from '../render-samples/catalog';
import {resolveRenderView} from '@code3d/agent';
import {
  compareTopologyIds,
  formatTopologyId,
  isTopologyId,
  type EdgeId,
  type ModelSnapshotObject,
  type ParameterTarget,
  type SourceRef,
  type TopologyId,
  type TopologyKind,
} from '@code3d/core/tooling';
import {
  File,
  ChevronRight,
  FilePlus,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  X,
} from 'lucide';
import {
  autorun,
  compareStructural,
  observable,
  reaction,
  runInAction,
} from 'mobx';
import {appSettings} from './app-settings';
import {AppSettingsDialog} from './ui/app-settings';
import {showNewBrowserProjectDialog} from './ui/new-browser-project';
import {Submenu} from './ui/submenu';
import {RenderScenePreference} from './rendering/render-scene';
import {ViewportSceneSelector} from './ui/viewport-scene-selector';
import brandMark from '../../../assets/brand/mark.svg?raw';
import {AgentConnections} from './agent/connections';
import {AgentPersistence} from './agent/persistence';
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
import type {
  DesignArgumentContext,
  DesignContext,
  DesignInvocation,
  EdgeArgumentTarget,
  ModelModule,
  ModelExecutionConfig,
  TopologySelectionScope,
  SourceTarget,
} from './model/compiler';
import {ModelAnimation} from './model/animation';
import {ModelCompilerClient} from './model/compiler-client';
import {
  diagnosticFromError,
  describeDiagnosticCounts,
  type ModelDiagnostic,
} from './model/diagnostic';
import {namedElementDecorations} from './model/element-decorations';
import {
  ModelPreviewState,
  type ModelPreviewRequest,
} from './model/preview-state';
import {sourceDecorationProviders} from './model/source-decorations';
import {isToolSelectionParameter} from './model/tool-parameter-config';
import type {
  ToolArgumentEditTarget,
  ToolArgumentSource,
  ToolSelectionParameterSchema,
  ToolSignatureSchema,
} from './model/tool-schema';
import {
  sketchDiagnostic,
  viewportDiagnostic,
} from './model/viewport-diagnostic';
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
  BrowserProjects,
  browserProjectDatabaseName,
  browserProjectWorkspaceId,
  type BrowserProject,
} from './project/browser-projects';
import {runBrowserProjectOperation} from './project/browser-project-operation';
import {
  pickProjectDirectory,
  projectDirectoryPermission,
  rememberProjectDirectory,
  requestProjectDirectoryPermission,
  storedProjectDirectory,
  observeProjectDirectory,
  supportsProjectDirectories,
} from './project/directory-access';
import {
  copyProjectToEmptyDirectory,
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
  initializeBrowserProjectContents,
} from './project/filesystem';
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
import {ProjectTree} from './ui/project-tree';
import {AppDialog, dialogs} from './ui/dialog';
import {parsePackageSpecifier} from './project/package-manifest';
import {SourceEditPopover} from './ui/source-edit-popover';
import {ViewportContextMenu} from './ui/viewport-context-menu';
import {ViewportEmptyState} from './ui/viewport-empty-state';
import {ViewportGridScale} from './ui/viewport-grid-scale';
import {
  ModelViewport,
  type Occurrence,
  type TopologySelectionEvent,
} from './viewport';

const workspaceUrl = new URL(window.location.href);
const directoryWorkspaceId = workspaceUrl.searchParams.get('workspace');
const browserProjects = new BrowserProjects();
const browserResetStorageKey = 'code3d-reset-browser-project';
const browserDeleteStorageKey = 'code3d-delete-browser-project';
let browserProjectReset = false;
const pendingDelete = sessionStorage.getItem(browserDeleteStorageKey);
const pendingReset = sessionStorage.getItem(browserResetStorageKey);
if (pendingDelete || pendingReset) {
  // Confirmed destructive commands belong to this tab, never to a shareable URL.
  const deleting = pendingDelete !== null;
  const title = deleting ? 'Deleting project' : 'Resetting project';
  const progress = new AppDialog({
    title,
    className: 'message-dialog',
    canDismiss: () => false,
  });
  progress.element.innerHTML = `<div class="app-dialog-content"><h2>${title}</h2><p role="status">Removing project files and installed dependencies…</p><p>Close other Code3D tabs using this browser storage project to allow the operation to finish. Other projects and local folders will not be changed.</p></div>`;
  progress.open();
  try {
    if (deleting) {
      await browserProjects.remove(pendingDelete, () =>
        clearBrowserProjectState(pendingDelete, true),
      );
      browserProjects.signal.throwIfAborted();
      sessionStorage.removeItem(browserDeleteStorageKey);
    } else {
      const resettingCurrentProject =
        !directoryWorkspaceId &&
        workspaceUrl.searchParams.get('project') === pendingReset;
      await browserProjects.reset(
        pendingReset!,
        resettingCurrentProject ? undefined : resetUnopenedBrowserProject,
      );
      browserProjects.signal.throwIfAborted();
      browserProjectReset = resettingCurrentProject;
      if (!resettingCurrentProject)
        sessionStorage.removeItem(browserResetStorageKey);
    }
  } catch (error) {
    // A closing page must leave its confirmed command for the next page.
    browserProjects.signal.throwIfAborted();
    sessionStorage.removeItem(browserDeleteStorageKey);
    sessionStorage.removeItem(browserResetStorageKey);
    progress.close();
    await dialogs.alert({
      title: deleting
        ? 'Could not delete browser project'
        : 'Could not reset browser storage',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    progress.dispose();
  }
}
const storedDirectoryHandle = directoryWorkspaceId
  ? await storedProjectDirectory(directoryWorkspaceId)
  : undefined;
const directoryConnected =
  storedDirectoryHandle !== undefined &&
  (await projectDirectoryPermission(storedDirectoryHandle)) === 'granted';
const browserProject = directoryConnected
  ? undefined
  : await browserProjects.open(
      workspaceUrl.searchParams.get('project') ?? undefined,
    );
if (browserProject && !directoryWorkspaceId) {
  workspaceUrl.searchParams.set('project', browserProject.id);
  window.history.replaceState(null, '', workspaceUrl);
}
const initializeProject = async () => {
  const projectFileSystem = directoryConnected
    ? await openDirectoryProjectFileSystem(storedDirectoryHandle)
    : await openBrowserProjectFileSystem(
        browserProjectDatabaseName(browserProject!.id),
      );
  browserProjects.signal.throwIfAborted();
  if (browserProject) {
    await initializeBrowserProjectContents(
      projectFileSystem,
      {
        examples: bundledExamples,
        starter: defaultProject,
        createExamples:
          browserProjectReset || browserProject.template === 'examples',
      },
      browserProjects.signal,
    );
  } else {
    await projectFileSystem.initialize();
  }
  browserProjects.signal.throwIfAborted();
  await projectFileSystem.syncDirectory(bundledExamples, async () => {
    if (!directoryConnected) return false;
    const entries = await projectFileSystem.list('/');
    browserProjects.signal.throwIfAborted();
    if (!entries.every(entry => entry.name === '.code3d')) return false;
    const createExamples = await dialogs.confirm({
      title: 'Create examples',
      message: 'This project is empty. Create bundled examples in /examples?',
      submit: 'Create examples',
    });
    browserProjects.signal.throwIfAborted();
    return createExamples;
  });
  browserProjects.signal.throwIfAborted();
  return projectFileSystem;
};
// Mount only after earlier initialization finishes, so a second tab loads current metadata.
const projectFileSystem = browserProject
  ? await navigator.locks.request(
      `code3d-browser-project-initialize:${browserProject.id}`,
      {signal: browserProjects.signal},
      initializeProject,
    )
  : await initializeProject();
const localPackageFiles = directoryConnected
  ? new WorkspaceFileReader(
      projectFileSystem,
      browserPackageFiles,
      developmentWorkspaces,
    )
  : projectFileSystem;
let requestedFile = filePathFromRoute(window.location.hash);
if (
  requestedFile &&
  movedExamplePaths[requestedFile] &&
  !(await localPackageFiles.stat(requestedFile))
) {
  requestedFile = movedExamplePaths[requestedFile];
}
let initialFileError: unknown;
const initialProject: ModelProject = await loadInitialProject();
browserProjects.signal.throwIfAborted();
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
        <button class="quiet-button" id="settings-button" type="button">Settings</button>
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
              <button class="project-location" id="project-location" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="project-storage-menu"></button>
              <div class="project-context-menu project-storage-menu" id="project-storage-menu" popover="auto" role="menu" aria-label="Project storage">
                <section class="project-storage-section" role="group" aria-labelledby="browser-project-list-label">
                  <div class="project-storage-label" id="browser-project-list-label">Browser projects</div>
                  <div id="browser-project-list"></div>
                </section>
                <section class="project-storage-section" role="group" aria-label="Open a project">
                  <button id="open-folder-button" type="button" role="menuitem" tabindex="-1">Open folder</button>
                  <button id="new-browser-project-button" type="button" role="menuitem" tabindex="-1">New browser project</button>
                  <button id="reconnect-folder-button" type="button" role="menuitem" tabindex="-1" hidden>Reconnect folder</button>
                  <button id="reload-folder-button" type="button" role="menuitem" tabindex="-1" hidden>Reload folder</button>
                </section>
              </div>
              <div class="project-actions">
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
          <div class="viewport-tool-stack" id="viewport-tool-stack"></div>
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
const previewState = new ModelPreviewState(() => compiler.phase);
const modelInputs = new ModelInputs(() => previewState.module?.inputs ?? []);
const animation = new ModelAnimation(async time => {
  const accepted = await runModel(activeDesignContext(), executionConfig(time));
  return accepted && previewState.module?.timeOffset !== undefined;
});
function executionConfig(timeOffset = animation.time): ModelExecutionConfig {
  return {timeOffset, inputs: modelInputs.values};
}
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
let stopTabDiagnostics: (() => void)[] = [];
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
const projectLocationBusy = observable.box(false);
const browserProjectList = requiredElement('browser-project-list');
const newBrowserProjectButton = requiredElement<HTMLButtonElement>(
  'new-browser-project-button',
);
const newFileButton = requiredElement<HTMLButtonElement>('new-file-button');
const newFolderButton = requiredElement<HTMLButtonElement>('new-folder-button');
const refreshFilesButton = requiredElement<HTMLButtonElement>(
  'refresh-files-button',
);
newFileButton.append(createIcon(FilePlus));
newFolderButton.append(createIcon(FolderPlus));
refreshFilesButton.append(createIcon(RefreshCw));

projectLocation.addEventListener('click', () => {
  if (projectStorageMenu.matches(':popover-open')) {
    projectStorageMenu.hidePopover();
    return;
  }
  openProjectStorageMenu();
});
projectLocation.addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  openProjectStorageMenu();
  const buttons = projectStorageButtons();
  const current = buttons.find(
    button => button.getAttribute('aria-current') === 'true',
  );
  (event.key === 'ArrowUp' ? buttons.at(-1) : (current ?? buttons[0]))?.focus();
});

function openProjectStorageMenu(): void {
  if (!projectStorageMenu.matches(':popover-open'))
    projectStorageMenu.showPopover();
  const anchor = projectLocation.getBoundingClientRect();
  const menu = projectStorageMenu.getBoundingClientRect();
  projectStorageMenu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - menu.width - 8))}px`;
  projectStorageMenu.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - menu.height - 8))}px`;
  const buttons = projectStorageButtons();
  const current = buttons.find(
    button => button.getAttribute('aria-current') === 'true',
  );
  (current ?? buttons[0])?.focus();
}

function projectStorageButtons(): HTMLButtonElement[] {
  return [
    ...projectStorageMenu.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled):not(.browser-project-manage)',
    ),
  ].filter(
    button =>
      button.closest('[popover]') === projectStorageMenu &&
      button.checkVisibility(),
  );
}

projectStorageMenu.addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.key === 'Tab') {
    if (event.key === 'Escape') event.preventDefault();
    event.stopPropagation();
    projectStorageMenu.hidePopover();
    projectLocation.focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = projectStorageButtons();
  const focused = document.activeElement as HTMLButtonElement;
  const item = focused.classList.contains('browser-project-manage')
    ? focused.parentElement!.querySelector<HTMLButtonElement>(
        '.browser-project-select',
      )!
    : focused;
  const index = buttons.indexOf(item);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[next]?.focus();
});
projectStorageMenu.addEventListener('toggle', () => {
  projectLocation.setAttribute(
    'aria-expanded',
    String(projectStorageMenu.matches(':popover-open')),
  );
});
projectStorageMenu.addEventListener(
  'click',
  event => {
    const button = (event.target as Element).closest('button');
    if (button && button.getAttribute('aria-haspopup') !== 'menu') {
      projectStorageMenu.hidePopover();
      projectLocation.focus();
    }
  },
  {capture: true},
);
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
});
dockPanels.register({
  root: requiredElement('elements-panel'),
  handle: requiredElement<HTMLButtonElement>('elements-handle'),
  body: elements,
});

const codeEditor = new CodeEditor(
  editorHost,
  initialProject,
  initialProject.files[0]?.path,
  () => previewState.editorDiagnostics,
);
replaceFileRoute(codeEditor.currentFile());
const packageManager = !directoryConnected
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
  preparePackages,
  directoryConnected
    ? `directory:${directoryWorkspaceId}`
    : browserProjectWorkspaceId(browserProject!.id),
);
const stopLanguage = autorun(() =>
  codeEditor.setProjectLanguage(compiler.language),
);
codeEditor.editor.onDidDispose(stopLanguage);
const retrySaveButton = requiredElement<HTMLButtonElement>('retry-save-button');
const agentObserver: AgentObserver = new AgentObserver(
  packageFiles,
  () => agentProject.currentRevision,
  preparePackages,
);
const agentRenders = new AgentRenderHistory();
const agentProject: AgentProjectSession = new AgentProjectSession(
  projectFileSystem,
  codeEditor,
  request => agentObserver.observe(request),
  error => showProjectIssue(error),
);
const projectDirectory = new ProjectTree(projectTree, {
  diagnosticCounts: () => codeEditor.diagnosticCounts,
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
  if (reason !== 'save') {
    previewState.clearEditorDiagnostics();
    requestModelUpdate(0);
  }
});
const agentConnections = new AgentConnections(
  codeEditor,
  agentProject,
  agentRenders,
  directoryWorkspaceId
    ? directoryConnected
      ? `directory:${directoryWorkspaceId}`
      : undefined
    : browserProjectWorkspaceId(browserProject!.id),
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
const settingsDialog = new AppSettingsDialog(appSettings);
requiredElement<HTMLButtonElement>('settings-button').addEventListener(
  'click',
  () => settingsDialog.open(),
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
    settingsDialog.dispose();
    appSettings.dispose();
    dialogs.dispose();
    imageExportDialog.dispose();
    modelExportDialog.dispose();
    stopAgentRevision();
    stopSaveStatus();
    stopTabDiagnostics.forEach(stop => stop());
    stopAgentFollow();
    stopAgentUpdates();
    dockPanels.dispose();
    agentConnections.dispose();
    stopViewportModes();
    viewportSceneSelector.dispose();
    stopPreviewPresentation();
    stopViewportStatus();
    clearTimeout(statusRevealTimer);
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
  if (
    agentProject.hasUnsaved &&
    (directoryConnected ||
      (sessionStorage.getItem(browserResetStorageKey) !== browserProject?.id &&
        sessionStorage.getItem(browserDeleteStorageKey) !== browserProject?.id))
  ) {
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
  const specifier = await dialogs.prompt({
    title: 'Install package',
    message: `In ${directory}`,
    label: 'Package',
    placeholder: '@ctrl/tinycolor or @scope/package@version',
    submit: 'Install',
    trim: true,
    validate: value => {
      parsePackageSpecifier(value);
    },
  });
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
const designContextState = observable({
  selected: undefined as string | undefined,
  compiling: undefined as string | undefined,
});
let selectedDesignInvocation: DesignInvocation | undefined;
let pendingAgentFollow: AgentUpdate | undefined;
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
  rotationSelection?: SourceTarget['rotationSelection'];
  focus: Pick<
    NonNullable<ReturnType<typeof contextualToolContext>>,
    'arguments' | 'reference'
  >;
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
  renderScene: new RenderScenePreference(localStorage),
  onViewChange: observeViewportTarget,
  isViewVisible: () =>
    sketchEditor.navigation.gridStep === undefined && !previewState.empty,
  onSelect: occurrence => {
    if (occurrence.view === 'model') {
      preferredEvaluationContextId = undefined;
      runInAction(() => {
        designContextState.selected = undefined;
      });
    } else {
      preferredEvaluationContextId =
        viewport.sourceContext?.evaluation.contextId;
    }
    selectOccurrence(occurrence, occurrence.view === 'model');
  },
  onDrillDown: node => drillToObjectSource(node),
  onNavigateSource: (sourceRef, contextId) => {
    if (contextId) preferredEvaluationContextId = contextId;
    codeEditor.revealSource(sourceRef);
    const module = previewState.module;
    if (module && compiler.canExport(module))
      void inspectSourceSelection(
        module,
        sourceRef.file,
        sourceRef.start,
        undefined,
        contextId,
        sourceRef,
      );
  },
  onPositionTool: handlePositionTool,
  canEditPosition: canEditPositionBinding,
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
window.addEventListener('pagehide', () => elementsPanel.dispose(), {
  once: true,
});
const elementsDecorationOwner = 'elements-panel';
const elementsPanel = new ElementsPanel(elements, elementsCount, {
  onPreview: preview => {
    viewport.clearDecorations(elementsDecorationOwner);
    const occurrence = viewport.getSelected();
    const sourceElement = viewport.sourceContext?.evaluation.element;
    const element = preview?.kind === 'reference' ? preview.element : undefined;
    const previewsSourceElement =
      element !== undefined &&
      occurrence !== undefined &&
      sourceElement?.nodeId === occurrence.node.nodeId &&
      sourceElement.name === element.name &&
      sourceElement.kind === element.kind;
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
const viewportToolStack = requiredElement('viewport-tool-stack');
const contextualToolPanel = new ContextualToolPanel(viewportToolStack, {
  gridStep: () => viewport.gridStep,
  sourceParameter: () => {
    const scope = viewport.sourceContext;
    const cursor = codeEditor.parameterCursor;
    if (
      !scope ||
      !cursor ||
      contextualTool?.targetId !== scope.target.id ||
      contextualTool.contextId !== scope.evaluation.contextId
    )
      return undefined;
    return contextualParameterAt(contextualTool.focus, cursor, ref =>
      codeEditor.resolveSourceRef(ref),
    );
  },
  onParameterInput: updateContextualToolParameter,
  onParameterCommit: commitContextualToolParameter,
  onAction: runContextualToolAction,
});
codeEditor.setParameterFocusHandler(
  () =>
    inputsPanel.focusSourceInput() ||
    contextualToolPanel.focusSourceParameter(),
);
window.addEventListener('pagehide', () => contextualToolPanel.dispose(), {
  once: true,
});

const toolEngine = new ToolEngine({
  sourceVersion: () => codeEditor.sourceVersion(),
  resolveSourceRef: sourceRef => codeEditor.resolveSourceRef(sourceRef),
  readSource: sourceRef => codeEditor.readSource(sourceRef),
  applySourceEdits: (baseVersion, edits, options) =>
    codeEditor.applySourceEdits(baseVersion, edits, options),
  applyPreview: preview => applyToolPreview(preview),
  commitPreview: preview => commitToolPreview(preview),
  clearPreview: preview => clearToolPreview(preview),
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
  sourceVersion: () => codeEditor.sourceVersion(),
  cancelEditGroup: (file, undoGroup) => {
    codeEditor.discardPendingToolFormat(file, undoGroup);
    codeEditor.endSourceEditGroup(undoGroup);
  },
  resumeEditGroup: (file, undoGroup) =>
    codeEditor.resumeSourceEditGroup(file, undoGroup),
  commit: (intent, undoGroup) =>
    commitToolSession(toolEngine.begin(`sketch:${intent.layer}`), intent, {
      preserveCursor: true,
      undoGroup,
    }),
});
const spatialToolbar = new SpatialToolbar(
  viewportToolStack,
  viewport.positionTools,
  {
    visible: () => !sketchEditor.hasTarget && viewport.renderMode !== 'render',
    availableTools: () => viewport.availablePositionTools,
    context: () => viewport.positionToolContext,
    cancel: cancelRotationReferenceSelection,
    activateSource: async tool => {
      const scope = viewport.sourceContext;
      const module = previewState.module;
      if (!scope || !module) return false;
      const tools = viewport.positionTools;
      const activationRef = contextualToolActivation(
        module,
        scope,
        tool,
        tools.toolBinding ?? tools.rotationBinding,
      );
      const selection = codeEditor.activateSourceTool(activationRef);
      if (!selection) return false;
      pendingAgentFollow = undefined;
      const presented = await inspectSourceSelection(
        module,
        selection.file,
        selection.offset,
        undefined,
        preferredEvaluationContextId,
        selection.sourceRef,
      );
      return presented;
    },
  },
);
viewportToolStack.prepend(spatialToolbar.root);
codeEditor.observeSourceContext(
  () => {
    const scope = viewport.sourceContext;
    const module = previewState.module;
    if (!scope || !module || sketchEditor.hasTarget) return;
    const tools = viewport.positionTools;
    const tool = contextualToolSource(module, scope.target, tools.tool);
    return {
      tool,
      caretOnly: !!scope.target.relationArray,
    };
  },
  // A sketch keeps its blurred caret and word box without marking the whole
  // call, and the marks stay decorative: they never reach source edits.
  () => (sketchEditor.hasTarget ? {tool: [], caretOnly: false} : undefined),
);
const stopContextualTool = reaction(
  () => ({
    context: viewport.sourceContext,
    occurrence: viewport.getSelected(),
    model: previewState.module,
    modelVersion: previewState.sourceVersion,
    sourceVersion: codeEditor.sourceVersion(),
  }),
  () => syncContextualTool(),
  {
    equals: (a, b) =>
      a.context === b.context &&
      a.occurrence === b.occurrence &&
      a.model === b.model &&
      a.modelVersion === b.modelVersion &&
      a.sourceVersion === b.sourceVersion,
  },
);
window.addEventListener('pagehide', stopContextualTool, {once: true});
const stopDesignArguments = reaction(
  designArgumentsView,
  renderDesignArguments,
  {
    fireImmediately: true,
    equals: compareStructural,
  },
);
window.addEventListener('pagehide', stopDesignArguments, {once: true});
const stopSketchFeedback = reaction(
  () => [sketchEditor.diagnosticScope, sketchEditor.isStale] as const,
  () => refreshViewportFeedback(),
);
window.addEventListener('pagehide', stopSketchFeedback, {once: true});
const stopViewportDiagnostic = reaction(
  () => {
    const diagnostic = activeViewportDiagnostic();
    const active = sketchEditor.diagnosticScope?.at(-1)?.id;
    return {
      diagnostic,
      upstream:
        !!diagnostic?.relatedSketchIds?.length &&
        (!active || !diagnostic.relatedSketchIds.includes(active)),
      editable: previewState.sourceVersion === codeEditor.sourceVersion(),
    };
  },
  renderViewportDiagnostic,
  {fireImmediately: true, equals: compareStructural},
);
window.addEventListener('pagehide', stopViewportDiagnostic, {once: true});
const stopRotationReferences = reaction(
  () => ({
    tool: viewport.positionTools.referencePicking,
    binding: viewport.positionTools.rotationBinding,
    target: viewport.sourceContext?.target.id,
    occurrence: viewport.getSelected()?.key,
    inspecting: previewState.inspecting,
    modelVersion: previewState.sourceVersion,
    sourceVersion: codeEditor.sourceVersion(),
  }),
  ({tool, inspecting, modelVersion, sourceVersion}) => {
    // A source inspection only reads the displayed model; its in-flight window
    // masks sourceVersion without changing anything. Keep the reference picking
    // session alive until the inspection commits its own rebuild.
    if (inspecting) return;
    cancelRotationReferenceSelection();
    if (tool && modelVersion === sourceVersion)
      beginRotationReferenceSelection(tool);
  },
  {
    equals: (a, b) =>
      a.tool === b.tool &&
      a.binding === b.binding &&
      a.target === b.target &&
      a.occurrence === b.occurrence &&
      a.inspecting === b.inspecting &&
      a.modelVersion === b.modelVersion &&
      a.sourceVersion === b.sourceVersion,
  },
);
window.addEventListener('pagehide', () => spatialToolbar.dispose(), {
  once: true,
});
window.addEventListener('pagehide', stopRotationReferences, {once: true});

const dragPreviewView = new ToolDragPreviewView(
  viewportToolStack,
  () => sketchEditor.dragPreview ?? viewport.dragPreview,
);
window.addEventListener('pagehide', () => dragPreviewView.dispose(), {
  once: true,
});

const viewportGridScale = new ViewportGridScale(
  viewportFeedbackStack,
  () => sketchEditor.navigation.gridStep ?? viewport.gridStep,
);
const viewportSceneSelector = new ViewportSceneSelector(
  viewportHost,
  viewport,
  () => ({
    visible:
      viewport.renderMode === 'render' &&
      !sketchEditor.hasTarget &&
      !previewState.empty,
    disabled: previewState.retainingView || previewState.inspecting,
  }),
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
const inputsPanel = new ModelInputsPanel(
  viewportHost.querySelector('.viewport-dock-panels')!,
  dockPanels,
  modelInputs,
  {
    sourceInput: () =>
      modelInputs.atSource(codeEditor.parameterCursor, ref =>
        codeEditor.resolveSourceRef(ref),
      ),
    onEdit: () => animation.pause(),
  },
);
modelInputs.observeExecution(
  () => !animation.pending && !previewState.busy && compiler.canExecute(),
  values => {
    animation.stop();
    return runModel(activeDesignContext(), {
      ...executionConfig(),
      inputs: values,
    });
  },
);
window.addEventListener(
  'pagehide',
  () => {
    inputsPanel.dispose();
    modelInputs.dispose();
  },
  {once: true},
);
const animationControls = new AnimationControls(viewportHost, animation, {
  visible: () =>
    previewState.module?.timeOffset !== undefined && !sketchEditor.hasTarget,
  canPlay: () =>
    !previewState.busy &&
    previewState.status !== 'error' &&
    previewState.sourceVersion === codeEditor.sourceVersion() &&
    compiler.canExecute(),
  canReset: () => !previewState.busy && compiler.canExecute(),
});
window.addEventListener('pagehide', () => animationControls.dispose(), {
  once: true,
});
let statusRevealTimer: ReturnType<typeof setTimeout> | undefined;
const stopViewportStatus = reaction(
  () => {
    const diagnostic = previewState.statusDiagnostic;
    return {
      // Frame execution phases remain internal while playback is active.
      status:
        animation.playing && !diagnostic
          ? {
              state: 'busy' as const,
              label: 'Playing',
              description: undefined,
              delay: 0,
            }
          : previewState.presentation,
      diagnostic,
    };
  },
  ({status, diagnostic}) => {
    clearTimeout(statusRevealTimer);
    statusRevealTimer = undefined;
    // The reveal delay only applies when the status is not already visibly
    // busy; hiding between busy phases would flicker a working indicator.
    const visiblyBusy =
      !viewportStatus.hidden && viewportStatus.dataset.state === 'busy';
    viewportStatus.hidden = !status.label || (status.delay > 0 && !visiblyBusy);
    viewportStatus.dataset.state = status.state;
    viewportStatusLabel.textContent = status.label ?? '';
    viewportStatus.setAttribute('aria-busy', String(status.state === 'busy'));
    const description = diagnostic
      ? [diagnostic.summary, diagnostic.details].filter(Boolean).join('\n\n')
      : status.description;
    if (description) viewportStatus.title = description;
    else viewportStatus.removeAttribute('title');
    const navigable = !!diagnostic?.sourceRef;
    viewportStatus.setAttribute('role', navigable ? 'button' : 'status');
    if (navigable) viewportStatus.tabIndex = 0;
    else viewportStatus.removeAttribute('tabindex');
    if (status.label && status.delay > 0 && viewportStatus.hidden)
      statusRevealTimer = setTimeout(() => {
        statusRevealTimer = undefined;
        viewportStatus.hidden = false;
      }, status.delay);
  },
  {fireImmediately: true},
);
const stopPreviewPresentation = reaction(
  () => ({
    empty: previewState.empty,
    hint: previewState.showHint,
    retaining: previewState.retainingView || previewState.inspecting,
  }),
  ({empty, hint, retaining}) => {
    viewportHost.dataset.empty = String(empty);
    viewportEmptyState.setVisible(hint);
    for (const element of viewportHost.querySelectorAll<HTMLElement>(
      '.viewport-canvas, .sketch-editor, .viewport-mode, .viewport-dock-panels, .viewport-coordinate-reference',
    ))
      element.inert = retaining;
  },
  {fireImmediately: true, equals: compareStructural},
);

function revealStatusDiagnostic(): void {
  const sourceRef = previewState.statusDiagnostic?.sourceRef;
  if (sourceRef) codeEditor.revealSource(sourceRef, true, 'start');
}
viewportStatus.addEventListener('click', revealStatusDiagnostic);
viewportStatus.addEventListener('keydown', event => {
  if (
    (event.key === 'Enter' || event.key === ' ') &&
    previewState.statusDiagnostic?.sourceRef
  ) {
    event.preventDefault();
    revealStatusDiagnostic();
  }
});

codeEditor.onChange(change => {
  previewState.clearEditorDiagnostics();
  const toolChange = change.kind === 'content' && change.origin === 'tool';
  const historyChange =
    change.kind === 'content' &&
    (change.origin === 'undo' || change.origin === 'redo');
  const editingHistoryChange =
    historyChange && handleContextualEditingHistory(change);
  if (!toolChange && !editingHistoryChange) abandonContextualTool();
  if (toolChange) renderContextualToolPanel();
  if (toolChange) sketchEditor.sourceEdited(change.undoGroup);
  else sketchEditor.invalidate();
  agentProject.recordEditorChange(change);
  if (!toolChange) sourceEditPopover.dismiss();
  if (change.kind !== 'content') renderProjectNavigation();
  requestModelUpdate(
    toolChange || historyChange ? 0 : appSettings.value.editDelayMs,
    toolChange || historyChange,
  );
});

codeEditor.onCursorOffset(({file, offset, sourceRef}) => {
  animation.pause();
  pendingAgentFollow = undefined;
  const module = previewState.module;
  if (previewState.pendingFile || !module) return;
  if (!compiler.canExport(module)) {
    if (sketchEditor.isStale && !sketchEditor.containsSource(file, offset))
      sketchEditor.hide();
    return;
  }
  const matched = viewport.sourceEvaluationAt(
    module,
    file,
    offset,
    preferredEvaluationContextId,
    sourceRef,
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
  void inspectSourceSelection(
    module,
    file,
    offset,
    undefined,
    preferredEvaluationContextId,
    sourceRef,
  );
});

async function inspectSourceSelection(
  module: ModelModule,
  file: string,
  offset: number,
  selectedKey?: string,
  contextId = preferredEvaluationContextId,
  preferredSource?: SourceRef,
): Promise<boolean> {
  const selection = sourceInspectionSelection(
    module,
    file,
    offset,
    contextId,
    preferredSource,
  );
  const published = await previewState.inspect(
    () => compiler.inspect(module, selection),
    scene => {
      if (previewState.module !== module) return;
      viewport.renderInspection(module, scene, selection, selectedKey);
      previewState.presented(hasViewportTarget(), viewport.presentedModule);
      updatePresentedSourceSelection();
    },
  );
  refreshViewportFeedback();
  return published;
}

function sourceInspectionSelection(
  module: ModelModule,
  file: string,
  offset: number,
  contextId: string | undefined,
  preferredSource?: SourceRef,
) {
  const scope = viewport.sourceEvaluationAt(
    module,
    file,
    offset,
    contextId,
    preferredSource,
  );
  return {
    file,
    offset,
    sourceRef: scope?.target.sourceRef ?? preferredSource,
    contextId: scope?.evaluation.contextId ?? contextId,
    order: scope?.evaluation.runtime.order,
    callId: scope?.evaluation.inspectCallId,
    relationArray: scope?.target.relationArray
      ? {
          array: scope.target.relationArray,
          gap: scope.target.sourceRef,
          ownerNodeId: scope.evaluation.relationOwnerNodeId,
        }
      : undefined,
  };
}

function updatePresentedSourceSelection(): void {
  preferredEvaluationContextId = viewport.sourceContext?.evaluation.contextId;
  if (
    selectedDesignInvocation &&
    preferredEvaluationContextId !== designContextState.selected
  ) {
    selectedDesignInvocation = undefined;
    runInAction(() => {
      designContextState.selected = undefined;
    });
  }
  const occurrence = viewport.getSelected();
  if (occurrence) {
    selectOccurrence(occurrence, false);
  }
}
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
  runInAction(() => {
    designContextState.selected = undefined;
  });
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
  runInAction(() => {
    designContextState.selected = undefined;
  });
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
let externalRefresh: Promise<void> | undefined;
let externalRefreshStopped = false;
let externalRefreshAll = false;
let externalRefreshForce = false;
const externalChangedPaths = new Set<string>();
let externalRefreshTimer: number | undefined;
let stopDirectoryObservation: (() => void) | undefined;
let externalPolling = false;
function refreshExternalProjectFiles(
  paths?: readonly string[],
  force = false,
): Promise<void> {
  if (externalRefreshStopped) return Promise.resolve();
  externalRefreshForce ||= force;
  if (paths) for (const path of paths) externalChangedPaths.add(path);
  else externalRefreshAll = true;
  return (externalRefresh ??= (async () => {
    while (
      !externalRefreshStopped &&
      (externalRefreshAll || externalChangedPaths.size)
    ) {
      const changed = externalRefreshAll
        ? undefined
        : [...externalChangedPaths];
      const forceRead = externalRefreshForce;
      externalRefreshForce = false;
      externalRefreshAll = false;
      externalChangedPaths.clear();
      await agentProject.refreshExternalFiles(
        codeEditor.workspaceProject(),
        () => externalRefreshStopped,
        changed,
        forceRead,
      );
    }
  })().finally(() => {
    externalRefresh = undefined;
  }));
}
function checkExternalProjectFiles(): void {
  if (!directoryConnected || document.hidden || externalRefreshStopped) return;
  void refreshExternalProjectFiles().catch(showProjectIssue);
}
function startExternalPolling(): void {
  if (externalRefreshStopped || externalPolling) return;
  externalPolling = true;
  const poll = async () => {
    if (externalRefreshStopped) return;
    const start = performance.now();
    try {
      if (!document.hidden) await refreshExternalProjectFiles();
    } catch (error) {
      showProjectIssue(error);
    } finally {
      if (!externalRefreshStopped)
        externalRefreshTimer = window.setTimeout(
          poll,
          Math.max(5000, (performance.now() - start) * 50),
        );
    }
  };
  void poll();
}
if (directoryConnected) {
  void observeProjectDirectory(
    storedDirectoryHandle,
    paths => {
      if (document.hidden) {
        // Preserve invalidation even when an editor retained the timestamp and size.
        externalRefreshAll = true;
        externalRefreshForce = true;
        return;
      }
      void refreshExternalProjectFiles(paths, paths === undefined).catch(
        showProjectIssue,
      );
    },
    startExternalPolling,
  ).then(stop => {
    if (externalRefreshStopped) {
      stop?.();
      return;
    }
    stopDirectoryObservation = stop;
    if (!stop) startExternalPolling();
  });
}
window.addEventListener('focus', checkExternalProjectFiles);
document.addEventListener('visibilitychange', checkExternalProjectFiles);
window.addEventListener(
  'pagehide',
  () => {
    externalRefreshStopped = true;
    window.clearTimeout(externalRefreshTimer);
    stopDirectoryObservation?.();
    externalChangedPaths.clear();
    window.removeEventListener('focus', checkExternalProjectFiles);
    document.removeEventListener('visibilitychange', checkExternalProjectFiles);
  },
  {once: true},
);
refreshFilesButton.addEventListener('click', () => {
  void (async () => {
    await refreshExternalProjectFiles(undefined, true);
    compiler.refreshProject();
    await projectDirectory.refresh();
    await runModel();
  })().catch(showProjectIssue);
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
newBrowserProjectButton.addEventListener('click', () => {
  void createBrowserProject();
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && spatialToolbar.selection) {
    cancelRotationReferenceSelection();
    event.preventDefault();
    return;
  }
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

// Preserve button identity across busy changes and cross-tab list updates.
const projectButtons = new Map<
  string,
  {
    row: HTMLDivElement;
    button: HTMLButtonElement;
    label: HTMLSpanElement;
    manage: HTMLButtonElement;
    submenu: Submenu;
  }
>();
const stopBrowserProjects = autorun(() => {
  const projects = browserProjects.projects;
  const busy = projectLocationBusy.get();
  const ids = new Set(projects.map(project => project.id));
  let restoreProjectFocus = false;
  for (const [id, item] of projectButtons) {
    if (!ids.has(id)) {
      restoreProjectFocus ||= item.row.contains(document.activeElement);
      item.submenu.dispose();
      item.row.remove();
      projectButtons.delete(id);
    }
  }
  for (const project of projects) {
    const current = project.id === browserProject?.id;
    let item = projectButtons.get(project.id);
    if (!item) {
      const row = document.createElement('div');
      row.className = 'browser-project-row';
      row.dataset.projectId = project.id;
      row.setAttribute('role', 'none');
      const button = document.createElement('button');
      button.className = 'browser-project-select';
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('role', 'menuitem');
      button.dataset.projectId = project.id;
      const label = document.createElement('span');
      label.className = 'browser-project-name';
      button.append(label);
      button.addEventListener(
        'click',
        () => void useBrowserStorage(project.id),
      );
      const manage = document.createElement('button');
      manage.className = 'browser-project-manage';
      manage.type = 'button';
      manage.tabIndex = -1;
      manage.setAttribute('role', 'menuitem');
      manage.append(createIcon(ChevronRight));
      const actions = document.createElement('div');
      actions.className = 'project-context-menu project-storage-submenu';
      actions.id = `browser-project-actions-${project.id}`;
      actions.popover = 'auto';
      actions.innerHTML = `
        <button type="button" role="menuitem" tabindex="-1" data-action="open">Open</button>
        <button type="button" role="menuitem" tabindex="-1" data-action="copy">Copy to local folder and open</button>
        <div class="project-menu-separator" role="separator"></div>
        <button type="button" role="menuitem" tabindex="-1" data-action="reset">Reset</button>
        <button type="button" role="menuitem" tabindex="-1" data-action="delete" data-danger>Delete</button>
      `;
      actions.addEventListener('click', event => {
        const action = (event.target as Element).closest('button')?.dataset
          .action;
        const target = browserProjects.projects.find(
          entry => entry.id === project.id,
        );
        if (!target) return;
        if (action === 'open') void useBrowserStorage(target.id);
        else if (action === 'copy') void copyToLocalDirectory(target);
        else if (action === 'reset') void resetBrowserStorage(target);
        else if (action === 'delete') void deleteBrowserProject(target);
      });
      row.append(button, manage, actions);
      browserProjectList.append(row);
      item = {
        row,
        button,
        label,
        manage,
        submenu: new Submenu(manage, actions, button),
      };
      projectButtons.set(project.id, item);
    }
    const {button, label} = item;
    if (label.textContent !== project.name) label.textContent = project.name;
    button.title = project.name;
    button.setAttribute('aria-label', project.name);
    button.disabled = busy;
    button.setAttribute('aria-current', String(current));
    item.row.dataset.current = String(current);
    item.manage.disabled = busy;
    item.manage.setAttribute('aria-label', `Manage ${project.name}`);
    item.submenu.root.setAttribute('aria-label', project.name);
    for (const action of item.submenu.root.querySelectorAll('button'))
      action.disabled =
        busy ||
        (action.dataset.action === 'copy' && !supportsProjectDirectories());
  }
  if (restoreProjectFocus && projectStorageMenu.matches(':popover-open')) {
    const buttons = projectStorageButtons();
    (
      buttons.find(button => button.getAttribute('aria-current') === 'true') ??
      buttons[0]
    )?.focus();
  }
});
window.addEventListener(
  'pagehide',
  () => {
    stopBrowserProjects();
    for (const item of projectButtons.values()) item.submenu.dispose();
  },
  {once: true},
);
const stopProjectLocation = autorun(renderProjectLocation);
window.addEventListener('pagehide', stopProjectLocation, {once: true});
renderProjectNavigation();
void projectDirectory.refresh();
if (initialFileError) projectDirectory.showError(initialFileError);
if (browserProjectReset) {
  await compiler.clearBuildCache().catch(error => {
    browserProjects.signal.throwIfAborted();
    showProjectIssue(error);
  });
  browserProjects.signal.throwIfAborted();
  sessionStorage.removeItem(browserResetStorageKey);
}
runModel();

function renderProjectLocation(): void {
  const busy = projectLocationBusy.get();
  projectLocation.disabled = busy;
  newBrowserProjectButton.disabled = busy;
  openFolderButton.disabled = busy || !supportsProjectDirectories();
  reconnectFolderButton.disabled = busy;
  reloadFolderButton.disabled = busy;
  if (directoryConnected) {
    projectLocation.textContent = storedDirectoryHandle.name;
    projectLocation.dataset.kind = 'local';
    projectLocation.title = `Files are stored directly in ${storedDirectoryHandle.name}`;
    openFolderButton.textContent = 'Change folder';
    reconnectFolderButton.hidden = true;
    reloadFolderButton.hidden = false;
    return;
  }

  projectLocation.textContent = browserProject!.name;
  projectLocation.dataset.kind = 'browser';
  projectLocation.title = `${browserProject!.name} · Browser storage`;
  openFolderButton.textContent = 'Open folder';
  reconnectFolderButton.hidden = storedDirectoryHandle === undefined;
  reconnectFolderButton.textContent = storedDirectoryHandle
    ? `Reconnect ${storedDirectoryHandle.name}`
    : 'Reconnect folder';
  reloadFolderButton.hidden = true;
}

async function openProjectDirectory(): Promise<void> {
  setProjectLocationBusy(true);
  try {
    const handle = await pickProjectDirectory();
    if (!handle) return;
    await agentProject.flush();
    const workspaceId = await rememberProjectDirectory(handle);
    openDirectoryWorkspace(workspaceId);
  } catch (error) {
    showProjectIssue(error);
  } finally {
    setProjectLocationBusy(false);
  }
}

async function copyToLocalDirectory(project: BrowserProject): Promise<void> {
  setProjectLocationBusy(true);
  try {
    // Invoke the picker before awaiting saves, while the click still has activation.
    const handle = await pickProjectDirectory();
    if (!handle) return;
    if (project.id !== browserProject?.id) {
      await agentProject.flush();
      const revision = agentProject.currentRevision;
      await withBrowserProjectProgress('Copying project', project.name, () =>
        browserProjects.runExclusive(project.id, target =>
          runBrowserProjectOperation(
            target,
            {kind: 'copy', target: handle},
            {examples: bundledExamples, starter: defaultProject},
            browserProjects.signal,
          ),
        ),
      );
      const workspaceId = await rememberProjectDirectory(handle);
      if (agentProject.currentRevision !== revision)
        throw new Error(
          'The current project changed while copying. It remains open with your latest changes; the selected folder contains the copied project.',
        );
      openDirectoryWorkspace(workspaceId);
      return;
    }
    await agentProject.update(async () => {
      const revision = agentProject.currentRevision;
      const target = await openDirectoryProjectFileSystem(handle);
      await copyProjectToEmptyDirectory(projectFileSystem, target);
      const selectedFile = codeEditor.currentFile();
      const copiedFile =
        selectedFile && (await target.stat(selectedFile))?.kind === 'file'
          ? selectedFile
          : undefined;
      const workspaceId = await rememberProjectDirectory(handle);
      // Edits made during the copy remain in browser storage; do not leave them behind.
      if (agentProject.currentRevision !== revision) {
        throw new Error(
          'The project changed while copying. Browser storage remains open with your latest changes; the selected folder contains the earlier copy.',
        );
      }
      openDirectoryWorkspace(workspaceId, copiedFile);
    });
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

async function createBrowserProject(): Promise<void> {
  setProjectLocationBusy(true);
  try {
    await showNewBrowserProjectDialog(async ({name, createExamples}) => {
      await agentProject.flush();
      const project = await browserProjects.create(name, createExamples);
      openBrowserWorkspace(project.id);
    });
  } catch (error) {
    showProjectIssue(error);
  } finally {
    setProjectLocationBusy(false);
    projectLocation.focus();
  }
}

async function deleteBrowserProject(project: BrowserProject): Promise<void> {
  const current = project.id === browserProject?.id;
  setProjectLocationBusy(true);
  try {
    if (
      !(await dialogs.confirm({
        title: 'Delete project',
        message: `Permanently delete “${project.name}” and all its files, ${current ? 'unsaved edits and ' : ''}installed dependencies? This cannot be undone.${browserProjects.projects.length === 1 ? (current ? ' A new empty default project will open.' : ' A new empty default project will be available.') : ''}`,
        submit: 'Delete project',
        danger: true,
      }))
    )
      return;
    sessionStorage.setItem(browserDeleteStorageKey, project.id);
    if (current) {
      openBrowserWorkspace(project.id);
    } else {
      await withBrowserProjectProgress('Deleting project', project.name, () =>
        browserProjects.remove(project.id, () =>
          clearBrowserProjectState(project.id, true),
        ),
      );
      browserProjects.signal.throwIfAborted();
      sessionStorage.removeItem(browserDeleteStorageKey);
    }
  } catch (error) {
    if (browserProjects.signal.aborted) return;
    sessionStorage.removeItem(browserDeleteStorageKey);
    showProjectIssue(error);
  } finally {
    setProjectLocationBusy(false);
    projectLocation.focus();
  }
}

async function useBrowserStorage(projectId: string): Promise<void> {
  if (!directoryWorkspaceId && projectId === browserProject?.id) return;
  setProjectLocationBusy(true);
  try {
    await agentProject.flush();
    openBrowserWorkspace(projectId);
  } catch (error) {
    showProjectIssue(error);
    setProjectLocationBusy(false);
  }
}

async function resetBrowserStorage(project: BrowserProject): Promise<void> {
  const current = project.id === browserProject?.id;
  setProjectLocationBusy(true);
  try {
    if (
      !(await dialogs.confirm({
        title: 'Reset project',
        message: `Replace all files, ${current ? 'unsaved edits and ' : ''}installed dependencies in “${project.name}” with the starter model and bundled examples? This cannot be undone.`,
        submit: 'Reset project',
        danger: true,
      }))
    )
      return;
    sessionStorage.setItem(browserResetStorageKey, project.id);
    if (current) {
      openBrowserWorkspace(project.id);
    } else {
      await withBrowserProjectProgress('Resetting project', project.name, () =>
        browserProjects.reset(project.id, resetUnopenedBrowserProject),
      );
      browserProjects.signal.throwIfAborted();
      sessionStorage.removeItem(browserResetStorageKey);
    }
  } catch (error) {
    if (browserProjects.signal.aborted) return;
    sessionStorage.removeItem(browserResetStorageKey);
    showProjectIssue(error);
  } finally {
    setProjectLocationBusy(false);
    projectLocation.focus();
  }
}

async function resetUnopenedBrowserProject(
  project: BrowserProject,
): Promise<void> {
  await clearBrowserProjectState(project.id, false);
  await runBrowserProjectOperation(
    project,
    {kind: 'reset'},
    {examples: bundledExamples, starter: defaultProject},
    browserProjects.signal,
  );
}

async function clearBrowserProjectState(
  id: string,
  removeAgents: boolean,
): Promise<void> {
  const identity = browserProjectWorkspaceId(id);
  const compiler = new ModelCompilerClient(
    browserPackageFiles,
    undefined,
    identity,
  );
  try {
    await compiler.clearBuildCache();
    browserProjects.signal.throwIfAborted();
  } finally {
    compiler.dispose();
  }
  if (!removeAgents) return;
  const agents = await AgentPersistence.open(identity);
  try {
    browserProjects.signal.throwIfAborted();
    await agents.save();
  } finally {
    await agents.close();
  }
}

async function withBrowserProjectProgress<T>(
  title: string,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const progress = new AppDialog({
    title,
    className: 'message-dialog',
    canDismiss: () => false,
  });
  const content = document.createElement('div');
  content.className = 'app-dialog-content';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = `Working on “${name}”. Close other Code3D tabs using this project to allow the operation to finish.`;
  content.append(heading, status);
  progress.element.append(content);
  progress.open();
  try {
    return await operation();
  } finally {
    progress.dispose();
  }
}

function openDirectoryWorkspace(workspaceId: string, file?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('workspace', workspaceId);
  url.searchParams.delete('project');
  url.hash = file ? fileRoute(file) : '';
  window.location.replace(url);
}

function openBrowserWorkspace(projectId?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('workspace');
  if (projectId) url.searchParams.set('project', projectId);
  else url.searchParams.delete('project');
  url.hash = '';
  window.history.replaceState(null, '', url);
  window.location.reload();
}

function setProjectLocationBusy(busy: boolean): void {
  runInAction(() => projectLocationBusy.set(busy));
}

async function resetExamples(): Promise<void> {
  try {
    const existing = await projectFileSystem.stat(bundledExamples.directory);
    if (
      !(await dialogs.confirm({
        title: existing ? 'Reset examples' : 'Create examples',
        message: existing
          ? 'Files under /examples will be replaced. Other project files will not change.'
          : 'Create bundled examples in /examples?',
        submit: existing ? 'Reset examples' : 'Create examples',
        danger: !!existing,
      }))
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
  stopTabDiagnostics.forEach(stop => stop());
  stopTabDiagnostics = [];
  const active = codeEditor.currentFile();
  requiredElement('editor-empty-state').hidden = active !== undefined;
  projectDirectory.setActiveFile(active);
  editorTabs.replaceChildren(
    ...codeEditor.openedFiles().map(path => {
      const tab = document.createElement('span');
      tab.className = 'editor-tab';
      tab.dataset.path = path;
      tab.classList.toggle('active', path === active);
      const open = document.createElement('button');
      open.type = 'button';
      const label = document.createElement('span');
      label.className = 'editor-tab-label';
      label.textContent = path.slice(path.lastIndexOf('/') + 1);
      open.append(createIcon(File, 'project-entry-icon file-icon'), label);
      const diagnostics = document.createElement('span');
      diagnostics.className = 'editor-tab-diagnostics';
      open.append(diagnostics);
      stopTabDiagnostics.push(
        autorun(() => {
          const counts = codeEditor.diagnosticCounts.get(path);
          const count = counts ? counts.errors + counts.warnings : 0;
          tab.dataset.diagnosticSeverity = counts?.errors
            ? 'error'
            : counts?.warnings
              ? 'warning'
              : '';
          diagnostics.hidden = count === 0;
          diagnostics.textContent = String(count);
          const detail = counts ? ` · ${describeDiagnosticCounts(counts)}` : '';
          open.title = path + detail;
          open.setAttribute('aria-label', path + detail);
        }),
      );
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
  if (
    path &&
    movedExamplePaths[path] &&
    !codeEditor.fileState(path) &&
    !(await localPackageFiles.stat(path))
  ) {
    if (version !== fileOpenVersion || cancelled()) return;
    path = movedExamplePaths[path];
  }
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
  projectDirectory.showError(error);
}

function activeDesignContext(
  cursor = codeEditor.cursorSource(),
): DesignContext | undefined {
  if (selectedDesignInvocation) return {...selectedDesignInvocation, ...cursor};
  const context = previewState.module?.designArguments.find(
    context => context.id === designContextState.selected,
  );
  return context && {file: context.functionRef.file, id: context.id};
}

async function runModel(
  designContext = activeDesignContext(),
  execution?: ModelExecutionConfig,
): Promise<boolean> {
  if (execution === undefined) animation.stop();
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  viewport.restoreTransientPreview();
  const sourceVersion = codeEditor.sourceVersion();
  activatePreviewFile();
  const request = previewState.begin(sourceVersion);
  const file = previewState.file;
  if (!file) {
    compiler.cancel();
    restoreModelStatus();
    return false;
  }
  const following =
    pendingAgentFollow?.kind === 'apply' ? pendingAgentFollow : undefined;
  const designContextId =
    designContext && 'id' in designContext ? designContext.id : undefined;
  if (execution === undefined) {
    runInAction(() => {
      designContextState.compiling = designContextId;
    });
    previewState.beginCompilation();
  }

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
    },
  );

  try {
    const selectedKey = viewport.getSelected()?.key ?? 'root';
    const compilation =
      execution === undefined
        ? compiler.compile(
            codeEditor.project(),
            file,
            designContext,
            undefined,
            true,
            executionConfig(),
          )
        : compiler.execute(execution);
    const nextModule = await compilation;
    if (!previewState.isCurrent(request, codeEditor.sourceVersion()))
      return false;
    if (sketchEditor.synchronizeSource(nextModule.warnings)) return false;
    let cursor = codeEditor.cursorSource();
    let selection: ReturnType<typeof sourceInspectionSelection> | undefined;
    let scene: Awaited<ReturnType<typeof compiler.inspect>>;
    let inspectionDiagnostic: ModelDiagnostic | undefined;
    // Prepare the entire replacement before publishing it. Re-execution does
    // not change source focus or make the currently displayed UI unavailable.
    while (true) {
      const sourceCursor = cursor;
      if (
        sourceCursor &&
        !nextModule.sourceTargets.some(
          ({sourceRef}) =>
            sourceRef.file === sourceCursor.file &&
            sourceRef.start <= sourceCursor.offset &&
            sourceCursor.offset <= sourceRef.end,
        )
      ) {
        const context = designContextAt(
          nextModule,
          sourceCursor.file,
          sourceCursor.offset,
        );
        if (context && nextModule.activeDesignContextId !== context.id) {
          preferredEvaluationContextId = context.id;
          runInAction(() => {
            designContextState.selected = context.id;
          });
          selectedDesignInvocation = undefined;
          void runModel({file: context.functionRef.file, id: context.id});
          return false;
        }
      }
      const previousSource = viewport.sourceContext?.target.sourceRef;
      selection = cursor
        ? sourceInspectionSelection(
            nextModule,
            cursor.file,
            cursor.offset,
            preferredEvaluationContextId,
            previousSource?.end === cursor.offset ? previousSource : undefined,
          )
        : undefined;
      inspectionDiagnostic = undefined;
      try {
        scene = selection
          ? await compiler.inspect(nextModule, selection)
          : undefined;
      } catch (error) {
        inspectionDiagnostic = diagnosticFromError(error, 'inspect');
      }
      if (!previewState.isCurrent(request, codeEditor.sourceVersion()))
        return false;
      const current = codeEditor.cursorSource();
      if (current?.file === cursor?.file && current?.offset === cursor?.offset)
        break;
      cursor = current;
    }
    const retainOnError = previewState.module !== null;
    runInAction(() => {
      previewState.accept(request, nextModule);
      previewState.inspectionDiagnostic = inspectionDiagnostic;
      codeEditor.setDesignArguments(nextModule.designArguments);
      const retainsSketch = sketchEditor.retain(cursor, nextModule.sketches);
      const currentSketch =
        cursor &&
        viewport.sourceEvaluationAt(
          nextModule,
          cursor.file,
          cursor.offset,
          preferredEvaluationContextId,
        )?.evaluation.sketchIds?.length;
      // A retained sketch belongs to the previous file until the new source
      // focus selects its replacement. Do not count it as this file's target.
      if (!retainsSketch && !currentSketch) sketchEditor.hide();
      codeEditor.trackSourceRefs([
        ...nextModule.inputs.flatMap(input => input.sourceRefs),
        ...toolSourceRefs(nextModule),
        ...sketchEditor.sourceRefs(),
      ]);
      designContextState.selected = nextModule.activeDesignContextId;
      designContextState.compiling = undefined;
      if (
        preferredEvaluationContextId === designContextId &&
        !nextModule.activeDesignContextId
      ) {
        preferredEvaluationContextId = undefined;
      }
      if (!inspectionDiagnostic) {
        if (selection)
          viewport.renderInspection(nextModule, scene, selection, selectedKey);
        else viewport.renderModule(nextModule, selectedKey, retainOnError);
        previewState.presented(hasViewportTarget(), viewport.presentedModule);
        updatePresentedSourceSelection();
      }
    });
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
    refreshViewportFeedback();
    restoreModelStatus();
    return !nextModule.diagnostic && !previewState.inspectionDiagnostic;
  } catch (error) {
    if (!previewState.isCurrent(request, codeEditor.sourceVersion()))
      return false;
    runInAction(() => {
      designContextState.compiling = undefined;
    });
    const diagnostic = diagnosticFromError(error, 'project');
    if (previewState.pendingFile || previewState.retainingView)
      clearPresentedView();
    previewState.fail(diagnostic);
    finishContextualTool();
    sketchEditor.invalidate();
    renderCurrentPanels();
    refreshViewportFeedback();
    restoreModelStatus();
    return false;
  } finally {
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
  animation.stop(true);
  modelInputs.clear();
  compiler.cancel();
  runInAction(() => {
    designContextState.compiling = undefined;
  });
  codeEditor.setDesignArguments([]);
  codeEditor.trackSourceRefs([]);
  sketchEditor.invalidate();
  if (!previewState.retainingView) clearPresentedView();
  renderElementsPanel();
}

function clearPresentedView(): void {
  sketchEditor.hide();
  viewport.renderModule(null);
}

function activeViewportDiagnostic(): ModelDiagnostic | undefined {
  const scope = sketchEditor.diagnosticScope;
  return (
    previewState.inspectionDiagnostic ??
    viewportDiagnostic(previewState.diagnostic, scope) ??
    [...previewState.warnings]
      .sort(
        (a, b) =>
          Number(!!b.relatedSketchIds?.includes(scope?.at(-1)?.id ?? '')) -
          Number(!!a.relatedSketchIds?.includes(scope?.at(-1)?.id ?? '')),
      )
      .find(warning => viewportDiagnostic(warning, scope))
  );
}

function refreshViewportFeedback(): void {
  observeViewportTarget();
  if (!previewState.busy) restoreModelStatus();
}

function renderViewportDiagnostic({
  diagnostic,
  upstream,
  editable,
}: {
  diagnostic: ModelDiagnostic | undefined;
  upstream: boolean;
  editable: boolean;
}): void {
  viewportDiagnosticStack.replaceChildren();
  viewportDiagnosticStack.hidden = !diagnostic;
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
    button.disabled = upstream || !editable;
    if (upstream) button.title = 'Open the owning sketch to apply this fix.';
    button.addEventListener('click', () => {
      if (previewState.sourceVersion !== codeEditor.sourceVersion()) {
        refreshViewportFeedback();
        return;
      }
      if (
        commitToolSession(toolEngine.begin('diagnostic-fix'), action.intent, {
          preserveCursor: action.intent.kind === 'sketch.edit',
        })
      ) {
        refreshViewportFeedback();
      }
    });
    item.append(button);
  }
  viewportDiagnosticStack.append(item);
}

function handleCompletionFocus(focus: CompletionFocus | undefined): void {
  animation.pause();
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
  previewState.showStatus('busy');
  const revision = previewState.revision;
  completionPreviewTimer = window.setTimeout(() => {
    completionPreviewTimer = undefined;
    void runCompletionPreview(focus, revision);
  }, appSettings.value.completionDelayMs);
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
    const compilation = compiler.compile(
      preview.project,
      preview.cursor.file,
      activeDesignContext(preview.cursor),
      undefined,
      false,
      executionConfig(),
    );
    previewState.beginCompilation(focus.memberName);
    const module = await compilation;
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
    const scope = viewport.sourceEvaluationAt(
      module,
      preview.cursor.file,
      preview.cursor.offset,
      preferredEvaluationContextId,
    );
    const selection = {
      file: preview.cursor.file,
      offset: preview.cursor.offset,
      contextId: scope?.evaluation.contextId ?? preferredEvaluationContextId,
      order: scope?.evaluation.runtime.order,
      callId: scope?.evaluation.inspectCallId,
    };
    const scene = await compiler.inspect(module, selection);
    if (
      revision !== previewState.revision ||
      activeCompletionFocus !== focus ||
      preview.sourceVersion !== codeEditor.sourceVersion()
    )
      return;
    if (scene) {
      viewport.previewCompletedProject(module, scene, selection);
      renderElementsPanel(viewport.getSelected());
    }
    restoreModelStatus();
  } catch {
    if (revision === previewState.revision && activeCompletionFocus === focus) {
      restoreModelStatus();
    }
  }
}

function resumeModelAfterCompletion(): void {
  previewState.invalidate();
  compiler.cancel();
  previewState.showStatus('busy');
  scheduleModelRun(180);
}

function scheduleModelRun(delay: number): void {
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(() => {
    compileTimer = undefined;
    if (!activeCompletionFocus?.preview) void runModel();
  }, delay);
}

function requestModelUpdate(delay: number, interactive = false): void {
  animation.stop();
  pendingAgentFollow = undefined;
  activeCompletionFocus = undefined;
  window.clearTimeout(completionPreviewTimer);
  completionPreviewTimer = undefined;
  viewport.restoreTransientPreview();
  renderElementsPanel(viewport.getSelected());
  previewState.queueUpdate(interactive);
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
  const module = previewState.module;
  const scope = viewport.sourceContext;
  const cursor = codeEditor.cursorSource();
  if (
    !module ||
    !scope ||
    !cursor ||
    !scope.target.evaluations.some(value => value.contextId === contextId)
  )
    return false;
  selectedDesignInvocation = undefined;
  cancelPendingDesignCompile();
  preferredEvaluationContextId = contextId;
  runInAction(() => {
    designContextState.selected = design ? contextId : undefined;
  });
  void inspectSourceSelection(
    module,
    cursor.file,
    cursor.offset,
    undefined,
    contextId,
    scope.target.sourceRef,
  );
  return true;
}

function activateDesignContext(contextId: string): void {
  selectedDesignInvocation = undefined;
  preferredEvaluationContextId = contextId;
  runInAction(() => {
    designContextState.selected = contextId;
  });
  void runModel();
}

function cancelPendingDesignCompile(): void {
  if (!designContextState.compiling) return;
  runInAction(() => {
    designContextState.compiling = undefined;
  });
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
  const sourceFunctionId = viewport.sourceContext?.target.functionId;
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
  const sourceElement = viewport.sourceContext?.evaluation.element;
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
  const evaluationContextId = viewport.sourceContext?.evaluation.contextId;
  codeEditor.revealSource(sourceRef, true);
  void inspectSourceSelection(
    previewState.module,
    sourceRef.file,
    sourceRef.start,
    undefined,
    evaluationContextId,
  );
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

function designArgumentsView() {
  const module = previewState.module;
  const functionId = module ? inspectedFunctionId(module) : undefined;
  const activeContextId =
    viewport.sourceContext?.evaluation.contextId ?? designContextState.selected;
  return (
    module?.designArguments.filter(
      context => context.functionId === functionId,
    ) ?? []
  ).map(context => ({
    id: context.id,
    functionName: context.functionName,
    label: designArgumentCall(context),
    active: context.id === activeContextId,
    compiling: context.id === designContextState.compiling,
  }));
}

function renderDesignArguments(
  contexts: ReturnType<typeof designArgumentsView>,
): void {
  designArgumentsPanel.hidden = contexts.length === 0;
  designArgumentsCount.textContent = String(contexts.length);
  designArgumentsFunction.textContent =
    contexts[0]?.functionName ?? 'No function context';
  designArgumentsOptions.replaceChildren();
  contexts.forEach(context => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'design-argument-option';
    button.classList.toggle('active', context.active);
    button.classList.toggle('compiling', context.compiling);
    button.setAttribute('aria-pressed', String(context.active));
    button.title = context.label;
    if (context.compiling) button.setAttribute('aria-busy', 'true');
    const label = document.createElement('span');
    label.textContent = context.label;
    const state = document.createElement('span');
    state.className = 'design-argument-state';
    if (context.compiling) {
      const spinner = document.createElement('span');
      spinner.className = 'design-argument-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      state.append(spinner, 'COMPILING');
    } else state.textContent = context.active ? 'ACTIVE' : 'VIEW';
    button.append(label, state);
    button.addEventListener('click', () => {
      if (designContextState.compiling === context.id) return;
      if (!selectCompiledEvaluationContext(context.id, true))
        activateDesignContext(context.id);
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
}

function syncContextualTool(): void {
  const scope = viewport.sourceContext;
  const sourceTargetFocused = scope !== undefined;
  // A pending compilation keeps the current sketch view instead of closing it.
  const settled = previewState.sourceVersion === codeEditor.sourceVersion();
  const cursor = codeEditor.cursorSource();
  const sketches = previewState.module?.sketches ?? new Map();
  // A target that evaluates to a sketch opens its 2D editing tool directly; an
  // edit that moves the caret onto the definition keeps editing the same
  // instance instead of switching to another instance of that shared source.
  const sketchId = scope?.evaluation.sketchIds?.[0];
  if (sourceTargetFocused && previewState.module && settled && sketchId) {
    sketchEditor.select(
      sketchId,
      previewState.module.sketches,
      scope.target.sourceRef,
      JSON.stringify([
        codeEditor.currentFile(),
        previewState.module.activeDesignContextId ?? null,
      ]),
      previewState.module.objects,
    );
  } else if (settled && !sketchEditor.retain(cursor, sketches)) {
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
    previewState.module !== null &&
    previous.callId ===
      contextualToolCallId(previewState.module, scope.target) &&
    previous.contextId === scope.evaluation.contextId;
  if (previewState.sourceVersion !== codeEditor.sourceVersion()) {
    if (previous && !continuesPrevious) finishContextualTool();
    return;
  }
  const context =
    scope?.target.tool && previewState.module
      ? contextualToolContext(previewState.module, scope, ref =>
          codeEditor.readSource(ref),
        )
      : undefined;
  const occurrence = viewport.getSelected();
  const sourceTool = scope?.target.tool;
  if (!scope || !sourceTool || !context) {
    finishContextualTool();
    return;
  }
  if (previous && !continuesPrevious) finishContextualTool();
  const {
    rotationSelection: draft,
    signature,
    parameters,
    arguments: mergedArguments,
  } = context;
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
    mergedArguments.forEach(argument => {
      if (argument.target?.kind === 'present') {
        removedArguments.delete(argument.name);
      }
    });
  }
  contextualTool = {
    rotationSelection: draft,
    focus: context,
    callId: context.callId,
    contextId: scope.evaluation.contextId,
    targetId: scope.target.id,
    evaluationIndex: scope.evaluationIndex,
    sourceFile: scope.target.sourceRef.file,
    signature,
    presentArguments: continuesPrevious
      ? mergePresentArguments(previous.presentArguments, mergedArguments)
      : presentArguments(mergedArguments),
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
    id: `${tool.callId}:${tool.contextId}`,
    title: humanizeToolName(tool.signature.name),
    meta: edge
      ? `${edge.availableEdgeIds.length} AVAILABLE`
      : topology
        ? `${topology.availableIds.length} AVAILABLE`
        : undefined,
    parameters,
    selection:
      tool.rotationSelection && tool.rotationSelection.selector !== 'pivot'
        ? {
            name: tool.focus.reference?.name ?? 'rotation-reference',
            label: ['axisEdge', 'axisLine'].includes(
              tool.rotationSelection.selector,
            )
              ? 'AXIS'
              : 'PIVOT',
            summary: draftRotationReferenceLabel(tool.rotationSelection),
          }
        : topology
          ? {
              name: topology.parameter.name,
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
                name: tool.signature.parameters.find(
                  parameter => parameter.kind === 'edge',
                )!.name,
                label: 'SELECTED EDGES',
                summary: edge.hasExplicitEdgeSelection
                  ? formatEdgeIds(edge.selectedEdgeIds)
                  : 'All edges',
              }
            : viewport.positionTools.reference &&
                viewport.positionTools.reference.kind !== 'pivot'
              ? {
                  name: tool.focus.reference?.name ?? 'rotation-reference',
                  label: ['axisLine', 'axisEdge'].includes(
                    viewport.positionTools.reference.kind,
                  )
                    ? 'AXIS'
                    : 'PIVOT',
                  summary:
                    'name' in viewport.positionTools.reference
                      ? viewport.positionTools.reference.name
                      : formatTopologyId(
                          viewport.positionTools.reference.kind === 'axisEdge'
                            ? 'edge'
                            : 'vertex',
                          viewport.positionTools.reference.id,
                        ),
                }
              : undefined,
    actions,
  };
  contextualToolPanel.show(view, forceParameterValues);
}

function draftRotationReferenceLabel(
  draft: NonNullable<SourceTarget['rotationSelection']>,
): string {
  if (!draft.reference) return 'None';
  if (draft.selector === 'pivotVertex' || draft.selector === 'axisEdge') {
    try {
      const id: unknown = JSON.parse(draft.reference);
      if (isTopologyId(id))
        return formatTopologyId(
          draft.selector === 'axisEdge' ? 'edge' : 'vertex',
          id,
        );
    } catch {
      // An authored expression remains readable before its reference evaluates.
    }
  }
  return draft.reference;
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
  scope: NonNullable<ModelViewport['sourceContext']>,
  occurrence: Occurrence | undefined,
): void {
  if (scope.target.rotationSelection) {
    finishEdgeSelectionTool();
    dismissTopologyReferenceSelectionTool(false);
  } else if (scope.target.kind === 'topology-selection') {
    finishEdgeSelectionTool();
    syncTopologyReferenceSelectionProvider(scope, occurrence);
  } else {
    dismissTopologyReferenceSelectionTool();
    syncEdgeSelectionProvider(scope, occurrence);
  }
}

function syncTopologyReferenceSelectionProvider(
  scope: NonNullable<ModelViewport['sourceContext']>,
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
      // Reference picking accompanies the focused tool: keep its gizmo
      // interactive, as rotation reference picking already does.
      true,
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
}

function syncEdgeSelectionProvider(
  scope: NonNullable<ModelViewport['sourceContext']>,
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
  renderContextualToolPanel();
}

function beginRotationReferenceSelection(
  tool: 'rotate-point' | 'rotate-axis',
): void {
  const binding = viewport.positionTools.rotationBinding;
  const occurrence = viewport.getSelected();
  const draft = viewport.sourceContext?.target.rotationSelection;
  if ((!binding && !draft) || !occurrence) return;
  if (previewState.sourceVersion !== codeEditor.sourceVersion()) {
    showToolIssue(
      'Wait for the current model before selecting a new reference.',
    );
    return;
  }
  const source = binding?.spatial.source;
  const ref =
    draft?.sourceRef ??
    binding?.spatial.operationRef ??
    (source && 'sourceRef' in source ? source.sourceRef : undefined);
  if (!ref) return;
  const current = codeEditor.resolveSourceRef(ref);
  if (!current) return;
  const self = relationSelfExpression(
    current.file,
    codeEditor.readSource({
      file: current.file,
      start: 0,
      end: Number.MAX_SAFE_INTEGER,
    }),
    current,
  );
  dismissTopologyReferenceSelectionTool();
  dismissEdgeSelectionTool();
  try {
    const availableIds =
      tool === 'rotate-axis'
        ? self
          ? (occurrence.node.mesh?.edgeGroups
              .filter(group => group.linear)
              .map(group => group.edgeId) ?? [])
          : []
        : undefined;
    const hasTopology =
      tool === 'rotate-axis'
        ? !!availableIds?.length
        : !!occurrence.node.mesh?.topologyVertices.length;
    if (hasTopology)
      viewport.beginTopologySelection(
        occurrence.key,
        occurrence.node.nodeId,
        tool === 'rotate-axis' ? 'edge' : 'vertex',
        false,
        [],
        availableIds
          ? {
              geometryNodeId: occurrence.node.nodeId,
              availableIds,
              transform: {
                position: [0, 0, 0],
                quaternion: [0, 0, 0, 1],
                scale: [1, 1, 1],
              },
            }
          : undefined,
        true,
      );
    spatialToolbar.setSelection({
      binding,
      draft,
      tool,
      occurrenceKey: occurrence.key,
      sourceVersion: codeEditor.sourceVersion(),
      hasTopology,
    });
  } catch (error) {
    showToolIssue(error instanceof Error ? error.message : String(error));
  }
}

function cancelRotationReferenceSelection(): void {
  if (!spatialToolbar.selection) return;
  const {hasTopology} = spatialToolbar.selection;
  spatialToolbar.setSelection(undefined);
  if (hasTopology && viewport.selectingRotationReference)
    viewport.endTopologySelection();
}

function selectRotationReference(
  event: Extract<TopologySelectionEvent, {kind: 'change'}>,
): void {
  const expression = JSON.stringify(event.id);
  selectRotationReferenceExpression(expression);
}

function selectRotationReferenceExpression(expression: string): void {
  const selection = spatialToolbar.selection!;
  if (selection.sourceVersion !== codeEditor.sourceVersion()) {
    cancelRotationReferenceSelection();
    return;
  }
  const {binding, tool, draft} = selection;
  const source = binding?.spatial.source;
  const reference = binding?.spatial.objects.find(
    object => object.nodeId === binding.spatial.ownerNodeId,
  )?.spatial.reference;
  const selector = tool === 'rotate-axis' ? 'axisEdge' : 'pivotVertex';
  const factory = (draft?.constructors ?? binding?.spatial.constructors)?.[
    selector
  ];
  const changesRotationKind =
    (tool === 'rotate-axis') !==
    (reference?.kind === 'axisLine' || reference?.kind === 'axisEdge');
  const sourceRef =
    draft?.sourceRef ??
    binding?.spatial.operationRef ??
    (source && 'sourceRef' in source ? source.sourceRef : undefined);
  if (!sourceRef) return;
  const intent: ToolIntent = {
    kind: 'model.spatial',
    operation: 'rotation-reference',
    change: {
      kind: 'rotation-reference',
      sourceRef,
      selector,
      expression,
      draft: !!draft,
      previous: ['axisLine', 'axisEdge'].includes(
        draft?.selector ?? reference?.kind ?? '',
      )
        ? 'axis'
        : 'point',
      factory,
      append: draft
        ? undefined
        : source?.kind === 'transformation-insert'
          ? source.container
          : changesRotationKind
            ? factory?.container
            : undefined,
    },
    preview: {kind: 'model-spatial', objects: []},
  };
  cancelRotationReferenceSelection();
  commitToolSession(toolEngine.begin('viewport.rotation-reference'), intent);
}

function handleTopologySelection(event: TopologySelectionEvent): void {
  if (spatialToolbar.selection) {
    if (event.kind === 'cancel') cancelRotationReferenceSelection();
    else if (event.kind === 'change') selectRotationReference(event);
    return;
  }
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
  animation.stop();
  const scheduled = compileTimer !== undefined;
  const compiling = compiler.isCompiling();
  if (!scheduled && !compiling) return false;
  previewState.invalidate();
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  compiler.cancel();
  // The displayed geometry still predates the queued source edit. A new
  // gesture only suspends compilation; cancelling it must resume that update.
  previewState.queueUpdate(true);
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
    session.preview(
      positionIntent(event.binding, event.value, event.moveObject),
    );
    return;
  }

  if (Math.abs(event.value - event.binding.value) < 1e-9) {
    session.cancel();
    toolFeedback.report('model');
    resumeCompileAfterTool(positionToolInterruptedCompile);
  } else {
    const committed = commitToolSession(
      session,
      positionIntent(event.binding, event.value, event.moveObject),
    );
    if (!committed) resumeCompileAfterTool(positionToolInterruptedCompile);
  }
  positionToolSession = undefined;
  positionToolInterruptedCompile = false;
}

function positionIntent(
  binding: TransformGizmoBinding,
  value: number,
  moveObject = false,
): ToolIntent {
  if (binding.kind === 'spatial')
    return spatialIntent(binding, value, moveObject);
  return {
    ...parameterIntent(binding.target, value),
    completeArguments: binding.completeArguments,
  };
}

function canEditPositionBinding(binding: TransformGizmoBinding): boolean {
  if (previewState.sourceVersion === undefined) return false;
  // Observe source revision as well as checking mapped anchors after formatting/undo.
  codeEditor.sourceVersion();
  const source = binding.kind === 'spatial' ? binding.spatial.source : binding;
  const reference =
    source.kind === 'parameter' || source.kind === 'omitted-argument'
      ? source.target.sourceRef
      : source.sourceRef;
  return codeEditor.resolveSourceRef(reference) !== undefined;
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
  return binding.target.id;
}

function applyToolPreview(preview: ToolPreview): void {
  if (preview.kind === 'model-spatial') {
    viewport.setSpatialPreview(preview.objects);
  } else if (preview.kind === 'parameter') {
    viewport.setParameterPreview(preview.targetId, preview.value);
  } else if (preview.kind === 'viewport-decorations') {
    viewport.setDecorations(preview.owner, preview.decorations);
  }
}

function commitToolPreview(preview: ToolPreview): void {
  viewport.awaitToolUpdate();
  if (preview.kind === 'model-spatial') {
    viewport.commitSpatialPreview(
      preview.objects,
      preview.parameter,
      preview.continuation,
    );
  } else if (preview.kind === 'parameter') {
    viewport.commitParameterPreview(preview.targetId, preview.value);
  }
}

function clearToolPreview(preview: ToolPreview): void {
  if (preview.kind === 'model-spatial') {
    viewport.clearSpatialPreview(preview.objects);
  } else if (preview.kind === 'parameter') {
    viewport.clearParameterPreview(preview.targetId);
  } else if (preview.kind === 'viewport-decorations') {
    viewport.clearDecorations(preview.owner);
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
      ...(target.argumentListRef ? [target.argumentListRef] : []),
      ...(target.callRef ? [target.callRef] : []),
      ...(target.rotationSelection
        ? [
            target.rotationSelection.sourceRef,
            ...target.rotationSelection.calls.flatMap(call => [
              call.sourceRef,
              call.argumentListRef,
              ...call.arguments.flatMap(argument =>
                argument.target
                  ? [
                      argument.target.sourceRef,
                      ...(argument.target.kind === 'present'
                        ? [
                            argument.target.removalSourceRef,
                            ...(argument.target.focusSourceRef
                              ? [argument.target.focusSourceRef]
                              : []),
                          ]
                        : []),
                    ]
                  : [],
              ),
            ]),
          ]
        : []),
      ...(target.receiverRef ? [target.receiverRef] : []),
      ...Object.values({
        ...target.transformationInsertion,
        ...target.rotationSelection?.constructors,
      }).flatMap(insertion =>
        insertion
          ? [
              insertion.sourceRef,
              ...(insertion.importAddition
                ? [insertion.importAddition.sourceRef]
                : []),
            ]
          : [],
      ),
      ...(target.tool?.arguments.flatMap(({target}) =>
        target
          ? [
              target.sourceRef,
              ...(target.kind === 'present'
                ? [
                    target.removalSourceRef,
                    ...(target.focusSourceRef ? [target.focusSourceRef] : []),
                  ]
                : []),
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
      ...[...node.constraints, ...(node.transformations ?? [])].flatMap(
        constraint => [
          ...constraint.sourceRefs,
          ...constraint.parameters.map(parameter => parameter.target.sourceRef),
        ],
      ),
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
    viewport.sourceContext !== undefined ||
    sketchEditor.hasTarget
  );
}

function restoreModelStatus(): void {
  const sketch = sketchEditor.diagnosticScope;
  const diagnostic = sketch
    ? sketchDiagnostic(previewState.diagnostic, sketch)
    : undefined;
  const state = sketch
    ? diagnostic && diagnostic.severity !== 'warning'
      ? 'error'
      : 'ready'
    : previewState.status;
  previewState.showStatus(
    previewState.inspectionDiagnostic ? 'error' : state,
    previewState.inspectionDiagnostic
      ? 'Inspection error'
      : state === 'error'
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
