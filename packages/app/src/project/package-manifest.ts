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

/** Locate scope ownership without parsing a manifest that may need recovery or error reporting. */
export async function findPackageDirectory(
  reader: ProjectFileReader,
  file: string,
): Promise<string> {
  for (
    let directory = projectDirectory(file);
    ;
    directory = projectDirectory(directory)
  ) {
    if (
      (await reader.stat(normalizeProjectPath(directory + '/package.json')))
        ?.kind === 'file'
    )
      return directory;
    if (directory === '/') return directory;
  }
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

/** A folder owns a new scope; installed package folders target their owning project. */
export async function packageInstallDirectory(
  reader: ProjectFileReader,
  directory: string,
): Promise<string> {
  directory = normalizeProjectPath(directory);
  const modules = /^(.*?)\/node_modules(?:\/|$)/.exec(directory);
  if (!modules) return directory;
  return (
    await findPackageScope(
      reader,
      normalizeProjectPath(modules[1] + '/package.json'),
    )
  ).directory;
}

export function parsePackageSpecifier(specifier: string): {
  name: string;
  range: string;
} {
  specifier = specifier.trim();
  const separator = specifier.indexOf('@', 1);
  const name = separator === -1 ? specifier : specifier.slice(0, separator);
  const range =
    separator === -1 ? 'latest' : specifier.slice(separator + 1).trim();
  assertPackageName(name);
  if (!range) throw new Error('Enter a version or omit @ to use latest.');
  return {name, range};
}

/** Add core only when creating a manifest, preserving an existing project's choices. */
export function addPackageDependency(
  manifest: PackageManifest | undefined,
  specifier: string,
): PackageManifest {
  const {name, range} = parsePackageSpecifier(specifier);
  const result: PackageManifest = manifest
    ? {...manifest}
    : {
        private: true,
        type: 'module',
        dependencies: {'@code3d/core': 'latest'},
      };
  let replaced = false;
  for (const field of dependencyFields) {
    if (!Object.hasOwn(result[field] ?? {}, name)) continue;
    result[field] = {...result[field], [name]: range};
    replaced = true;
  }
  if (!replaced) result.dependencies = {...result.dependencies, [name]: range};
  return result;
}
