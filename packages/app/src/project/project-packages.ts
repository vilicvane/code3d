import {
  decodeProjectFile,
  overlayProjectFiles,
  type ProjectFileReader,
} from './file-reader';
import {normalizeProjectPath, type ModelProject} from './project';

export const builtinPackageNames = ['@code3d/core', '@code3d/screws'] as const;
const builtinRoots = builtinPackageNames.map(name => '/node_modules/' + name);
const builtinScope = '/node_modules/@code3d';
const internalDependencies = builtinScope + '/node_modules';
const within = (path: string, root: string) =>
  path === root || path.startsWith(root + '/');
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** One effective package filesystem shared by execution, assets and TypeScript. */
export class ProjectPackages implements ProjectFileReader {
  private reader: ProjectFileReader;
  private metadata?: string;
  private effectiveMetadata = '';
  source: 'builtin' | 'project' = 'builtin';

  constructor(
    private readonly projectFiles: ProjectFileReader,
    private readonly builtinFiles: ProjectFileReader,
  ) {
    this.reader = projectFiles;
  }

  async update(project: ModelProject): Promise<boolean> {
    const reader = overlayProjectFiles(this.projectFiles, project);
    const bytes = await reader.readFile('/package.json');
    const source = bytes === undefined ? undefined : decodeProjectFile(bytes);
    let metadata;
    try {
      metadata = source === undefined ? {} : JSON.parse(source);
      if (
        metadata === null ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      )
        throw new Error('Expected a package metadata object');
    } catch {
      throw new Error('Invalid project package.json: expected valid JSON.');
    }
    const ownsCore = dependencyFields.some(field =>
      Object.hasOwn(metadata[field] ?? {}, '@code3d/core'),
    );
    const changed = source !== this.metadata;
    this.reader = reader;
    this.metadata = source;
    this.source = ownsCore ? 'project' : 'builtin';
    // A loose model defaults to ESM without writing a package.json to disk.
    this.effectiveMetadata = JSON.stringify({type: 'module', ...metadata});
    return changed;
  }

  get packageSpecifiers(): readonly string[] {
    return this.source === 'builtin' ? builtinPackageNames : [];
  }

  private builtinPath(path: string): string | undefined {
    if (builtinRoots.some(root => within(path, root))) return path;
    // Standard hierarchical node_modules lookup shares this private closure
    // between core and screws, ahead of any user-installed replicad/kernel.
    if (within(path, internalDependencies)) {
      const original = path.slice(builtinScope.length);
      // Public packages stay at their single root path, never a second copy
      // underneath the private dependency directory.
      if (!builtinRoots.some(root => within(original, root))) return original;
    }
    return undefined;
  }

  private isShadowed(path: string): boolean {
    // A reusable project package must not discover a second, nested core or
    // screws instance while the project is using the built-in runtime.
    return /\/node_modules\/@code3d\/(?:core|screws)(?:\/|$)/.test(path);
  }

  async readFile(path: string): Promise<Uint8Array | undefined> {
    path = normalizeProjectPath(path);
    if (this.source === 'project') return this.reader.readFile(path);
    if (path === '/package.json')
      return new TextEncoder().encode(this.effectiveMetadata);
    const builtin = this.builtinPath(path);
    if (builtin !== undefined) return this.builtinFiles.readFile(builtin);
    if (this.isShadowed(path)) return undefined;
    return this.reader.readFile(path);
  }

  async stat(path: string) {
    path = normalizeProjectPath(path);
    if (this.source === 'project') return this.reader.stat(path);
    if (path === '/package.json')
      return {kind: 'file' as const, version: this.effectiveMetadata};
    const builtin = this.builtinPath(path);
    if (builtin !== undefined) return this.builtinFiles.stat(builtin);
    if (this.isShadowed(path)) return undefined;
    if (path === '/node_modules' || path === builtinScope)
      return {kind: 'directory' as const, version: ''};
    return this.reader.stat(path);
  }
}
