import type * as esbuild from 'esbuild-wasm';
import ts from '@typescript/typescript6';
import type {ModelGeometrySnapshot} from '@code3d/core/tooling';
import {ProjectFileCache} from '../project/file-cache';
import type {ProjectFileReader} from '../project/file-reader';
import {ProjectPackages} from '../project/project-packages';
import {ProjectBuilder} from '../project/project-builder';
import {ProjectAssets} from '../project/project-assets';
import {
  loadProjectLanguage,
  type ProjectLanguage,
} from '../project/project-language';
import {normalizeProjectPath, type ModelProject} from '../project/project';
import {createModelCompiler, type ModelModule} from './compiler';
import {ProjectRuntime} from './project-runtime';
import {ModuleEvaluator} from './module-evaluator';
import type {CompilationProgress} from './compilation-progress';
import {ModelDiagnosticError, diagnosticFromError} from './diagnostic';
import {
  exportModel,
  type ModelExportInstance,
  type ModelExportOptions,
} from './model-export';

export class ProjectCompiler {
  private readonly files: ProjectFileCache;
  private readonly packages: ProjectPackages;
  private readonly assets: ProjectAssets;
  private readonly evaluator: ModuleEvaluator;
  private runtime?: ProjectRuntime;
  private compiler?: ReturnType<typeof createModelCompiler>;
  private geometry?: ModelGeometrySnapshot;

  constructor(
    files: ProjectFileReader,
    builtinFiles: ProjectFileReader,
    private readonly engine: Pick<typeof esbuild, 'build'>,
    createEvaluator = () => new ModuleEvaluator(),
  ) {
    this.files = new ProjectFileCache(files);
    this.packages = new ProjectPackages(
      this.files,
      new ProjectFileCache(builtinFiles),
    );
    this.assets = new ProjectAssets(this.packages);
    this.evaluator = createEvaluator();
  }

  async compile(
    project: ModelProject,
    rootPath: string,
    designContextId?: string,
    onLanguage?: (language: ProjectLanguage) => void,
    onProgress?: CompilationProgress,
  ): Promise<ModelModule> {
    onProgress?.('loading-project');
    this.disposeGeometry();
    const changed = await this.files.refresh();
    const packageSelectionChanged = await this.packages.update(project);
    if (
      packageSelectionChanged ||
      [...changed].some(
        path =>
          path.includes('/node_modules/') ||
          /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json)$/.test(
            path,
          ),
      )
    ) {
      this.disposeRuntime();
    }
    const reader = this.packages;
    await Promise.all(
      [
        '/package-lock.json',
        '/npm-shrinkwrap.json',
        '/pnpm-lock.yaml',
        '/yarn.lock',
      ].map(path => this.files.stat(path)),
    );
    const builder = new ProjectBuilder(reader, this.engine, this.assets);
    const language = await loadProjectLanguage(
      reader,
      project,
      reader.packageSpecifiers,
    );
    onLanguage?.(language);
    if (!this.runtime) {
      this.runtime = await ProjectRuntime.create(
        reader,
        builder,
        this.evaluator,
        onProgress,
      ).catch(error => {
        const diagnostic = diagnosticFromError(error, 'module');
        if (diagnostic.sourceRef) throw error;
        for (const file of project.files) {
          const parsed = ts.createSourceFile(
            file.path,
            file.source,
            ts.ScriptTarget.Latest,
            true,
          );
          for (const statement of parsed.statements) {
            if (
              !ts.isImportDeclaration(statement) &&
              !ts.isExportDeclaration(statement)
            )
              continue;
            const specifier = statement.moduleSpecifier;
            if (
              !specifier ||
              !ts.isStringLiteralLike(specifier) ||
              !/^@code3d\/(?:core|screws)(?:\/|$)/.test(specifier.text)
            )
              continue;
            throw new ModelDiagnosticError({
              ...diagnostic,
              sourceRef: {
                file: file.path,
                start: specifier.getStart(parsed),
                end: specifier.getEnd(),
              },
            });
          }
        }
        throw new ModelDiagnosticError(diagnostic);
      });
      this.compiler = createModelCompiler(this.runtime.tooling, this.evaluator);
    }
    onProgress?.('compiling-model');
    const root = normalizeProjectPath(rootPath);
    const contextFile = this.compiler!.designContextFile(
      project,
      designContextId,
    );
    const discovery = await this.runtime.loadDependencies(
      builder,
      `export * from ${JSON.stringify(root)};` +
        (contextFile && contextFile !== root
          ? `\nimport ${JSON.stringify(contextFile)};`
          : ''),
    );
    return this.compiler!.compileProject(
      project,
      root,
      builder,
      this.runtime.modules,
      this.runtime.formats,
      this.runtime.importModule,
      language,
      discovery,
      designContextId,
      () => onProgress?.('evaluating-model'),
      objects => {
        this.geometry = this.runtime!.tooling.retainModelGeometry(objects);
      },
    );
  }

  export(
    instances: readonly ModelExportInstance[],
    options: ModelExportOptions,
  ): Blob {
    if (!this.geometry || !this.runtime)
      throw new Error(
        'The model has changed. Reopen export after compilation finishes.',
      );
    return exportModel(
      this.geometry,
      instances,
      options,
      this.runtime.replicad,
    );
  }

  dispose(): void {
    this.disposeRuntime();
    this.evaluator.dispose();
  }

  get compiledBytes(): number {
    return this.evaluator.compiledBytes;
  }

  private disposeRuntime(): void {
    this.disposeGeometry();
    this.assets.dispose();
    this.runtime?.dispose();
    this.compiler = undefined;
    this.runtime = undefined;
  }

  private disposeGeometry(): void {
    this.geometry?.dispose();
    this.geometry = undefined;
  }
}
