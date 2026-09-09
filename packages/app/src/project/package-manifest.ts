import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';

export type PackageManifest = {
  name?: string;
  version?: string;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, {optional?: boolean}>;
  [field: string]: unknown;
};

export const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export function parsePackageManifest(
  source: string,
  path: string,
): PackageManifest {
  let value: PackageManifest;
  try {
    value = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    for (const field of dependencyFields) {
      const dependencies = value[field];
      if (dependencies === undefined) continue;
      if (
        !dependencies ||
        typeof dependencies !== 'object' ||
        Array.isArray(dependencies)
      )
        throw new Error();
      for (const [name, range] of Object.entries(dependencies)) {
        assertPackageName(name);
        if (typeof range !== 'string' || !range.trim()) throw new Error();
      }
    }
  } catch {
    throw new Error(
      `Invalid ${path}: expected a JSON object with package names and version strings.`,
    );
  }
  return value;
}

export function assertPackageName(name: string): void {
  if (!/^(?:@[a-z0-9_~][a-z0-9._~-]*\/)?[a-z0-9_~][a-z0-9._~-]*$/i.test(name))
    throw new Error(`Invalid npm package name: ${name}`);
}

export function manifestDependencies(
  manifest: PackageManifest,
  root = true,
): Record<string, string> {
  return {
    ...(root ? manifest.devDependencies : {}),
    ...Object.fromEntries(
      Object.entries(manifest.peerDependencies ?? {}).filter(
        ([name]) => !manifest.peerDependenciesMeta?.[name]?.optional,
      ),
    ),
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
}

export async function findPackageScope(
  reader: ProjectFileReader,
  file: string,
): Promise<{
  directory: string;
  manifest?: PackageManifest;
}> {
  for (
    let directory = projectDirectory(file);
    ;
    directory = projectDirectory(directory)
  ) {
    const path = normalizeProjectPath(directory + '/package.json');
    const bytes = await reader.readFile(path);
    if (bytes !== undefined)
      return {
        directory,
        manifest: parsePackageManifest(decodeProjectFile(bytes), path),
      };
    if (directory === '/') return {directory};
  }
}

export function validateBrowserManifest(manifest: PackageManifest): void {
  if (manifest.workspaces || manifest.overrides || manifest.resolutions)
    throw new Error(
      'Browser installs use independent package.json files; workspaces and dependency overrides are not supported.',
    );
}
