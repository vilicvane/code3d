import type {SourceRef} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import type * as esbuild from 'esbuild-wasm';
import {isBuiltinPackageSpecifier} from '../project/builtin-packages';
import {ProjectFileCache} from '../project/file-cache';
import {
  decodeProjectFile,
  statProjectFiles,
  type ProjectFileReader,
} from '../project/file-reader';
import {patchModelPackages} from '../project/model-package-patches';
import {
  findPackageCompatibility,
  findResolvedPackageCompatibility,
  type PackageCompatibilityIssue,
} from '../project/package-compatibility';
import {
  isSourceFile,
  normalizeProjectPath,
  type ModelProject,
  type ProjectSourceFile,
} from '../project/project';
import {ProjectAssets} from '../project/project-assets';
import {
  ProjectBuilder,
  dependencyFileIdentity,
  packageResolutionKey,
} from '../project/project-builder';
import {
  ProjectLanguageLoader,
  type ProjectLanguage,
} from '../project/project-language';
import {ProjectPackages} from '../project/project-packages';
import type {CompilationProgress} from './compilation-progress';
import {createModelCompiler, type DesignContext} from './compiler';
import {
  ModelDiagnosticError,
  diagnosticFromError,
  type ModelDiagnostic,
} from './diagnostic';

import {projectArtifactIdentity} from './build-artifact-cache';
import type {CompiledModelSource} from './compiler';
import {DependencyBuilder, type DependencyArtifact} from './dependency-builder';

export type ProjectBuildArtifact = Readonly<{
  id: string;
  model: CompiledModelSource;
  dependencies: DependencyArtifact;
  staticPackages: readonly string[];
  resources: ReadonlyMap<string, Uint8Array>;
  runtimeSourceRef?: SourceRef;
}>;

/** Compilation owns source files and esbuild contexts; it never initializes a kernel. */
export class ProjectCompiler {
  private readonly files: ProjectFileCache;
  private readonly builtinFiles: ProjectFileCache;
  private readonly packages: ProjectPackages;
  private readonly assets: ProjectAssets;
  private readonly language: ProjectLanguageLoader;
  private readonly compiler = createModelCompiler();
  private readonly builder: ProjectBuilder;
  private dependencies: DependencyBuilder;
  private restoredDependencies?: DependencyArtifact;
  private refreshRequested?: symbol;
  private readonly checkedPackages = new Map<string, Promise<void>>();
  private reportPackageIssue?: (issue: PackageCompatibilityIssue) => void;

  constructor(
    private readonly sourceFiles: ProjectFileReader,
    private readonly builtinSourceFiles: ProjectFileReader,
    engine: Pick<typeof esbuild, 'build' | 'context'>,
  ) {
    this.files = new ProjectFileCache(patchModelPackages(sourceFiles));
    this.builtinFiles = new ProjectFileCache(
      patchModelPackages(builtinSourceFiles),
    );
    this.packages = new ProjectPackages(this.files, this.builtinFiles);
    this.assets = new ProjectAssets(this.packages);
    this.language = new ProjectLanguageLoader(this.packages);
    this.builder = new ProjectBuilder(
      this.packages,
      engine,
      this.assets,
      (path, importer) => this.checkResolvedPackage(path, importer),
    );
    this.dependencies = new DependencyBuilder(
      this.packages,
      this.builder,
      this.assets,
    );
  }

  get dependencyScope(): string {
    return JSON.stringify([
      this.packages.source,
      normalizeProjectPath(this.packages.directory + '/node_modules'),
    ]);
  }

  async compile(
    overrides: ModelProject,
    rootPath: string,
    designContext?: DesignContext,
    onLanguage?: (language: ProjectLanguage) => void,
    onProgress?: CompilationProgress,
    checkCancelled: () => void = () => {},
    restoreDependencies?: (
      scope: string,
    ) => Promise<DependencyArtifact | undefined>,
    onWarnings?: (warnings: readonly ModelDiagnostic[]) => void,
  ): Promise<ProjectBuildArtifact> {
    checkCancelled();
    this.checkedPackages.clear();
    onProgress?.('reading-files');
    const refreshRequest = this.refreshRequested;
    const refresh = !!refreshRequest;
    if (refresh) {
      // Manual refresh must see files whose timestamps and sizes were preserved.
      this.files.clear();
      this.builtinFiles.clear();
    }
    const select = (
      path: string,
      info: import('../project/file-reader').ProjectFileInfo | undefined,
    ) =>
      !path.includes('/node_modules/') ||
      path.endsWith('/package.json') ||
      info?.kind === 'directory';
    const [changed, builtinChanged] = await Promise.all([
      this.files.refresh(select),
      this.builtinFiles.refresh(select),
    ]);
    const dependenciesChanged =
      refresh ||
      builtinChanged.size > 0 ||
      [...changed].some(path => path.includes('/node_modules/'));
    if (dependenciesChanged) {
      this.files.clear(path => path.includes('/node_modules/'));
      this.builtinFiles.clear();
    }
    const packageSelectionChanged = await this.packages.update(
      overrides,
      rootPath,
    );
    if (
      dependenciesChanged ||
      packageSelectionChanged ||
      [...changed].some(
        path =>
          path.includes('/node_modules/') ||
          /(?:^|\/)(?:package(?:-lock)?\.json|code3d-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json)$/.test(
            path,
          ),
      )
    ) {
      await this.builder.dispose();
      this.dependencies = new DependencyBuilder(
        this.packages,
        this.builder,
        this.assets,
      );
      this.language.reset();
    }
    if (refresh) this.restoredDependencies = undefined;
    this.language.invalidate(changed);
    // Finish applying invalidation before cancellation can consume these changes.
    checkCancelled();
    const reader = this.packages;
    await this.builder.watchDependencyMetadata([
      normalizeProjectPath(this.packages.directory + '/code3d-lock.json'),
      '/package-lock.json',
      '/npm-shrinkwrap.json',
      '/pnpm-lock.yaml',
      '/yarn.lock',
    ]);
    checkCancelled();
    const builder = this.builder;
    const root = normalizeProjectPath(rootPath);
    const entryPaths = [
      ...new Set([
        root,
        ...(designContext ? [normalizeProjectPath(designContext.file)] : []),
      ]),
    ];
    const readSource = async (path: string): Promise<ProjectSourceFile> => {
      const bytes = await reader.readFile(path);
      if (!bytes)
        throw new ModelDiagnosticError({
          kind: 'project',
          summary: `Project file not found: ${path}`,
        });
      return {path, source: decodeProjectFile(bytes)};
    };
    // Editor documents are overlays, not the set of files belonging to a run.
    // Explicit entry files also need language support when they have no editor model.
    const entries = await Promise.all(entryPaths.map(readSource));
    const imports = entries.flatMap(file => {
      const source = ts.createSourceFile(
        file.path,
        file.source,
        ts.ScriptTarget.Latest,
        true,
      );
      return source.statements.flatMap(statement => {
        if (
          !ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)
        )
          return [];
        const specifier = statement.moduleSpecifier;
        return specifier && ts.isStringLiteralLike(specifier)
          ? [
              {
                specifier: specifier.text,
                sourceRef: {
                  file: file.path,
                  start: specifier.getStart(source),
                  end: specifier.end,
                },
              },
            ]
          : [];
      });
    });
    const runtimeSourceRef = imports.find(item =>
      isBuiltinPackageSpecifier(item.specifier),
    )?.sourceRef;
    let packageIssue: PackageCompatibilityIssue | undefined;
    const publishWarnings = () => {
      checkCancelled();
      const affected = packageIssue?.packages.map(
        pkg =>
          pkg.specifier ??
          (pkg.manual?.reason === 'transitive'
            ? pkg.manual.dependency
            : pkg.name),
      );
      const warningSourceRef = imports.find(item =>
        affected?.some(
          specifier =>
            item.specifier === specifier ||
            item.specifier.startsWith(specifier + '/'),
        ),
      )?.sourceRef;
      onWarnings?.(
        packageIssue
          ? [
              packageCompatibilityWarning(
                packageIssue,
                warningSourceRef ?? {file: root, start: 0, end: 0},
              ),
            ]
          : [],
      );
    };
    this.reportPackageIssue = issue => {
      checkCancelled();
      const packages = new Map(
        packageIssue?.packages.map(pkg => [pkg.packagePath, pkg]),
      );
      for (const pkg of issue.packages) {
        const previous = packages.get(pkg.packagePath);
        if (
          !previous ||
          !pkg.manual ||
          (previous.manual?.reason === 'undeclared' &&
            pkg.manual.reason === 'transitive')
        )
          packages.set(pkg.packagePath, pkg);
      }
      packageIssue = {
        ...issue,
        directory: packageIssue?.directory ?? issue.directory,
        packages: [...packages.values()],
      };
    };
    try {
      const issue = await findPackageCompatibility(
        this.packages,
        this.builtinFiles,
        rootPath,
      );
      checkCancelled();
      if (issue) this.reportPackageIssue(issue);
      for (const {path, importer} of this.builder.packageResolutions.values())
        await this.checkResolvedPackage(path, importer);
      const languageProject = {
        files: [
          ...overrides.files.filter(file => !entryPaths.includes(file.path)),
          ...entries,
        ],
      };
      const language = await this.language.load(
        languageProject,
        reader.packageSpecifiers,
        rootPath,
        () => onProgress?.('resolving-imports'),
      );
      checkCancelled();
      onLanguage?.(language);

      if (this.refreshRequested === refreshRequest)
        this.refreshRequested = undefined;
      this.assets.beginCompilation();
      if (!this.dependencies.prepared) {
        const restored = refresh
          ? undefined
          : ((await restoreDependencies?.(this.dependencyScope)) ??
            this.restoredDependencies);
        if (restored) await this.dependencies.adopt(restored);
        this.restoredDependencies = undefined;
      }
      let loading = false;
      const loadingRuntime = () => {
        if (!loading) onProgress?.('loading-runtime');
        loading = true;
      };
      if (!this.dependencies.ready) loadingRuntime();
      await this.dependencies.prepare(rootPath);
      checkCancelled();
      const discovery = await builder.build(
        entryPaths.map(path => `import ${JSON.stringify(path)};`).join('\n'),
        {
          slot: 'source-discovery',
          runtimeFiles: this.dependencies.formats,
          bundlePackages: true,
        },
      );
      const dependencies = await this.dependencies.build(
        discovery,
        loadingRuntime,
      );
      // Warm builds and restored dependencies can reuse package facades without
      // resolving their internal imports again. Their original owners still matter.
      for (const {path, importer} of dependencies.packageResolutions)
        await this.checkResolvedPackage(path, importer);
      checkCancelled();
      const project: ModelProject = {
        files: await Promise.all(
          discovery.files
            .filter(
              path => !path.includes('/node_modules/') && isSourceFile(path),
            )
            .map(readSource),
        ),
      };
      onProgress?.('compiling-model');
      const model = await this.compiler.compileProject(
        project,
        root,
        builder,
        dependencies.formats,
        this.language.typeScriptProgram,
        discovery,
        designContext,
        checkCancelled,
      );
      const resources = new Map([
        ...dependencies.resources,
        ...this.assets.snapshot(),
      ]);
      const artifact = {
        model,
        dependencies,
        staticPackages: discovery.staticPackages,
        resources,
        runtimeSourceRef,
      };
      return {
        ...artifact,
        id: await projectArtifactIdentity(artifact),
      };
    } catch (error) {
      checkCancelled();
      const diagnostic = diagnosticFromError(error, 'module');
      throw new ModelDiagnosticError({
        ...diagnostic,
        sourceRef: diagnostic.sourceRef ?? runtimeSourceRef,
      });
    } finally {
      // Publish one complete snapshot, also on a genuine build error. Incremental
      // checks must not temporarily clear warnings or collapse their UI details.
      publishWarnings();
      this.reportPackageIssue = undefined;
    }
  }

  async dispose(): Promise<void> {
    await this.builder.dispose();
    this.assets.dispose();
    this.language.reset();
  }

  cancel(): Promise<void> {
    return this.builder.cancel();
  }

  private async checkResolvedPackage(
    path: string,
    importer: string,
  ): Promise<void> {
    const key = packageResolutionKey({path, importer});
    if (!key) return;
    let pending = this.checkedPackages.get(key);
    if (!pending) {
      const report = this.reportPackageIssue;
      pending = findResolvedPackageCompatibility(
        this.packages,
        this.builtinFiles,
        path,
        importer,
      ).then(issue => {
        if (issue) report?.(issue);
      });
      this.checkedPackages.set(key, pending);
    }
    await pending;
  }

  restoreDependencies(artifact: DependencyArtifact): DependencyArtifact {
    return (this.restoredDependencies = this.dependencies.reuse(artifact));
  }

  /** A saved view may only execute against the currently selected installation. */
  async canRestoreDependencies(
    artifact: Pick<DependencyArtifact, 'metadata'>,
    project: ModelProject,
    rootPath: string,
  ): Promise<boolean> {
    // Restoration runs alongside compilation. Its package selection must not
    // mutate the active compiler's reader or reuse unrefreshed file metadata.
    const packages = new ProjectPackages(
      this.sourceFiles,
      this.builtinSourceFiles,
    );
    await packages.update(project, rootPath);
    const metadata = await statProjectFiles(
      packages,
      artifact.metadata.map(([path]) => path),
    );
    return artifact.metadata.every(
      ([, expected], index) =>
        JSON.stringify(expected) ===
        JSON.stringify(dependencyFileIdentity(metadata[index])),
    );
  }

  refreshProject(): void {
    this.refreshRequested = Symbol('refresh');
  }
}

function packageCompatibilityWarning(
  issue: PackageCompatibilityIssue,
  sourceRef?: SourceRef,
): ModelDiagnostic {
  return {
    kind: 'project',
    severity: 'warning',
    summary: 'Code3D package version mismatch',
    details:
      issue.packages
        .map(
          pkg =>
            `${pkg.name}: installed ${pkg.installed}; this App includes ${pkg.expected}.`,
        )
        .join('\n') +
      '\nBuilds continue with the installed versions. Update packages if you encounter compatibility problems.',
    sourceRef,
    packageCompatibility: issue,
  };
}
