import {action, computed, makeObservable, observableRef} from 'mobx';
import {
  defaultBrowserProjectDatabaseName,
  resetBrowserProjectFileSystem,
} from './filesystem';

export type BrowserProject = Readonly<{
  id: string;
  name: string;
  /** Initial contents; absent means an empty project. */
  template?: 'examples';
}>;

type BrowserProjectCatalog = {
  projects: readonly BrowserProject[];
  recentProjectId: string;
};

const catalogStorageKey = 'code3d-browser-projects';
const catalogLockName = 'code3d-browser-projects';
const initialProject: BrowserProject = {
  id: 'browser',
  name: 'Default project',
  template: 'examples',
};

export function browserProjectDatabaseName(id: string): string {
  return id === initialProject.id
    ? defaultBrowserProjectDatabaseName
    : `code3d-project-${id}`;
}

export function browserProjectWorkspaceId(id: string): string {
  return id === initialProject.id ? 'browser' : `browser:${id}`;
}

/** Owns the origin's project directory and this page's active project lease. */
export class BrowserProjects {
  private catalog: BrowserProjectCatalog;
  private readonly lifetime = new AbortController();
  private opening: Promise<BrowserProject> | undefined;
  private releaseProject: (() => void) | undefined;

  constructor(
    private readonly storage: Pick<
      Storage,
      'getItem' | 'setItem'
    > = localStorage,
    private readonly events: Pick<
      Window,
      'addEventListener' | 'removeEventListener'
    > = window,
    private readonly locks: Pick<LockManager, 'request'> = navigator.locks,
  ) {
    this.catalog = this.readCatalog();
    makeObservable<this, 'catalog' | 'publish'>(this, {
      catalog: observableRef,
      projects: computed,
      publish: action,
    });
    this.events.addEventListener('storage', this.receive);
    this.events.addEventListener('pagehide', this.dispose);
  }

  get signal(): AbortSignal {
    return this.lifetime.signal;
  }

  get projects(): readonly BrowserProject[] {
    return this.catalog.projects;
  }

  async create(name: string, createExamples = true): Promise<BrowserProject> {
    name = name.trim();
    if (!name) throw new Error('Enter a project name.');
    return this.withCatalog(catalog => {
      const project: BrowserProject = {
        id: crypto.randomUUID(),
        name,
        ...(createExamples ? {template: 'examples'} : {}),
      };
      catalog.projects = [...catalog.projects, project];
      return project;
    });
  }

  /** Open once per page; project switching reloads after saving the old page. */
  open(id?: string): Promise<BrowserProject> {
    return (this.opening ??= this.openProject(id));
  }

  /** Run against an unopened project after every page using it has closed. */
  runExclusive<T>(
    id: string,
    operation: (project: BrowserProject) => Promise<T>,
  ): Promise<T> {
    return this.withExclusiveProject(id, project => {
      if (!project) throw new Error('This browser project no longer exists.');
      return operation(project);
    });
  }

  async reset(
    id: string,
    initialize?: (project: BrowserProject) => Promise<void>,
  ): Promise<void> {
    await this.runExclusive(id, async () => {
      const project = await this.withCatalog(catalog => {
        const resetProject: BrowserProject = {
          ...catalog.projects.find(project => project.id === id)!,
          template: 'examples',
        };
        // A later page must resume the starter seed if initialization is interrupted.
        catalog.projects = catalog.projects.map(project =>
          project.id === id ? resetProject : project,
        );
        return resetProject;
      });
      this.lifetime.signal.throwIfAborted();
      await resetBrowserProjectFileSystem(browserProjectDatabaseName(id));
      this.lifetime.signal.throwIfAborted();
      await initialize?.(project);
    });
  }

  async remove(id: string, clearState?: () => Promise<void>): Promise<void> {
    await this.withExclusiveProject(id, async project => {
      if (!project) return;
      // Keep the entry if deletion fails, and never block unrelated projects
      // on an IndexedDB connection still held by an older page.
      await clearState?.();
      this.lifetime.signal.throwIfAborted();
      await resetBrowserProjectFileSystem(browserProjectDatabaseName(id));
      await this.withCatalog(catalog => {
        const remaining = catalog.projects.filter(project => project.id !== id);
        catalog.projects = remaining.length
          ? remaining
          : [{id: crypto.randomUUID(), name: initialProject.name}];
        if (catalog.recentProjectId === id)
          catalog.recentProjectId = catalog.projects[0]!.id;
      });
    });
  }

  /** Release only after this page's project writers have stopped. */
  readonly dispose = (): void => {
    this.lifetime.abort();
    this.releaseProject?.();
    this.releaseProject = undefined;
    this.events.removeEventListener('storage', this.receive);
    this.events.removeEventListener('pagehide', this.dispose);
  };

  private withExclusiveProject<T>(
    id: string,
    operation: (project: BrowserProject | undefined) => Promise<T>,
  ): Promise<T> {
    return this.locks.request(
      projectLockName(id),
      {signal: this.lifetime.signal},
      async () => {
        const project = await this.withCatalog(catalog =>
          catalog.projects.find(project => project.id === id),
        );
        return operation(project);
      },
    );
  }

  private async openProject(id?: string): Promise<BrowserProject> {
    for (;;) {
      const selected = await this.withCatalog(
        catalog =>
          catalog.projects.find(project => project.id === id) ??
          catalog.projects.find(
            project => project.id === catalog.recentProjectId,
          ) ??
          catalog.projects[0]!,
      );
      const project = await new Promise<BrowserProject | undefined>(
        (resolve, reject) => {
          void this.locks
            .request(
              projectLockName(selected.id),
              {mode: 'shared', signal: this.lifetime.signal},
              async () => {
                const current = await this.withCatalog(catalog => {
                  const entry = catalog.projects.find(
                    project => project.id === selected.id,
                  );
                  if (entry) catalog.recentProjectId = entry.id;
                  return entry;
                });
                // An earlier exclusive lock may have removed the selected project.
                // Re-read the directory before anyone can reopen its deleted DB.
                if (!current) {
                  resolve(undefined);
                  return;
                }
                const released = new Promise<void>(release => {
                  this.releaseProject = release;
                });
                resolve(current);
                await released;
              },
            )
            .catch(reject);
        },
      );
      if (project) return project;
    }
  }

  private async withCatalog<T>(
    operation: (catalog: BrowserProjectCatalog) => T,
  ): Promise<T> {
    return this.locks.request(
      catalogLockName,
      {signal: this.lifetime.signal},
      () => {
        const catalog = this.readCatalog();
        const result = operation(catalog);
        const serialized = JSON.stringify(catalog);
        if (this.storage.getItem(catalogStorageKey) !== serialized)
          this.storage.setItem(catalogStorageKey, serialized);
        this.publish(catalog);
        return result;
      },
    );
  }

  private publish(catalog: BrowserProjectCatalog): void {
    this.catalog = catalog;
  }

  private readonly receive = (event: StorageEvent): void => {
    if (event.key === catalogStorageKey || event.key === null)
      this.publish(this.readCatalog());
  };

  private readCatalog(): BrowserProjectCatalog {
    const serialized = this.storage.getItem(catalogStorageKey);
    if (serialized === null)
      return {projects: [initialProject], recentProjectId: initialProject.id};
    const catalog: unknown = JSON.parse(serialized);
    if (
      !catalog ||
      typeof catalog !== 'object' ||
      !('projects' in catalog) ||
      !Array.isArray(catalog.projects) ||
      catalog.projects.length === 0 ||
      !catalog.projects.every(
        project =>
          project &&
          typeof project.id === 'string' &&
          project.id.length > 0 &&
          typeof project.name === 'string' &&
          project.name.trim().length > 0 &&
          (project.template === undefined || project.template === 'examples'),
      ) ||
      new Set(catalog.projects.map(project => project.id)).size !==
        catalog.projects.length ||
      !('recentProjectId' in catalog) ||
      typeof catalog.recentProjectId !== 'string'
    )
      throw new Error('The browser project list could not be read.');
    return catalog as BrowserProjectCatalog;
  }
}

function projectLockName(id: string): string {
  return `code3d-browser-project:${id}`;
}
