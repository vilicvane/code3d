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
  topLevelProjectPaths,
  type ProjectEntry,
  type ProjectEntryOperation,
} from '../project/file-operations';
import {
  normalizeProjectPath,
  projectDirectory,
  projectPathIsWithin,
} from '../project/project';

type ProjectTreeOptions = Readonly<{
  entries(): Promise<readonly ProjectEntry[]>;
  onOpenFile(path: string, takeFocus: boolean): Promise<void>;
  onOperation(operation: ProjectEntryOperation): Promise<void>;
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
  private dragging = false;
  private refreshVersion = 0;
  private clipboard?: {kind: 'copy' | 'move'; paths: readonly string[]};
  private readonly status = document.createElement('div');
  private rootMenu?: HTMLElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ProjectTreeOptions,
  ) {
    this.status.className = 'project-status';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');
    container.after(this.status);
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
      },
      renaming: {
        canRename: () => !this.busy,
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
        canDrag: () => !this.busy,
        canDrop: () => !this.busy,
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
          render: (item, context) => this.menu(item, context),
        },
      },
      unsafeCSS: `
        [data-file-tree-virtualized-scroll] { scrollbar-width: thin; scrollbar-color: #41473b transparent; }
        [data-file-tree-virtualized-scroll]:hover { scrollbar-color: #59614f transparent; }
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
        [data-item-section="decoration"] { font-size: 9px; }
        [data-item-section="icon"] > svg {
          width: var(--trees-icon-width);
          height: var(--trees-icon-width);
        }
      `,
    });
    this.tree.render({fileTreeContainer: container});
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
      this.closeRootMenu();
      const menu = this.menu(undefined, {
        close: () => this.closeRootMenu(),
        restoreFocus: () => this.tree.focusFirstItem(),
        anchorElement: container,
        anchorRect: container.getBoundingClientRect(),
      });
      menu.classList.add('project-root-menu');
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      document.body.append(menu);
      this.rootMenu = menu;
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(0, Math.min(event.clientX, innerWidth - rect.width))}px`;
      menu.style.top = `${Math.max(0, Math.min(event.clientY, innerHeight - rect.height))}px`;
    });
    document.addEventListener('pointerdown', event => {
      if (this.rootMenu && !this.rootMenu.contains(event.target as Node))
        this.closeRootMenu();
    });
    window.addEventListener('pagehide', event => {
      if (!event.persisted) this.tree.cleanUp();
    });
  }

  async refresh(): Promise<void> {
    const version = ++this.refreshVersion;
    try {
      const entries = await this.options.entries();
      if (version !== this.refreshVersion) return;
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
      this.entries = new Map(entries.map(entry => [entry.path, entry]));
      this.synchronizing = true;
      try {
        this.tree.resetPaths(entries.map(treePath), {
          initialExpandedPaths: expanded,
        });
        if (selected.length) {
          for (const path of this.tree.getSelectedPaths())
            this.tree.getItem(path)?.deselect();
          for (const path of selected) this.tree.getItem(path)?.select();
        } else this.syncActiveFile();
      } finally {
        this.synchronizing = false;
      }
    } catch (error) {
      this.showError(error);
    }
  }

  setActiveFile(path: string | undefined): void {
    if (path === this.activePath) return;
    this.activePath = path;
    if (this.busy) return;
    if (
      path &&
      this.tree.getSelectedPaths().length === 1 &&
      this.tree.getSelectedPaths()[0] === path.slice(1)
    )
      return;
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

  search(): void {
    this.tree.openSearch();
  }

  showError(error: unknown): void {
    this.status.textContent =
      error instanceof Error ? error.message : String(error);
    this.status.hidden = false;
  }

  async create(
    kind: ProjectEntry['kind'],
    directory = this.targetDirectory(),
  ): Promise<void> {
    if (this.busy) return;
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
    if (!paths.length) return;
    this.clipboard = {kind, paths};
    this.tree.render({fileTreeContainer: this.container});
  }

  private async paste(directory = this.targetDirectory()): Promise<void> {
    const clipboard = this.clipboard;
    if (!clipboard || this.busy) return;
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
    if (!paths.length || this.busy) return;
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
    action('New file', () => void this.create('file', directory));
    action('New folder', () => void this.create('directory', directory));
    separator();
    action(
      'Rename',
      () => this.tree.startRenaming(item!.path),
      paths.length === 1,
      'F2',
    );
    action(
      'Cut',
      () => this.copy('move', paths),
      !!paths.length,
      commandKey + 'X',
    );
    action(
      'Copy',
      () => this.copy('copy', paths),
      !!paths.length,
      commandKey + 'C',
    );
    action(
      'Paste',
      () => void this.paste(directory),
      !!this.clipboard,
      commandKey + 'V',
    );
    separator();
    action(
      'Delete',
      () => void this.remove(paths),
      !!paths.length,
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

  private closeRootMenu(): void {
    this.rootMenu?.remove();
    this.rootMenu = undefined;
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
    if (command && key === 'c') this.copy('copy');
    else if (command && key === 'x') this.copy('move');
    else if (command && key === 'v') void this.paste();
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
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog project-entry-dialog';
    dialog.setAttribute(
      'aria-label',
      kind === 'file' ? 'New file' : 'New folder',
    );
    const form = document.createElement('form');
    form.className = 'app-dialog-content';
    const heading = document.createElement('h2');
    heading.textContent = kind === 'file' ? 'New file' : 'New folder';
    const location = document.createElement('p');
    location.textContent = `In ${directory}`;
    const input = document.createElement('input');
    input.required = true;
    input.setAttribute('aria-label', 'Name');
    input.value = kind === 'file' ? 'untitled.ts' : 'new-folder';
    const header = document.createElement('header');
    header.append(heading, location);
    const field = document.createElement('label');
    const label = document.createElement('span');
    label.textContent = 'Name';
    field.append(label, input);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dialog-button';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'dialog-button button-primary';
    submit.textContent = 'Create';
    const footer = document.createElement('footer');
    footer.append(cancel, submit);
    form.append(header, field, footer);
    dialog.append(form);
    document.body.append(dialog);
    let name: string | undefined;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = input.value.trim();
      const invalid =
        !value || value === '.' || value === '..' || /[\\/\0]/.test(value);
      input.setCustomValidity(
        invalid
          ? 'Enter a file or folder name without slashes.'
          : this.entries.has(normalizeProjectPath(`${directory}/${value}`))
            ? 'An entry with this name already exists.'
            : '',
      );
      if (!form.reportValidity()) return;
      name = value;
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
          resolve(name);
        },
        {once: true},
      ),
    );
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
