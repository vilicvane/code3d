import {builtinPackageNames} from './builtin-packages';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {
  dependencyFields,
  manifestDependencies,
  parsePackageManifest,
  parsePackageSpecifier,
  packageResolutionKey,
  resolvedPackageDirectory,
  type PackageManifest,
} from './package-manifest';
import {normalizeProjectPath, projectDirectory} from './project';

export type PackageCompatibilityIssue = Readonly<{
  /** The first affected project scope; individual packages retain their owner. */
  directory: string;
  packages: readonly Readonly<{
    name: string;
    /** Selected installation, including aliases and nested dependency copies. */
    packagePath: string;
    /** The author's dependency name, which may be an npm alias. */
    specifier?: string;
    installed: string;
    expected: string;
    manifestPath: string;
    manual?:
      | Readonly<{reason: 'transitive'; dependency: string}>
      | Readonly<{reason: 'undeclared'}>;
  }>[];
  matchingVersions: Readonly<Record<string, string>>;
}>;

function modelingPackage(name: string, range: string): string | undefined {
  const actual = range.startsWith('npm:')
    ? parsePackageSpecifier(range.slice(4)).name
    : name;
  return builtinPackageNames.some(name => name === actual) ? actual : undefined;
}

async function readManifest(files: ProjectFileReader, path: string) {
  const bytes = await files.readFile(path);
  return bytes === undefined
    ? undefined
    : parsePackageManifest(decodeProjectFile(bytes), path);
}

async function matchingPackageVersions(files: ProjectFileReader) {
  return Object.fromEntries(
    (
      await Promise.all(
        builtinPackageNames.map(async name => {
          const manifest = await readManifest(
            files,
            '/node_modules/' + name + '/package.json',
          );
          return typeof manifest?.version === 'string'
            ? [[name, manifest.version] as const]
            : [];
        }),
      )
    ).flat(),
  );
}

type CompatibilityPackage = PackageCompatibilityIssue['packages'][number];
type DeclaredPackages = Readonly<{
  directory: string;
  packages: readonly CompatibilityPackage[];
}>;

/** One compilation owns all checks, declaration lookups and warning aggregation. */
export class PackageCompatibilityCheck {
  private readonly manifests = new Map<
    string,
    Promise<PackageManifest | undefined>
  >();
  private readonly declarations = new Map<string, Promise<DeclaredPackages>>();
  private readonly resolutions = new Map<string, Promise<void>>();
  private readonly packages = new Map<string, CompatibilityPackage>();

  private constructor(
    private readonly files: ProjectFileReader,
    private readonly matchingVersions: Readonly<Record<string, string>>,
    private readonly checkCancelled: () => void,
  ) {}

  static async create(
    files: ProjectFileReader,
    builtinFiles: ProjectFileReader,
    checkCancelled: () => void = () => {},
  ): Promise<PackageCompatibilityCheck> {
    const versions = await matchingPackageVersions(builtinFiles);
    checkCancelled();
    return new PackageCompatibilityCheck(files, versions, checkCancelled);
  }

  get issue(): PackageCompatibilityIssue | undefined {
    const packages = [...this.packages.values()];
    return packages.length
      ? {
          directory: projectDirectory(packages[0].manifestPath),
          packages,
          matchingVersions: this.matchingVersions,
        }
      : undefined;
  }

  async checkDeclared(rootPath: string): Promise<void> {
    this.checkCancelled();
    this.merge((await this.declared(rootPath)).packages);
  }

  async checkResolved(path: string, importer: string): Promise<void> {
    this.checkCancelled();
    const key = packageResolutionKey({path, importer});
    if (!key) return;
    let pending = this.resolutions.get(key);
    if (!pending) {
      pending = this.findResolved(path, importer).then(packages =>
        this.merge(packages),
      );
      this.resolutions.set(key, pending);
    }
    await pending;
  }

  private merge(packages: readonly CompatibilityPackage[]): void {
    this.checkCancelled();
    for (const pkg of packages) {
      const previous = this.packages.get(pkg.packagePath);
      if (
        !previous ||
        !pkg.manual ||
        (previous.manual?.reason === 'undeclared' &&
          pkg.manual.reason === 'transitive')
      )
        this.packages.set(pkg.packagePath, pkg);
    }
  }

  private manifest(path: string): Promise<PackageManifest | undefined> {
    let pending = this.manifests.get(path);
    if (!pending) {
      pending = readManifest(this.files, path);
      this.manifests.set(path, pending);
    }
    return pending;
  }

  private declared(rootPath: string): Promise<DeclaredPackages> {
    const directory = projectDirectory(rootPath);
    let pending = this.declarations.get(directory);
    if (!pending) {
      pending = this.findDeclared(rootPath);
      this.declarations.set(directory, pending);
    }
    return pending;
  }

  private async installedManifest(name: string, rootPath: string) {
    for (
      let directory = projectDirectory(rootPath);
      ;
      directory = projectDirectory(directory)
    ) {
      const path = normalizeProjectPath(
        directory + '/node_modules/' + name + '/package.json',
      );
      const manifest = await this.manifest(path);
      if (manifest)
        return {
          manifest,
          packagePath: projectDirectory(
            (await this.files.stat(path))?.realPath ?? path,
          ),
        };
      if (directory === '/') return undefined;
    }
  }

  private async findDeclared(rootPath: string): Promise<DeclaredPackages> {
    const declared = new Set<string>();
    const packages: CompatibilityPackage[] = [];
    let scope: string | undefined;
    for (
      let directory = projectDirectory(rootPath);
      ;
      directory = projectDirectory(directory)
    ) {
      const manifestPath = normalizeProjectPath(directory + '/package.json');
      const manifest = await this.manifest(manifestPath);
      if (manifest) scope ??= directory;
      for (const [specifier, range] of Object.entries(
        manifestDependencies(manifest ?? {}),
      )) {
        if (declared.has(specifier)) continue;
        declared.add(specifier);
        const name = modelingPackage(specifier, range);
        if (!name || !this.matchingVersions[name]) continue;
        const installed = await this.installedManifest(specifier, rootPath);
        // Missing installations retain the ordinary module resolution error.
        if (!installed) continue;
        const version =
          typeof installed.manifest.version === 'string'
            ? installed.manifest.version
            : 'unknown';
        const expected = this.matchingVersions[name];
        if (version !== expected)
          packages.push({
            name,
            packagePath: installed.packagePath,
            specifier,
            installed: version,
            expected,
            manifestPath,
          });
      }
      if (directory === '/') break;
    }
    return {directory: scope ?? '/', packages};
  }

  private async findResolved(
    path: string,
    importer: string,
  ): Promise<readonly CompatibilityPackage[]> {
    // checkResolved has already established that this crosses a package boundary.
    const manifestPath = resolvedPackageDirectory(path)! + '/package.json';
    const directory = projectDirectory(
      (await this.files.stat(manifestPath))?.realPath ?? manifestPath,
    );
    const manifest = await this.manifest(directory + '/package.json');
    if (
      !manifest?.name ||
      !builtinPackageNames.some(name => name === manifest.name)
    )
      return [];
    const name = manifest.name;
    const expected = this.matchingVersions[name];
    if (!expected || manifest.version === expected) return [];
    const installed =
      typeof manifest.version === 'string' ? manifest.version : 'unknown';
    const owner = resolvedPackageDirectory(importer);
    const authorPath = owner
      ? normalizeProjectPath(
          importer.slice(0, importer.indexOf('/node_modules/')) +
            '/__lookup.ts',
        )
      : importer;
    const declared = await this.declared(authorPath);
    // The same physical installation keeps its author declaration, including aliases.
    if (declared.packages.some(pkg => pkg.packagePath === directory))
      return declared.packages;
    const ownerManifest = owner
      ? await this.manifest(owner + '/package.json')
      : undefined;
    return [
      {
        name,
        packagePath: directory,
        installed,
        expected,
        manifestPath: normalizeProjectPath(
          declared.directory + '/package.json',
        ),
        manual: owner
          ? {
              reason: 'transitive',
              dependency:
                ownerManifest?.name ??
                owner.slice(
                  owner.lastIndexOf('/node_modules/') + '/node_modules/'.length,
                ),
            }
          : {reason: 'undeclared'},
      },
    ];
  }
}

/** Keep latest declarations; update other Code3D versions without moving fields or aliases. */
export function upgradeCode3dDependencies(
  manifest: PackageManifest,
  matchingVersions: Readonly<Record<string, string>>,
): PackageManifest {
  const updated = {...manifest};
  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    updated[field] = Object.fromEntries(
      Object.entries(dependencies).map(([specifier, range]) => {
        const name = modelingPackage(specifier, range);
        const expected = name && matchingVersions[name];
        const requested = range.startsWith('npm:')
          ? parsePackageSpecifier(range.slice(4)).range
          : range;
        if (!expected || requested.trim() === 'latest')
          return [specifier, range];
        return [
          specifier,
          range.startsWith('npm:') ? `npm:${name}@${expected}` : expected,
        ];
      }),
    );
  }
  return updated;
}
