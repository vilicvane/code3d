import type {PackageManifest} from './package-manifest';
import {
  findPackageScope,
  manifestDependencies,
  parsePackageSpecifier,
} from './package-manifest';
import type {NpmPackage} from './npm-registry';
import type {ProjectFileReader, ProjectFileInfo} from './file-reader';
import {normalizeProjectPath} from './project';

export type WorkspacePackage = {
  manifest: PackageManifest & {name: string; version: string};
  revision: string;
  files: Record<string, {version: string; url: string}>;
};
export type WorkspacePackages = Readonly<Record<string, WorkspacePackage>>;
export type WorkspaceArtifact = {
  name: string;
  version: string;
  workspace: string;
};
export type PackageArtifact = NpmPackage | WorkspaceArtifact;

export const workspacePackageUrl = (pkg: WorkspaceArtifact): `${string}/` =>
  `https://code3d.invalid/workspace/${encodeURIComponent(pkg.name)}/${pkg.workspace}/`;

export function latestWorkspace(
  packages: WorkspacePackages,
  name: string,
  range: string,
): WorkspacePackage | undefined {
  if (range.startsWith('npm:')) {
    const alias = parsePackageSpecifier(range.slice(4));
    name = alias.name;
    range = alias.range;
  }
  return name.startsWith('@code3d/') && range.trim() === 'latest'
    ? packages[name]
    : undefined;
}

export function workspaceArtifact(pkg: WorkspacePackage): WorkspaceArtifact {
  return {
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    workspace: pkg.revision,
  };
}

/** Changes in emitted bytes invalidate old installations even without an npm version change. */
export function workspaceSignature(packages: WorkspacePackages): string {
  return JSON.stringify(
    Object.entries(packages)
      .map(([name, pkg]) => [name, pkg.revision])
      .sort(),
  );
}

const workspaceRoot = '/node_modules/.code3d-workspace';

/** Local folders keep their disk installation; latest imports share the actual development package closure. */
export class WorkspaceFileReader implements ProjectFileReader {
  constructor(
    private readonly project: ProjectFileReader,
    private readonly artifacts: ProjectFileReader,
    private readonly packages: WorkspacePackages,
  ) {}

  private async target(path: string): Promise<string | true | undefined> {
    if (!Object.keys(this.packages).length) return undefined;
    if (path.startsWith(workspaceRoot + '/'))
      return path.slice(workspaceRoot.length);
    const match = /^(.*)\/node_modules\/(@[^/]+\/[^/]+|[^/]+)(.*)$/.exec(path);
    if (match) {
      const {manifest} = await findPackageScope(
        this.project,
        normalizeProjectPath(match[1] + '/__lookup.ts'),
      );
      const range = manifestDependencies(manifest ?? {})[match[2]];
      const local = range && latestWorkspace(this.packages, match[2], range);
      if (local) return '/node_modules/' + local.manifest.name + match[3];
    }
    const container = /^(.*)\/node_modules(?:\/@code3d)?$/.exec(path);
    if (container) {
      const {manifest} = await findPackageScope(
        this.project,
        normalizeProjectPath(container[1] + '/__lookup.ts'),
      );
      if (
        Object.entries(manifestDependencies(manifest ?? {})).some(
          ([name, range]) => latestWorkspace(this.packages, name, range),
        )
      )
        return true;
    }
    return undefined;
  }

  async readFile(path: string): Promise<Uint8Array | undefined> {
    path = normalizeProjectPath(path);
    const target = await this.target(path);
    return typeof target === 'string'
      ? this.artifacts.readFile(target)
      : target
        ? undefined
        : this.project.readFile(path);
  }

  async stat(path: string): Promise<ProjectFileInfo | undefined> {
    path = normalizeProjectPath(path);
    const target = await this.target(path);
    if (target === true)
      return {kind: 'directory', version: workspaceSignature(this.packages)};
    if (target === undefined) return this.project.stat(path);
    const info = await this.artifacts.stat(target);
    return (
      info && {...info, realPath: workspaceRoot + (info.realPath ?? target)}
    );
  }
}
