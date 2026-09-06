import {
  createTree,
  hotkeysCoreFeature,
  syncDataLoaderFeature,
  type ItemInstance,
  type TreeInstance,
} from '@headless-tree/core';
import {ChevronDown, ChevronRight, File, Folder, FolderOpen} from 'lucide';
import {createIcon} from './icons';

type ProjectTreeNode = Readonly<{
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  children: readonly string[];
}>;

type ProjectTreeOptions = Readonly<{
  onOpenFile: (path: string) => void;
  onFileContextMenu: (path: string, event: MouseEvent) => void;
}>;

type TreeItemProps = Readonly<{
  ref: (element: HTMLElement | null) => void;
  role: string;
  'aria-setsize': number;
  'aria-posinset': number;
  'aria-label': string;
  'aria-level': number;
  'aria-expanded'?: boolean;
  tabIndex: number;
  onClick: (event: MouseEvent) => void;
}>;

const rootId = 'project-root';

export class ProjectTree {
  private nodes = projectTreeNodes([]);
  private activePath = '';
  private renderPending = false;
  private readonly tree: TreeInstance<ProjectTreeNode>;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ProjectTreeOptions,
  ) {
    this.tree = createTree<ProjectTreeNode>({
      rootItemId: rootId,
      getItemName: item => item.getItemData().name,
      isItemFolder: item => item.getItemData().kind === 'folder',
      dataLoader: {
        getItem: itemId => this.requireNode(itemId),
        getChildren: itemId => [...this.requireNode(itemId).children],
      },
      onPrimaryAction: item => this.openFile(item),
      setState: () => this.scheduleRender(),
      features: [syncDataLoaderFeature, hotkeysCoreFeature],
    });

    const containerProps = this.tree.getContainerProps('Project files');
    this.container.setAttribute('role', String(containerProps.role));
    this.container.setAttribute(
      'aria-label',
      String(containerProps['aria-label']),
    );
    this.tree.registerElement(this.container);
    this.tree.setMounted(true);
    this.render();
  }

  update(paths: readonly string[], activePath: string): void {
    this.nodes = projectTreeNodes(paths);
    this.activePath = activePath;

    const state = this.tree.getState();
    const expandedItems = new Set(
      state.expandedItems.filter(itemId => this.isFolder(itemId)),
    );
    for (const itemId of ancestorFolderIds(activePath)) {
      expandedItems.add(itemId);
    }

    const focusedItem =
      state.focusedItem && this.nodes.has(state.focusedItem)
        ? state.focusedItem
        : fileId(activePath);
    this.tree.setConfig(config => ({
      ...config,
      state: {expandedItems: [...expandedItems], focusedItem},
    }));
  }

  private render(): void {
    this.renderPending = false;
    const restoreTreeFocus = this.container.contains(document.activeElement);
    const rows = this.tree.getItems().map(item => this.renderItem(item));
    this.container.replaceChildren(...rows);
    if (restoreTreeFocus) {
      this.tree.getFocusedItem().getElement()?.focus();
    }
  }

  private scheduleRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    queueMicrotask(() => this.render());
  }

  private renderItem(item: ItemInstance<ProjectTreeNode>): HTMLButtonElement {
    const node = item.getItemData();
    const props = item.getProps() as TreeItemProps;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project-tree-item ${node.kind}`;
    button.classList.toggle('active', node.path === this.activePath);
    button.style.setProperty(
      '--project-tree-level',
      String(item.getItemMeta().level),
    );
    button.title = node.path;
    button.role = props.role;
    button.tabIndex = props.tabIndex;
    button.setAttribute('aria-setsize', String(props['aria-setsize']));
    button.setAttribute('aria-posinset', String(props['aria-posinset']));
    button.setAttribute('aria-label', props['aria-label']);
    button.setAttribute('aria-level', String(props['aria-level']));
    button.setAttribute('aria-selected', String(node.path === this.activePath));
    if (props['aria-expanded'] !== undefined) {
      button.setAttribute('aria-expanded', String(props['aria-expanded']));
    }
    button.addEventListener('click', props.onClick);
    if (node.kind === 'file') {
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        this.options.onFileContextMenu(node.path, event);
      });
    }

    const chevron = document.createElement('span');
    chevron.className = 'project-tree-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const isFolder = node.kind === 'folder';
    if (isFolder) {
      chevron.append(
        createIcon(item.isExpanded() ? ChevronDown : ChevronRight),
      );
    }
    const icon = createIcon(
      isFolder ? (item.isExpanded() ? FolderOpen : Folder) : File,
      `project-entry-icon ${isFolder ? 'folder-icon' : 'file-icon'}`,
    );
    const label = document.createElement('span');
    label.className = 'project-tree-label';
    label.textContent = node.name;
    button.append(chevron, icon, label);
    props.ref(button);
    return button;
  }

  private openFile(item: ItemInstance<ProjectTreeNode>): void {
    const node = item.getItemData();
    if (node.kind === 'file') this.options.onOpenFile(node.path);
  }

  private requireNode(itemId: string): ProjectTreeNode {
    return this.nodes.get(itemId)!;
  }

  private isFolder(itemId: string): boolean {
    return this.nodes.get(itemId)?.kind === 'folder';
  }
}

function projectTreeNodes(
  paths: readonly string[],
): Map<string, ProjectTreeNode> {
  const mutableNodes = new Map<
    string,
    Omit<ProjectTreeNode, 'children'> & {children: string[]}
  >();
  mutableNodes.set(rootId, {
    id: rootId,
    kind: 'folder',
    name: 'Project',
    path: '/',
    children: [],
  });

  for (const path of paths) {
    const segments = path.slice(1).split('/');
    let parentId = rootId;
    let directoryPath = '';
    for (const segment of segments.slice(0, -1)) {
      directoryPath += `/${segment}`;
      const id = folderId(directoryPath);
      if (!mutableNodes.has(id)) {
        mutableNodes.set(id, {
          id,
          kind: 'folder',
          name: segment,
          path: directoryPath,
          children: [],
        });
        mutableNodes.get(parentId)!.children.push(id);
      }
      parentId = id;
    }

    const id = fileId(path);
    mutableNodes.set(id, {
      id,
      kind: 'file',
      name: segments.at(-1)!,
      path,
      children: [],
    });
    mutableNodes.get(parentId)!.children.push(id);
  }

  for (const node of mutableNodes.values()) {
    node.children.sort((leftId, rightId) => {
      const left = mutableNodes.get(leftId)!;
      const right = mutableNodes.get(rightId)!;
      if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }

  return mutableNodes;
}

function ancestorFolderIds(path: string): string[] {
  const segments = path.slice(1).split('/').slice(0, -1);
  const ids: string[] = [];
  let directoryPath = '';
  for (const segment of segments) {
    directoryPath += `/${segment}`;
    ids.push(folderId(directoryPath));
  }
  return ids;
}

function folderId(path: string): string {
  return `folder:${path}`;
}

function fileId(path: string): string {
  return `file:${path}`;
}
