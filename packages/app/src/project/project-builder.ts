import type * as esbuild from 'esbuild-wasm';
import ts from '@typescript/typescript6';
import {ProjectPackageResolver} from './package-resolver';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import type {ProjectAssets} from './project-assets';

export type SourceTransform = (path: string, source: string) => string;
export type ModuleFormats = ReadonlyMap<string, 'esm' | 'cjs'>;
export type ProjectBundle = Readonly<{
  source: string;
  files: readonly string[];
  formats: ModuleFormats;
  staticPackages: readonly string[];
  sourcePackages: ReadonlyMap<string, readonly string[]>;
}>;

/** Native and browser esbuild share this project-filesystem plugin. */
export class ProjectBuilder {
  private readonly resolver: ProjectPackageResolver;

  constructor(
    private readonly files: ProjectFileReader,
    private readonly engine: Pick<typeof esbuild, 'build'>,
    private readonly assets?: ProjectAssets,
  ) {
    this.resolver = new ProjectPackageResolver(files);
  }

  resolve(specifier: string, importer = '/model.ts'): Promise<string | false> {
    return this.resolver.resolve(specifier, importer);
  }

  async build(
    entrySource: string,
    {
      runtimeFiles = new Map<string, 'esm' | 'cjs'>(),
      transform,
      captureModules,
      lazyPackages,
    }: Readonly<{
      runtimeFiles?: ModuleFormats;
      transform?: SourceTransform;
      captureModules?: ModuleFormats;
      lazyPackages?: ReadonlyMap<string, readonly string[]>;
    }> = {},
  ): Promise<ProjectBundle> {
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
    const result = await this.engine.build({
      stdin: {
        contents: entrySource,
        sourcefile: '/.__code3d-entry.js',
        resolveDir: '/',
      },
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
              if (
                args.namespace === 'runtime' &&
                args.path === 'code3d:cached-namespace'
              )
                return runtimeModule(args.pluginData, 'runtime-value');
              // Conditional dynamic imports in universal packages stay conditional.
              // Executing a Node-only branch is rejected by the evaluator.
              if (args.path.startsWith('node:'))
                return {path: args.path, external: true};
              const path = await this.resolver.resolve(
                args.path,
                args.importer || '/.__code3d-entry.js',
                args.kind === 'require-call' ? 'require' : 'import',
              );
              if (path === false) return {path: args.path, namespace: 'empty'};
              if (runtimeFiles.has(path))
                return runtimeModule(
                  path,
                  runtimeFiles.get(path) === 'esm'
                    ? 'runtime'
                    : 'runtime-value',
                );
              return {path, namespace: 'project'};
            });
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
            build.onLoad({filter: /.*/, namespace: 'runtime-value'}, args => ({
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
            }));
            build.onLoad({filter: /.*/, namespace: 'project'}, async args => {
              const bytes = await this.files.readFile(args.path);
              if (!bytes)
                throw new Error(`Project file not found: ${args.path}`);
              if (args.path.endsWith('.wasm'))
                return {contents: bytes, loader: 'binary'};
              let source = decodeProjectFile(bytes);
              if (
                transform &&
                !args.path.includes('/node_modules/') &&
                !args.path.endsWith('.json')
              ) {
                source = transform(args.path, source);
              }
              if (this.assets && !args.path.endsWith('.json'))
                source = await this.assets.rewrite(args.path, source);
              if (!args.path.endsWith('.json'))
                source = await this.rewriteDynamicImports(
                  args.path,
                  source,
                  lazyPackages,
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
    });
    return {
      source: result.outputFiles![0].text,
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
      sourcePackages: new Map(
        Object.keys(result.metafile!.inputs)
          .filter(
            path =>
              path.startsWith('project:') && !path.includes('/node_modules/'),
          )
          .map(path => [
            path.slice('project:'.length),
            staticPackageEntries(result.metafile!.inputs, runtimePaths, [path]),
          ]),
      ),
    };
  }

  private async rewriteDynamicImports(
    path: string,
    source: string,
    lazyPackages?: ReadonlyMap<string, readonly string[]>,
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
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        !node.arguments[0].text.startsWith('node:')
      )
        imports.push(node);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    for (const node of imports.reverse()) {
      const specifier = (node.arguments[0] as ts.StringLiteralLike).text;
      const resolved = await this.resolver.resolve(specifier, path);
      if (resolved && resolved.includes('/node_modules/')) {
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

function staticPackageEntries(
  inputs: esbuild.Metafile['inputs'],
  runtimePaths: ReadonlyMap<string, string>,
  roots = Object.keys(inputs).filter(
    path => !path.startsWith('project:') && !runtimePaths.has(path),
  ),
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
      if (!dependency.external && dependency.kind !== 'dynamic-import')
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
