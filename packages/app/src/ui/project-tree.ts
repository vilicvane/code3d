import {
  FileTree,
  type ContextMenuItem,
  type ContextMenuOpenContext,
  type FileTreeRowDecoration,
  type FileTreeItemHandle,
  type FileTreeDirectoryHandle,
} from '@pierre/trees';
import type {AgentLocation} from '../editor';
import {
  PackageInstallationError,
  type PackageInstallationProgress,
} from '../project/browser-package-manager';
import {mapProjectIO} from '../project/io';
import {parsePackageSpecifier} from '../project/package-manifest';
import {
  topLevelProjectPaths,
  isProtectedProjectPath,
  type ProjectEntry,
  type ProjectEntryOperation,
} from '../project/file-operations';
import {
  normalizeProjectPath,
  projectDirectory,
  projectPathIsWithin,
} from '../project/project';

type ProjectTreeOptions = Readonly<{
  entries(directory: string): Promise<readonly ProjectEntry[]>;
  searchEntries(
    cancelled: () => boolean,
    onEntries: (entries: ProjectEntry[]) => void,
  ): Promise<void>;
  onOpenFile(path: string, takeFocus: boolean): Promise<void>;
  onOperation(operation: ProjectEntryOperation): Promise<void>;
  examples?: Readonly<{directory: string; reset(): Promise<void>}>;
  onInstallPackage?(directory: string): Promise<void>;
  onUpdateDependencies?(directory: string): Promise<void>;
  onBusy(busy: boolean): void;
}>;

/** Pierre owns tree interactions; the project session owns filesystem mutations. */
export class ProjectTree {
  private readonly tree: FileTree;
  private entries = new Map<string, ProjectEntry>();
  private activePath: string | undefined;
  private agentLocations: readonly AgentLocation[] = [];
  private synchronizing = false;
  private busy = false;
  private runningPackageOperation = false;
  private readonly packageProgress = new Map<
    string,
    {progress: PackageInstallationProgress; hideTimer?: number}
  >();
  private readonly packageStatus = document.createElement('div');
  private dragging = false;
  private refreshVersion = 0;
  private refreshRequested = false;
  private refreshing?: Promise<void>;
  private readonly loadedDirectories = new Set<string>();
  private readonly loadingDirectories = new Map<string, Promise<void>>();
  private readonly failedDirectories = new Set<string>();
  private expandedCheckQueued = false;
  private searchVersion = 0;
  private indexing = false;
  private indexed = false;
  private clipboard?: {kind: 'copy' | 'move'; paths: readonly string[]};
  private readonly status = document.createElement('div');
  private removeMenu?: () => void;
  private closeMenu?: ContextMenuOpenContext['close'];

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ProjectTreeOptions,
  ) {
    container.tabIndex = -1;
    this.status.className = 'project-status';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');
    this.packageStatus.className = 'project-status package-status';
    this.packageStatus.hidden = true;
    this.packageStatus.setAttribute('role', 'status');
    this.packageStatus.setAttribute('aria-label', 'Package installation');
    container.after(this.packageStatus, this.status);
    this.tree = new FileTree({
      paths: [],
      density: 'compact',
      search: true,
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      onSelectionChange: paths => {
        if (
          this.synchronizing ||
          this.busy ||
          this.dragging ||
          paths.length !== 1
        )
          return;
        const path = normalizeProjectPath(paths[0]);
        if (this.entries.get(path)?.kind === 'file') this.openFile(path, false);
        else {
          this.failedDirectories.delete(path);
          void this.loadDirectory(path).catch(error => this.showError(error));
        }
      },
      onSearchChange: value => {
        if (this.synchronizing) return;
        if (value === null || value === '') {
          this.searchVersion++;
          this.indexing = false;
        } else void this.indexEntries();
      },
      renaming: {
        canRename: item => !this.busy && !isProtectedProjectPath(item.path),
        onError: message => this.showError(new Error(message)),
        onRename: ({sourcePath, destinationPath}) => {
          // Pierre moves its model synchronously after this callback returns.
          queueMicrotask(
            () =>
              void this.perform({
                kind: 'move',
                entries: [
                  {
                    from: normalizeProjectPath(sourcePath),
                    to: normalizeProjectPath(destinationPath),
                  },
                ],
              }),
          );
        },
      },
      dragAndDrop: {
        canDrag: paths =>
          !this.busy && paths.every(path => !isProtectedProjectPath(path)),
        canDrop: context =>
          !this.busy &&
          !isProtectedProjectPath(context.target.directoryPath ?? '/'),
        onDropError: message => this.showError(new Error(message)),
        onDropComplete: ({draggedPaths, target}) => {
          const directory = normalizeProjectPath(target.directoryPath ?? '/');
          const entries = topLevelProjectPaths(draggedPaths)
            .map(from => ({
              from,
              to: normalizeProjectPath(`${directory}/${basename(from)}`),
            }))
            .filter(({from, to}) => from !== to);
          void this.perform({kind: 'move', entries});
        },
      },
      renderRowDecoration: ({item}) => this.decoration(item),
      composition: {
        contextMenu: {
          enabled: true,
          triggerMode: 'right-click',
          onOpen: (item, context) => this.showMenu(item, context),
          onClose: () => this.removeMenu?.(),
        },
      },
      unsafeCSS: `
        :host(:focus) [role="tree"]:not(:focus-within) {
          box-shadow: inset 0 0 0 var(--trees-focus-ring-width) var(--trees-focus-ring-color);
        }
        [data-file-tree-virtualized-scroll] {
          overflow: auto;
          padding-inline: 0;
          padding-block-end: var(--trees-item-height);
          scrollbar-gutter: auto;
          scrollbar-width: thin;
          scrollbar-color: #41473b transparent;
        }
        [data-file-tree-virtualized-scroll]:hover { scrollbar-color: #59614f transparent; }
        [data-file-tree-virtualized-list] { width: max-content; min-width: 100%; }
        [data-type="item"] {
          --trees-border-radius: 0px;
          padding-inline-start: var(--trees-padding-inline);
          /* Include the text dot's side bearing in its visual edge spacing. */
          padding-inline-end: 8.5px;
        }
        [data-item-section="content"] {
          flex: none;
          max-width: none;
          overflow: visible;
          text-overflow: clip;
        }
        /* Give every path segment its full width, including middle-truncated file names. */
        [data-item-section="content"] [data-truncate-container] { min-width: max-content; }
        [data-item-section="content"] [data-truncate-marker-cell] { visibility: hidden; }
        [data-file-tree-search-container] {
          padding: 8px var(--trees-padding-inline) 6px;
          margin: 0;
        }
        [data-file-tree-search-input] {
          box-sizing: border-box;
          min-width: 0;
          width: 100%;
          height: 28px;
          margin: 0;
          padding: 0 8px;
          line-height: 18px;
          border-radius: 3px;
        }
        [data-file-tree-search-input]:focus-visible,
        [data-file-tree-search-input][data-file-tree-search-input-fake-focus="true"] {
          border-color: var(--trees-focus-ring-color);
          outline: none;
        }
        [data-item-rename-input] {
          height: 22px;
          padding: 0 6px;
          line-height: 18px;
          color: var(--trees-selected-fg);
          border: 1px solid var(--trees-focus-ring-color);
          border-radius: 2px;
          background: var(--trees-input-bg);
        }
        [data-type="item"]:has([data-item-rename-input])::before { outline: none; }
        [data-file-tree-search-input]::selection,
        [data-item-rename-input]::selection { color: #edf0e7; background: #465635; }
        [data-item-section="decoration"] { font-size: 12px; }
        /* Center the visible dot, which sits below the font's line-box center. */
        [data-item-section="decoration"] > span { transform: translateY(-1px); }
        [data-item-section="icon"] > svg {
          width: var(--trees-icon-width);
          height: var(--trees-icon-width);
        }
      `,
    });
    this.tree.render({fileTreeContainer: container});
    this.tree.subscribe(() => {
      if (this.synchronizing || this.expandedCheckQueued) return;
      this.expandedCheckQueued = true;
      queueMicrotask(() => {
        this.expandedCheckQueued = false;
        if (this.tree.getSearchValue()) return;
        const expanded = [...this.entries.values()].filter(entry => {
          const item = this.tree.getItem(treePath(entry));
          return (
            isDirectoryItem(item) &&
            item.isExpanded() &&
            !this.failedDirectories.has(entry.path)
          );
        });
        void mapProjectIO(expanded, entry =>
          this.loadDirectory(entry.path),
        ).catch(error => this.showError(error));
      });
    });
    container.addEventListener(
      'dragstart',
      () => {
        this.dragging = true;
      },
      {capture: true},
    );
    container.addEventListener('dragend', () => {
      this.dragging = false;
    });
    container.addEventListener('keydown', event => this.onKeyDown(event));
    container.addEventListener('dblclick', () => {
      const path = this.tree.getFocusedPath();
      if (path && this.entries.get(normalizeProjectPath(path))?.kind === 'file')
        this.openFile(normalizeProjectPath(path), true);
    });
    container.addEventListener('contextmenu', event => {
      if (event.defaultPrevented || this.busy) return;
      event.preventDefault();
      this.closeMenu?.({restoreFocus: false});
      this.showMenu(undefined, {
        close: options => {
          this.removeMenu?.();
          if (options?.restoreFocus !== false) this.tree.focusFirstItem();
        },
        restoreFocus: () => this.tree.focusFirstItem(),
        anchorElement: container,
        anchorRect: new DOMRect(event.clientX, event.clientY, 0, 0),
      });
    });
    window.addEventListener('pagehide', event => {
      if (!event.persisted) {
        this.closeMenu?.({restoreFocus: false});
        this.tree.cleanUp();
      }
    });
  }

  refresh(): Promise<void> {
    this.refreshRequested = true;
    return (this.refreshing ??= this.refreshLoop().finally(() => {
      this.refreshing = undefined;
    }));
  }

  private async refreshLoop(): Promise<void> {
    while (this.refreshRequested) {
      this.refreshRequested = false;
      await this.refreshEntries();
    }
  }

  private async refreshEntries(): Promise<void> {
    const expanded = [...this.entries.values()]
      .filter(entry => {
        const item = this.tree.getItem(treePath(entry));
        return isDirectoryItem(item) && item.isExpanded();
      })
      .map(entry => entry.path);
    const version = ++this.refreshVersion;
    this.searchVersion++;
    this.indexing = false;
    this.indexed = false;
    this.loadedDirectories.clear();
    this.loadingDirectories.clear();
    this.failedDirectories.clear();
    this.entries.clear();
    try {
      await this.loadDirectory('/', version);
      await mapProjectIO(expanded, async path => {
        await this.revealDirectory(path, version);
        if (version !== this.refreshVersion) return;
        const item = this.tree.getItem(path.slice(1) + '/');
        if (isDirectoryItem(item)) item.expand();
      });
      await this.revealActiveFile(version);
      if (this.tree.getSearchValue()) await this.indexEntries();
    } catch (error) {
      if (version === this.refreshVersion) this.showError(error);
    }
  }

  private loadDirectory(
    path: string,
    version = this.refreshVersion,
  ): Promise<void> {
    if (version !== this.refreshVersion || this.loadedDirectories.has(path))
      return Promise.resolve();
    const pending = this.loadingDirectories.get(path);
    if (pending) return pending;
    const loading = this.options
      .entries(path)
      .then(entries => {
        if (version !== this.refreshVersion) return;
        for (const entry of entries) this.entries.set(entry.path, entry);
        this.loadedDirectories.add(path);
        this.renderEntries();
      })
      .catch(error => {
        if (version === this.refreshVersion) this.failedDirectories.add(path);
        throw error;
      })
      .finally(() => {
        if (this.loadingDirectories.get(path) === loading)
          this.loadingDirectories.delete(path);
      });
    this.loadingDirectories.set(path, loading);
    return loading;
  }

  private async revealDirectory(
    path: string,
    version = this.refreshVersion,
  ): Promise<void> {
    await this.loadDirectory('/', version);
    const segments = path.split('/').filter(Boolean);
    for (let depth = 1; depth <= segments.length; depth++) {
      if (version !== this.refreshVersion) return;
      const directory = '/' + segments.slice(0, depth).join('/');
      if (this.entries.get(directory)?.kind !== 'directory') return;
      await this.loadDirectory(directory, version);
    }
  }

  private renderEntries(): void {
    const entries = [...this.entries.values()];
    const expanded = entries
      .filter(entry => {
        const item = this.tree.getItem(treePath(entry));
        return isDirectoryItem(item) && item.isExpanded();
      })
      .map(treePath);
    const nextPaths = new Set(entries.map(treePath));
    const selected = this.tree
      .getSelectedPaths()
      .filter(path => nextPaths.has(path));
    this.synchronizing = true;
    try {
      const search = this.tree.getSearchValue();
      this.tree.resetPaths(entries.map(treePath), {
        initialExpandedPaths: expanded,
      });
      // Pierre preserves the query on reset but needs it reapplied to index new paths.
      if (search) {
        this.tree.setSearch('');
        this.tree.setSearch(search);
      }
      if (selected.length) {
        for (const path of this.tree.getSelectedPaths())
          this.tree.getItem(path)?.deselect();
        for (const path of selected) this.tree.getItem(path)?.select();
      } else this.syncActiveFile();
    } finally {
      this.synchronizing = false;
    }
  }

  private async indexEntries(): Promise<void> {
    if (this.indexing || this.indexed) return;
    this.indexing = true;
    const version = ++this.searchVersion;
    const cancelled = () => version !== this.searchVersion;
    try {
      await this.options.searchEntries(cancelled, entries => {
        const added = entries.filter(entry => !this.entries.has(entry.path));
        for (const entry of entries) this.entries.set(entry.path, entry);
        if (!added.length) return;
        this.synchronizing = true;
        try {
          // Mutations update Pierre's active search index; resetPaths does not.
          this.tree.batch(
            added.map(entry => ({type: 'add', path: treePath(entry)})),
          );
        } finally {
          this.synchronizing = false;
        }
      });
      if (!cancelled()) this.indexed = true;
    } catch (error) {
      if (!cancelled()) this.showError(error);
    } finally {
      if (!cancelled()) this.indexing = false;
    }
  }

  setActiveFile(path: string | undefined): void {
    if (path === this.activePath) return;
    this.activePath = path;
    if (this.busy) return;
    void this.revealActiveFile().catch(error => this.showError(error));
  }

  private async revealActiveFile(version = this.refreshVersion): Promise<void> {
    const path = this.activePath;
    if (path) await this.revealDirectory(projectDirectory(path), version);
    if (version !== this.refreshVersion || path !== this.activePath) return;
    this.synchronizing = true;
    try {
      this.syncActiveFile();
    } finally {
      this.synchronizing = false;
    }
  }

  private syncActiveFile(): void {
    for (const path of this.tree.getSelectedPaths())
      this.tree.getItem(path)?.deselect();
    if (!this.activePath) return;
    const item = this.tree.getItem(this.activePath.slice(1));
    if (!item) return;
    const segments = this.activePath.slice(1).split('/');
    for (let depth = 1; depth < segments.length; depth++) {
      const directory = this.tree.getItem(
        segments.slice(0, depth).join('/') + '/',
      );
      if (isDirectoryItem(directory)) directory.expand();
    }
    item.select();
    this.tree.scrollToPath(this.activePath.slice(1));
  }

  setAgentLocations(locations: readonly AgentLocation[]): void {
    this.agentLocations = locations;
    this.tree.render({fileTreeContainer: this.container});
  }

  async focusDirectory(path: string, cancelled: () => boolean): Promise<void> {
    await this.refresh();
    if (cancelled()) return;
    const version = this.refreshVersion;
    await this.revealDirectory(path, version);
    if (cancelled() || version !== this.refreshVersion) return;
    this.tree.closeSearch();
    let rowPath: string | undefined;
    this.synchronizing = true;
    try {
      for (const selected of this.tree.getSelectedPaths())
        this.tree.getItem(selected)?.deselect();
      const segments = path.split('/').filter(Boolean);
      for (let depth = 1; depth <= segments.length; depth++) {
        const item = this.tree.getItem(
          segments.slice(0, depth).join('/') + '/',
        );
        if (isDirectoryItem(item)) item.expand();
      }
      if (path !== '/') {
        const target = path.slice(1) + '/';
        // A compact directory chain is one row identified by its last segment.
        rowPath = this.tree
          .getVisibleRows(0, this.tree.getVisibleCount() - 1)
          .find(
            row =>
              row.path === target ||
              row.flattenedSegments?.some(segment => segment.path === target),
          )?.path;
        if (!rowPath) return;
        this.tree.getItem(rowPath)!.select();
        this.tree.scrollToPath(rowPath, {focus: true});
      } else {
        const first = this.tree.getVisibleRows(0, 0)[0];
        if (first)
          this.tree.scrollToPath(first.path, {focus: false, offset: 'top'});
      }
    } finally {
      this.synchronizing = false;
    }
    await this.focusTreeTarget(
      rowPath,
      () => cancelled() || version !== this.refreshVersion,
    );
  }

  private async focusTreeTarget(
    rowPath: string | undefined,
    cancelled: () => boolean,
  ): Promise<void> {
    // Scrolling queues a second render to mount the new virtual rows. Wait for
    // that render before taking DOM focus, which Pierre leaves with its owner.
    this.tree.render({fileTreeContainer: this.container});
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (cancelled()) return;
    // Pierre reserves its inner root for row focus. The host represents the
    // project root and keeps that focus separate from the last focused row.
    const target = rowPath
      ? this.container.shadowRoot!.querySelector<HTMLElement>(
          `[role="treeitem"][data-item-path="${CSS.escape(rowPath)}"]`,
        )
      : this.container;
    target?.focus({preventScroll: true});
  }

  search(): void {
    this.tree.openSearch();
  }

  showError(error: unknown): void {
    if (error instanceof PackageInstallationError) return;
    this.status.textContent =
      error instanceof Error ? error.message : String(error);
    this.status.hidden = false;
  }

  async create(
    kind: ProjectEntry['kind'],
    directory = this.targetDirectory(),
  ): Promise<void> {
    if (this.busy || isProtectedProjectPath(directory)) return;
    await this.loadDirectory(directory);
    const name = await this.askName(kind, directory);
    if (name === undefined) return;
    const path = normalizeProjectPath(`${directory}/${name}`);
    if (await this.perform({kind: 'create', entry: {path, kind}})) {
      if (kind === 'file') this.openFile(path, true);
      else {
        this.synchronizing = true;
        for (const selected of this.tree.getSelectedPaths())
          this.tree.getItem(selected)?.deselect();
        this.tree.getItem(path.slice(1) + '/')?.select();
        this.synchronizing = false;
        this.tree.scrollToPath(path.slice(1) + '/', {focus: true});
      }
    }
  }

  private openFile(path: string, takeFocus: boolean): void {
    this.status.hidden = true;
    void this.options
      .onOpenFile(path, takeFocus)
      .catch(error => this.showError(error));
  }

  private async perform(operation: ProjectEntryOperation): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.status.hidden = true;
    this.container.inert = true;
    this.container.setAttribute('aria-busy', 'true');
    this.options.onBusy(true);
    let succeeded = false;
    try {
      await this.options.onOperation(operation);
      succeeded = true;
    } catch (error) {
      this.showError(error);
    } finally {
      // Disk state is authoritative, including a batch's completed operations.
      await this.refresh();
      this.busy = false;
      this.container.inert = false;
      this.container.removeAttribute('aria-busy');
      this.options.onBusy(false);
    }
    return succeeded;
  }

  private async runPackageOperation(
    operation: () => Promise<void>,
  ): Promise<void> {
    if (this.runningPackageOperation) return;
    this.runningPackageOperation = true;
    this.status.hidden = true;
    if (!this.packageProgress.size) this.packageStatus.hidden = true;
    try {
      await operation();
    } catch (error) {
      this.showError(error);
    } finally {
      this.runningPackageOperation = false;
      await this.refresh();
    }
  }

  setPackageProgress(progress: PackageInstallationProgress): void {
    window.clearTimeout(
      this.packageProgress.get(progress.directory)?.hideTimer,
    );
    const hideTimer =
      progress.state === 'ready'
        ? window.setTimeout(() => {
            this.packageProgress.delete(progress.directory);
            this.renderPackageProgress();
          }, 3000)
        : undefined;
    this.packageProgress.set(progress.directory, {progress, hideTimer});
    this.renderPackageProgress();
  }

  private renderPackageProgress(): void {
    const visible = [...this.packageProgress.values()].map(
      entry => entry.progress,
    );
    this.packageStatus.hidden = visible.length === 0;
    this.packageStatus.setAttribute(
      'aria-busy',
      String(visible.some(progress => progress.state === 'busy')),
    );
    this.packageStatus.replaceChildren(
      ...visible.map(item => {
        const row = document.createElement('div');
        row.dataset.state = item.state;
        row.title = `${item.directory}: ${item.message}`;
        const directory = document.createElement('span');
        directory.className = 'package-status-directory';
        directory.textContent = item.directory;
        const message = document.createElement('span');
        message.textContent = item.message;
        row.append(directory, ': ', message);
        return row;
      }),
    );
  }

  private targetDirectory(path = this.tree.getFocusedPath() ?? '/'): string {
    const normalized = normalizeProjectPath(path);
    return this.entries.get(normalized)?.kind === 'directory' ||
      normalized === '/'
      ? normalized
      : projectDirectory(normalized);
  }

  private selectedPaths(path?: string): string[] {
    const selected = this.tree.getSelectedPaths().map(normalizeProjectPath);
    return topLevelProjectPaths(
      path && !selected.includes(path) ? [path] : selected,
    );
  }

  private copy(kind: 'copy' | 'move', paths = this.selectedPaths()): void {
    if (!paths.length || paths.some(isProtectedProjectPath)) return;
    this.clipboard = {kind, paths};
    this.tree.render({fileTreeContainer: this.container});
  }

  private async paste(directory = this.targetDirectory()): Promise<void> {
    const clipboard = this.clipboard;
    if (!clipboard || this.busy || isProtectedProjectPath(directory)) return;
    await this.loadDirectory(directory);
    const reserved = new Set(this.entries.keys());
    const entries = clipboard.paths
      .map(from => {
        let to = normalizeProjectPath(`${directory}/${basename(from)}`);
        if (clipboard.kind === 'copy') {
          let copy = 1;
          while (reserved.has(to)) {
            const name = basename(from);
            const dot =
              this.entries.get(from)?.kind === 'file'
                ? name.lastIndexOf('.')
                : -1;
            const stem = dot > 0 ? name.slice(0, dot) : name;
            const extension = dot > 0 ? name.slice(dot) : '';
            to = normalizeProjectPath(
              `${directory}/${stem} copy${copy === 1 ? '' : ` ${copy}`}${extension}`,
            );
            copy++;
          }
        }
        reserved.add(to);
        return {from, to};
      })
      .filter(({from, to}) => from !== to);
    if (!entries.length) return;
    if (await this.perform({kind: clipboard.kind, entries})) {
      if (clipboard.kind === 'move') this.clipboard = undefined;
      this.tree.render({fileTreeContainer: this.container});
    }
  }

  private async remove(paths = this.selectedPaths()): Promise<void> {
    if (!paths.length || this.busy || paths.some(isProtectedProjectPath))
      return;
    if (
      !window.confirm(
        `Delete ${paths.map(basename).join(', ')}? Directories include all their contents. This cannot be undone.`,
      )
    )
      return;
    await this.perform({kind: 'remove', paths});
  }

  private menu(
    item: ContextMenuItem | undefined,
    context: ContextMenuOpenContext,
  ): HTMLElement {
    const path = item ? normalizeProjectPath(item.path) : undefined;
    const paths = path ? this.selectedPaths(path) : [];
    const directory = path ? this.targetDirectory(path) : '/';
    const menu = document.createElement('div');
    menu.className = 'project-context-menu';
    menu.setAttribute('role', 'menu');
    const commandKey = /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl+';
    const action = (
      label: string,
      command: () => void,
      enabled = true,
      shortcut?: string,
    ) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (shortcut) {
        const keys = document.createElement('kbd');
        keys.textContent = shortcut;
        keys.setAttribute('aria-hidden', 'true');
        button.append(keys);
      }
      button.setAttribute('role', 'menuitem');
      button.disabled = !enabled || this.busy;
      button.addEventListener('click', () => {
        context.close({restoreFocus: false});
        command();
      });
      menu.append(button);
      return button;
    };
    const separator = () => {
      const rule = document.createElement('div');
      rule.className = 'project-menu-separator';
      rule.setAttribute('role', 'separator');
      menu.append(rule);
    };
    const mutable =
      paths.length > 0 && paths.every(path => !isProtectedProjectPath(path));
    const writableDirectory = !isProtectedProjectPath(directory);
    action(
      'New file',
      () => void this.create('file', directory),
      writableDirectory,
    );
    action(
      'New folder',
      () => void this.create('directory', directory),
      writableDirectory,
    );
    if (
      this.options.onInstallPackage &&
      (!path ||
        this.entries.get(path)?.kind === 'directory' ||
        basename(path) === 'package.json')
    ) {
      const project = directory.replace(/\/node_modules(?:\/.*)?$/, '');
      action(
        'Install package',
        () =>
          void this.runPackageOperation(() =>
            this.options.onInstallPackage!(directory),
          ),
        !isProtectedProjectPath(project) && !this.runningPackageOperation,
      );
    }
    if (
      this.options.onUpdateDependencies &&
      path &&
      this.entries.get(path)?.kind === 'file' &&
      basename(path) === 'package.json' &&
      !isProtectedProjectPath(path)
    )
      action(
        'Update dependencies',
        () =>
          void this.runPackageOperation(() =>
            this.options.onUpdateDependencies!(directory),
          ),
        !this.runningPackageOperation,
      );
    const examples = this.options.examples;
    if (
      examples &&
      path === examples.directory &&
      this.entries.get(path)?.kind === 'directory'
    ) {
      separator();
      action('Reset examples', () => void examples.reset());
    } else if (examples && !path && !this.entries.has(examples.directory)) {
      separator();
      action('Create examples', () => void examples.reset());
    }
    separator();
    action(
      'Rename',
      () => this.tree.startRenaming(item!.path),
      mutable && paths.length === 1,
      'F2',
    );
    action('Cut', () => this.copy('move', paths), mutable, commandKey + 'X');
    action('Copy', () => this.copy('copy', paths), mutable, commandKey + 'C');
    action(
      'Paste',
      () => void this.paste(directory),
      !!this.clipboard && writableDirectory,
      commandKey + 'V',
    );
    separator();
    action(
      'Delete',
      () => void this.remove(paths),
      mutable,
      'Del',
    ).dataset.danger = '';
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        context.close();
        event.preventDefault();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const buttons = [
          ...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
        event.preventDefault();
      }
      event.stopPropagation();
    });
    requestAnimationFrame(() =>
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
    );
    return menu;
  }

  private showMenu(
    item: ContextMenuItem | undefined,
    context: ContextMenuOpenContext,
  ): void {
    this.removeMenu?.();
    const menu = this.menu(item, context);
    // Pierre recognizes this marker when menu content is rendered in a portal.
    menu.dataset.fileTreeContextMenuRoot = 'true';
    document.body.append(menu);
    const position = () => {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(context.anchorRect.left, innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(context.anchorRect.bottom, innerHeight - rect.height - 8))}px`;
    };
    const dismiss = (event: PointerEvent) => {
      if (!event.composedPath().includes(menu))
        context.close({restoreFocus: false});
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('pointerdown', dismiss);
    this.closeMenu = context.close;
    this.removeMenu = () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('pointerdown', dismiss);
      menu.remove();
      this.closeMenu = undefined;
      this.removeMenu = undefined;
    };
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.busy || event.defaultPrevented) return;
    const target = event.composedPath()[0];
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (command && key === 'f') {
      this.search();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      event.stopPropagation();
      return;
    }
    if (
      target === this.container &&
      !command &&
      !event.altKey &&
      ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)
    ) {
      const last = event.key === 'ArrowUp' || event.key === 'End';
      const index = last ? this.tree.getVisibleCount() - 1 : 0;
      const row = this.tree.getVisibleRows(index, index)[0];
      if (row) {
        this.tree.scrollToPath(row.path, {focus: true});
        void this.focusTreeTarget(
          row.path,
          () =>
            this.tree.getFocusedPath() !== row.path ||
            document.activeElement !== this.container ||
            this.container.shadowRoot!.activeElement !== null,
        );
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (command && key === 'c') this.copy('copy');
    else if (command && key === 'x') this.copy('move');
    else if (command && key === 'v')
      void this.paste(target === this.container ? '/' : undefined);
    else if (event.key === 'Delete') void this.remove();
    else if (event.key === 'Enter') {
      const path = this.tree.getFocusedPath();
      if (
        !path ||
        this.entries.get(normalizeProjectPath(path))?.kind !== 'file'
      )
        return;
      this.openFile(normalizeProjectPath(path), true);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  private decoration(item: ContextMenuItem): FileTreeRowDecoration | null {
    const path = normalizeProjectPath(item.path);
    const directory = this.tree.getItem(item.path);
    const locations = this.agentLocations.filter(
      location =>
        location.file === path ||
        (item.kind === 'directory' &&
          isDirectoryItem(directory) &&
          !directory.isExpanded() &&
          projectPathIsWithin(location.file, path)),
    );
    const cut =
      this.clipboard?.kind === 'move' &&
      this.clipboard.paths.some(parent => projectPathIsWithin(path, parent));
    if (!locations.length && !cut) return null;
    const parts = [
      ...(cut ? [{text: '✂', color: 'var(--muted)'}] : []),
      ...locations.slice(0, 3).map(location => ({
        text: '●',
        color: `var(--agent-color-${location.color})`,
      })),
      ...(locations.length > 3 ? [{text: `+${locations.length - 3}`}] : []),
    ];
    return {
      text: parts.map(part => part.text).join(''),
      parts,
      title: [
        cut ? 'Cut — ready to move' : '',
        ...locations.map(location => `${location.name}: ${location.file}`),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  private askName(
    kind: ProjectEntry['kind'],
    directory: string,
  ): Promise<string | undefined> {
    return askProjectInput({
      title: kind === 'file' ? 'New file' : 'New folder',
      directory,
      label: 'Name',
      value: kind === 'file' ? 'untitled.ts' : 'new-folder',
      submit: 'Create',
      validate: value => {
        if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value))
          throw new Error('Enter a file or folder name without slashes.');
        if (this.entries.has(normalizeProjectPath(`${directory}/${value}`)))
          throw new Error('An entry with this name already exists.');
      },
    });
  }
}

function basename(path: string): string {
  return normalizeProjectPath(path).split('/').at(-1)!;
}
function treePath(entry: ProjectEntry): string {
  return entry.path.slice(1) + (entry.kind === 'directory' ? '/' : '');
}

function isDirectoryItem(
  item: FileTreeItemHandle | null,
): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true;
}

export function askInstallPackage(
  directory: string,
): Promise<string | undefined> {
  return askProjectInput({
    title: 'Install package',
    directory,
    label: 'Package',
    placeholder: 'just-range or @scope/package@version',
    submit: 'Install',
    validate: value => {
      parsePackageSpecifier(value);
    },
  });
}

function askProjectInput(options: {
  title: string;
  directory: string;
  label: string;
  value?: string;
  placeholder?: string;
  submit: string;
  validate(value: string): void;
}): Promise<string | undefined> {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog project-entry-dialog';
  dialog.setAttribute('aria-label', options.title);
  const form = document.createElement('form');
  form.className = 'app-dialog-content';
  const heading = document.createElement('h2');
  heading.textContent = options.title;
  const location = document.createElement('p');
  location.textContent = `In ${options.directory}`;
  const input = document.createElement('input');
  input.required = true;
  input.setAttribute('aria-label', options.label);
  input.value = options.value ?? '';
  input.placeholder = options.placeholder ?? '';
  const header = document.createElement('header');
  header.append(heading, location);
  const field = document.createElement('label');
  const label = document.createElement('span');
  label.textContent = options.label;
  field.append(label, input);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'dialog-button';
  cancel.textContent = 'Cancel';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'dialog-button button-primary';
  submit.textContent = options.submit;
  const footer = document.createElement('footer');
  footer.append(cancel, submit);
  form.append(header, field, footer);
  dialog.append(form);
  document.body.append(dialog);
  let result: string | undefined;
  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value.trim();
    try {
      options.validate(value);
      input.setCustomValidity('');
    } catch (error) {
      input.setCustomValidity((error as Error).message);
    }
    if (!form.reportValidity()) return;
    result = value;
    dialog.close();
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.showModal();
  input.focus();
  input.select();
  return new Promise(resolve =>
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        resolve(result);
      },
      {once: true},
    ),
  );
}
