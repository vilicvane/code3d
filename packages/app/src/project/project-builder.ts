import ts from '@typescript/typescript6';
import type * as esbuild from 'esbuild-wasm';
import {ModelDiagnosticError} from '../model/diagnostic';
import {
  CachedDefinitionCompiler,
  transformCachedDefinitions,
  type CachedDefinitions,
} from './cached-definitions';
import {
  decodeProjectFile,
  type ProjectFileInfo,
  type ProjectFileReader,
} from './file-reader';
import {ProjectPackageResolver, nodeBuiltinError} from './package-resolver';
import type {ProjectAssets} from './project-assets';

// Build-time Node supplies its real builtin catalog, including subpaths.
const nodeBuiltins = new Set(__CODE3D_NODE_BUILTINS__);
const nodeBuiltin = (specifier: string) =>
  specifier.startsWith('node:')
    ? specifier
    : nodeBuiltins.has(specifier)
      ? `node:${specifier}`
      : undefined;

export type SourceTransform = (
  path: string,
  source: string,
  cached: CachedDefinitions,
) => string;
export type ModuleFormats = ReadonlyMap<string, 'esm' | 'cjs'>;
export type ProjectBundle = Readonly<{
  source: string;
  files: readonly string[];
  formats: ModuleFormats;
  staticPackages: readonly string[];
  packageEntries: readonly string[];
  resources: readonly string[];
  sourcePackages: ReadonlyMap<string, readonly string[]>;
}>;

export type ProjectBuildOptions = Readonly<{
  runtimeFiles?: ModuleFormats;
  transform?: SourceTransform;
  captureModules?: ModuleFormats;
  lazyPackages?: ReadonlyMap<string, readonly string[]>;
  instrumentCaches?: boolean;
  cacheIdentityFiles?: ReadonlySet<string>;
  /** Retain esbuild's context for this logical output until the builder is disposed. */
  slot?: string;
  /** Dependency bundles leave their entire graph, including dynamic imports, to esbuild. */
  bundlePackages?: boolean;
}>;

/** Native and browser esbuild share this project-filesystem plugin. */
export class ProjectBuilder {
  private readonly resolver: ProjectPackageResolver;
  readonly dependencyMetadata = new Map<string, ProjectFileInfo | null>();

  constructor(
    private readonly files: ProjectFileReader,
    private readonly engine: Pick<typeof esbuild, 'build' | 'context'>,
    private readonly assets?: ProjectAssets,
  ) {
    this.resolver = new ProjectPackageResolver({
      readFile: async path => {
        const bytes = await files.readFile(path);
        if (path.endsWith('/package.json'))
          await this.watchDependencyMetadata([path]);
        return bytes;
      },
      stat: async path => {
        const info = await files.stat(path);
        if (
          path.endsWith('/package.json') ||
          (path.includes('/node_modules') && info?.kind === 'directory')
        )
          this.dependencyMetadata.set(path, dependencyFileIdentity(info));
        return info;
      },
    });
  }

  async watchDependencyMetadata(paths: readonly string[]): Promise<void> {
    await Promise.all(
      paths.map(async path => {
        this.dependencyMetadata.set(
          path,
          dependencyFileIdentity(await this.files.stat(path)),
        );
      }),
    );
  }

  resolve(specifier: string, importer = '/model.ts'): Promise<string | false> {
    return this.resolver.resolve(specifier, importer);
  }

  private readonly sessions = new Map<
    string,
    ReturnType<ProjectBuilder['createSession']>
  >();

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(session => session.dispose()));
    this.dependencyMetadata.clear();
  }

  async cancel(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(session => session.cancel()),
    );
  }

  build(
    entrySource: string,
    options: ProjectBuildOptions = {},
  ): Promise<ProjectBundle> {
    if (!options.slot)
      return this.createSession(false).run(entrySource, options);
    let session = this.sessions.get(options.slot);
    if (!session) {
      session = this.createSession(true);
      this.sessions.set(options.slot, session);
    }
    return session.run(entrySource, options);
  }

  private createSession(incremental: boolean) {
    let entrySource: string;
    let runtimeFiles: ModuleFormats;
    let transform: SourceTransform | undefined;
    let captureModules: ModuleFormats | undefined;
    let lazyPackages: ReadonlyMap<string, readonly string[]> | undefined;
    let instrumentCaches: boolean;
    let cacheIdentityFiles: ReadonlySet<string> | undefined;
    let bundlePackages: boolean;
    let cachedDefinitions: CachedDefinitionCompiler;
    let context: esbuild.BuildContext | undefined;
    let queue = Promise.resolve();
    const resources = new Set<string>();
    const runtimePaths = new Map<string, string>();
    const runtimeModule = (
      path: string,
      namespace: 'runtime' | 'runtime-value',
    ) => {
      // A generated module has its own format, independent of the source
      // package's .mjs/.cjs extension. Keep the real path as its cache identity.
      const generated = path + (namespace === 'runtime' ? '.js' : '.cjs');
      runtimePaths.set(namespace + ':' + generated, path);
      return {path: generated, namespace, pluginData: path};
    };
    const run = async (
      nextSource: string,
      options: ProjectBuildOptions,
    ): Promise<ProjectBundle> => {
      entrySource = nextSource;
      ({
        runtimeFiles = new Map(),
        transform,
        captureModules,
        lazyPackages,
        instrumentCaches = true,
        cacheIdentityFiles,
        bundlePackages = false,
      } = options);
      cachedDefinitions = new CachedDefinitionCompiler(
        this.files,
        (specifier, importer) => this.resolve(specifier, importer),
      );
      resources.clear();
      runtimePaths.clear();
      const buildOptions: esbuild.BuildOptions = {
        entryPoints: ['code3d:entry'],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        absWorkingDir: '/',
        write: false,
        metafile: true,
        logLevel: 'silent',
        plugins: [
          {
            name: 'code3d-project-files',
            setup: build => {
              build.onResolve({filter: /.*/}, async args => {
                if (args.kind === 'entry-point' && args.path === 'code3d:entry')
                  return {path: '/.__code3d-entry.js', namespace: 'entry'};
                try {
                  if (
                    args.namespace === 'runtime' &&
                    args.path === 'code3d:cached-namespace'
                  )
                    return runtimeModule(args.pluginData, 'runtime-value');
                  const path = await this.resolver.resolve(
                    args.path,
                    args.importer || '/.__code3d-entry.js',
                    args.kind === 'require-call' ? 'require' : 'import',
                  );
                  if (path === false)
                    return {path: args.path, namespace: 'empty'};
                  if (path.endsWith('.node'))
                    throw new Error(
                      `Native Node addon ${args.path} is not available in the browser. Use a package with a browser implementation.`,
                    );
                  if (runtimeFiles.has(path))
                    return runtimeModule(
                      path,
                      runtimeFiles.get(path) === 'esm'
                        ? 'runtime'
                        : 'runtime-value',
                    );
                  return {path, namespace: 'project'};
                } catch (error) {
                  return {
                    errors: [
                      {
                        text:
                          error instanceof Error
                            ? error.message
                            : String(error),
                        detail: error,
                      },
                    ],
                  };
                }
              });
              build.onLoad({filter: /.*/, namespace: 'entry'}, () => ({
                contents: entrySource,
                loader: 'js',
                resolveDir: '/',
              }));
              build.onLoad({filter: /.*/, namespace: 'empty'}, () => ({
                contents: '',
                loader: 'js',
              }));
              build.onLoad({filter: /.*/, namespace: 'runtime'}, async args => {
                const path: string = args.pluginData;
                const bytes = await this.files.readFile(path);
                if (!bytes) throw new Error(`Project file not found: ${path}`);
                // The ESM facade keeps .mjs/.mts consumers out of CommonJS
                // default-import interop. Re-exports retain the cached getters;
                // assigning namespace.default to an exported const would not.
                return {
                  contents:
                    'export * from "code3d:cached-namespace";' +
                    (hasDefaultExport(path, decodeProjectFile(bytes))
                      ? '\nexport {default} from "code3d:cached-namespace";'
                      : ''),
                  loader: 'js',
                  pluginData: path,
                };
              });
              build.onLoad(
                {filter: /.*/, namespace: 'runtime-value'},
                args => ({
                  // CommonJS is used only as an internal getter-bearing value
                  // carrier (or for an actual CommonJS dependency).
                  contents:
                    runtimeFiles.get(args.pluginData) === 'cjs'
                      ? `module.exports = __code3dModules.get(${JSON.stringify(args.pluginData)}).default;`
                      : `const namespace = __code3dModules.get(${JSON.stringify(args.pluginData)});
                Object.defineProperty(exports, '__esModule', {value: true});
                for (const key of Object.keys(namespace)) {
                  Object.defineProperty(exports, key, {enumerable: true, get: () => namespace[key]});
                }`,
                  loader: 'js',
                }),
              );
              build.onLoad({filter: /.*/, namespace: 'project'}, async args => {
                const bytes = await this.files.readFile(args.path);
                if (!bytes)
                  throw new Error(`Project file not found: ${args.path}`);
                if (args.path.endsWith('.wasm'))
                  return {contents: bytes, loader: 'binary'};
                let source = decodeProjectFile(bytes);
                const definitions =
                  !instrumentCaches ||
                  cacheIdentityFiles?.has(args.path) ||
                  args.path.endsWith('.json')
                    ? new Map<number, string>()
                    : await cachedDefinitions.definitions(args.path, source);
                if (
                  transform &&
                  !args.path.includes('/node_modules/') &&
                  !args.path.endsWith('.json')
                ) {
                  source = transform(args.path, source, definitions);
                } else if (definitions.size)
                  source = transformCachedDefinitions(
                    args.path,
                    source,
                    definitions,
                  );
                if (this.assets && !args.path.endsWith('.json'))
                  source = await this.assets.rewrite(args.path, source, path =>
                    resources.add(path),
                  );
                if (!args.path.endsWith('.json'))
                  source = await this.rewriteDynamicImports(
                    args.path,
                    source,
                    lazyPackages,
                    bundlePackages,
                  );
                const captureFormat = captureModules?.get(args.path);
                if (captureFormat) {
                  if (args.path.endsWith('.json'))
                    source =
                      'module.exports = JSON.parse(' +
                      JSON.stringify(source) +
                      ');';
                  if (captureFormat === 'cjs') {
                    source = `let __code3dFailed = false;
                    try { ${source} }
                    catch (__code3dError) { __code3dFailed = true; throw __code3dError; }
                    finally {
                      if (!__code3dFailed) __code3dRecordModule(${JSON.stringify(args.path)},
                        {get default() {return module.exports;}}, 'cjs');
                    }`;
                    if (args.path.includes('/node_modules/'))
                      source = `if (__code3dModules.has(${JSON.stringify(args.path)})) {
                      module.exports = __code3dModules.get(${JSON.stringify(args.path)}).default;
                    } else { ${source} }`;
                  } else {
                    source += `\nimport * as __code3dCurrentModule from ${JSON.stringify(args.path)};
                    __code3dRecordModule(${JSON.stringify(args.path)}, __code3dCurrentModule, 'esm');`;
                  }
                }
                const extension = args.path.split('.').at(-1)!;
                const loader: esbuild.Loader =
                  extension === 'json' && !captureFormat
                    ? 'json'
                    : extension === 'tsx'
                      ? 'tsx'
                      : extension === 'jsx'
                        ? 'jsx'
                        : ['ts', 'mts', 'cts'].includes(extension)
                          ? 'ts'
                          : 'js';
                return {contents: source, loader, resolveDir: '/'};
              });
            },
          },
        ],
      };
      const result = await (
        incremental
          ? (context ??= await this.engine.context(buildOptions)).rebuild()
          : this.engine.build(buildOptions)
      ).catch(async (error: esbuild.BuildFailure) => {
        if (!error.errors?.length) throw error;
        const message = error.errors[0];
        if (message.detail instanceof ModelDiagnosticError)
          throw message.detail;
        const location = message.location;
        const file = location?.file.replace(/^project:/, '');
        const bytes = file?.startsWith('/')
          ? await this.files.readFile(file)
          : undefined;
        let sourceRef;
        if (bytes && location && file) {
          const source = decodeProjectFile(bytes);
          const lines = source.split('\n');
          const line = lines[location.line - 1] ?? '';
          // esbuild columns are UTF-8 bytes; editor offsets are UTF-16 units.
          const utf8 = new TextEncoder().encode(line);
          const prefix = new TextDecoder().decode(
            utf8.slice(0, location.column),
          );
          const span = new TextDecoder().decode(
            utf8.slice(location.column, location.column + location.length),
          );
          const start =
            lines
              .slice(0, location.line - 1)
              .reduce((n, text) => n + text.length + 1, 0) + prefix.length;
          sourceRef = {file, start, end: start + Math.max(1, span.length)};
        }
        throw new ModelDiagnosticError({
          kind: message.pluginName ? 'module' : 'syntax',
          summary: message.text,
          details: error.message,
          ...(sourceRef ? {sourceRef} : {}),
        });
      });
      return {
        source: result.outputFiles![0].text,
        resources: [...resources],
        files: Object.keys(result.metafile!.inputs)
          .filter(path => path.startsWith('project:'))
          .map(path => path.slice('project:'.length)),
        formats: new Map(
          Object.entries(result.metafile!.inputs)
            .filter(([path]) => path.startsWith('project:'))
            .map(([path, input]) => [
              path.slice('project:'.length),
              input.format === 'cjs' || path.endsWith('.json') ? 'cjs' : 'esm',
            ]),
        ),
        staticPackages: staticPackageEntries(
          result.metafile!.inputs,
          runtimePaths,
        ),
        packageEntries: staticPackageEntries(
          result.metafile!.inputs,
          runtimePaths,
          undefined,
          true,
        ),
        sourcePackages: new Map(
          Object.keys(result.metafile!.inputs)
            .filter(
              path =>
                path.startsWith('project:') && !path.includes('/node_modules/'),
            )
            .map(path => [
              path.slice('project:'.length),
              staticPackageEntries(result.metafile!.inputs, runtimePaths, [
                path,
              ]),
            ]),
        ),
      };
    };
    return {
      cancel: async () => {
        await context?.cancel();
      },
      run: (source: string, options: ProjectBuildOptions) => {
        const pending = queue.then(() => run(source, options));
        queue = pending.then(
          () => {},
          () => {},
        );
        return pending;
      },
      dispose: async () => {
        await queue;
        await context?.dispose();
      },
    };
  }

  private async rewriteDynamicImports(
    path: string,
    source: string,
    lazyPackages?: ReadonlyMap<string, readonly string[]>,
    bundlePackages = false,
  ): Promise<string> {
    if (!/\bimport\s*\(/.test(source)) return source;
    const parsed = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        if (
          !node.arguments.length ||
          !ts.isStringLiteralLike(node.arguments[0])
        )
          throw new ModelDiagnosticError({
            kind: 'module',
            summary:
              'Dynamic imports require a string literal so Studio can build the project module graph.',
            sourceRef: {
              file: path,
              start: node.getStart(parsed),
              end: node.getEnd(),
            },
          });
        imports.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    for (const node of imports.reverse()) {
      const specifier = (node.arguments[0] as ts.StringLiteralLike).text;
      const builtin = nodeBuiltin(specifier);
      if (builtin) {
        source =
          source.slice(0, node.getStart(parsed)) +
          'Promise.reject(new Error(' +
          JSON.stringify(nodeBuiltinError(builtin).message) +
          '))' +
          source.slice(node.getEnd());
        continue;
      }
      let resolved;
      try {
        resolved = await this.resolver.resolve(specifier, path);
      } catch (error) {
        throw new ModelDiagnosticError({
          kind: 'module',
          summary: error instanceof Error ? error.message : String(error),
          sourceRef: {
            file: path,
            start: node.getStart(parsed),
            end: node.getEnd(),
          },
        });
      }
      if (!bundlePackages && resolved && resolved.includes('/node_modules/')) {
        source =
          source.slice(0, node.getStart(parsed)) +
          '__code3dImport(' +
          JSON.stringify(resolved) +
          ')' +
          source.slice(node.getEnd());
      } else if (resolved && lazyPackages?.get(resolved)?.length) {
        // esbuild still owns source-module cycles and lazy initialization.
        // Prepare its static package imports only when this branch is reached.
        source =
          source.slice(0, node.getStart(parsed)) +
          '__code3dImportDependencies(' +
          JSON.stringify(lazyPackages.get(resolved)) +
          ').then(() => ' +
          node.getText(parsed) +
          ')' +
          source.slice(node.getEnd());
      }
    }
    return source;
  }
}

export function dependencyFileIdentity(
  info: ProjectFileInfo | undefined,
): ProjectFileInfo | null {
  return info
    ? {
        kind: info.kind,
        version: info.version,
        ...(info.realPath ? {realPath: info.realPath} : {}),
      }
    : null;
}

function staticPackageEntries(
  inputs: esbuild.Metafile['inputs'],
  runtimePaths: ReadonlyMap<string, string>,
  roots = Object.keys(inputs).filter(
    path => !path.startsWith('project:') && !runtimePaths.has(path),
  ),
  includeDynamic = false,
): string[] {
  const visited = new Set<string>();
  const entries = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    const original =
      runtimePaths.get(path) ??
      (path.startsWith('project:') ? path.slice('project:'.length) : undefined);
    if (original?.includes('/node_modules/')) {
      entries.add(original);
      return;
    }
    for (const dependency of inputs[path]?.imports ?? []) {
      if (
        !dependency.external &&
        (includeDynamic || dependency.kind !== 'dynamic-import')
      )
        visit(dependency.path);
    }
  };
  roots.forEach(visit);
  return [...entries];
}

function hasDefaultExport(path: string, source: string): boolean {
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  return parsed.statements.some(statement => {
    if (ts.isExportAssignment(statement)) return !statement.isExportEquals;
    if (
      ts.canHaveModifiers(statement) &&
      ts
        .getModifiers(statement)
        ?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      return true;
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly)
      return false;
    const clause = statement.exportClause;
    return (
      clause &&
      (ts.isNamespaceExport(clause)
        ? clause.name.text === 'default'
        : clause.elements.some(
            element => !element.isTypeOnly && element.name.text === 'default',
          ))
    );
  });
}
