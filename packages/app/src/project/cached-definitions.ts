import ts from '@typescript/typescript6';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';

export type CachedDefinitions = ReadonlyMap<number, string>;
type Module = {source: ts.SourceFile; checker: ts.TypeChecker};

/** Fingerprints only a definition's local dependency closure, plus imported code. */
export class CachedDefinitionCompiler {
  private readonly sources = new Map<string, Promise<string>>();
  private readonly imports = new Map<string, boolean>();
  private readonly modules = new Map<string, Promise<Module>>();
  private readonly graphs = new Map<string, Promise<string>>();

  constructor(
    private readonly files: ProjectFileReader,
    private readonly resolve: (
      specifier: string,
      importer: string,
    ) => Promise<string | false>,
  ) {}

  async definitions(path: string, source: string): Promise<CachedDefinitions> {
    // Most files contain no cache factories. Parsing is shared with dependency
    // discovery when a definition actually references them.
    this.sources.set(path, Promise.resolve(source));
    if (!this.hasImports(path, source)) return new Map();
    const module = await this.module(path);
    if (!(await this.hasFactoryImport(module))) return new Map();
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments.length) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(module.source);
    const definitions = new Map<number, string>();
    for (const call of calls) {
      if (
        !(await this.resolveFunction(
          module,
          call.expression,
          'factory',
          new Set(),
        ))
      )
        continue;
      if (
        !(await this.resolveFunction(
          module,
          call.arguments[0],
          'compute',
          new Set(),
        ))
      )
        continue;
      const identity = await this.fingerprint(module, call.arguments);
      if (identity) definitions.set(call.getStart(module.source), identity);
    }
    return definitions;
  }

  private async hasFactoryImport(module: Module): Promise<boolean> {
    const properties = new Set<string>();
    let requires = false;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) properties.add(node.name.text);
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        !nodeBuiltin(node.arguments[0].text)
      )
        requires = true;
      ts.forEachChild(node, visit);
    };
    visit(module.source);
    if (requires) return true;
    for (const statement of module.source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.importClause ||
        statement.importClause.isTypeOnly
      )
        continue;
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      const clause = statement.importClause;
      const names = clause.name ? ['default'] : [];
      if (clause.namedBindings)
        names.push(
          ...(ts.isNamespaceImport(clause.namedBindings)
            ? properties
            : clause.namedBindings.elements
                .filter(element => !element.isTypeOnly)
                .map(element => (element.propertyName ?? element.name).text)),
        );
      for (const name of names)
        if (
          await this.exportedFunction(
            module.source.fileName,
            specifier,
            name,
            'factory',
            new Set(),
          )
        )
          return true;
    }
    return false;
  }

  private hasImports(path: string, text: string): boolean {
    let imports = this.imports.get(path);
    if (imports === undefined) {
      imports =
        /\b(?:import|export|require)\b/.test(text) &&
        ts
          .preProcessFile(text, true, true)
          .importedFiles.some(file => !nodeBuiltin(file.fileName));
      this.imports.set(path, imports);
    }
    return imports;
  }

  private source(path: string): Promise<string> {
    let source = this.sources.get(path);
    if (!source) {
      source = this.files.readFile(path).then(bytes => {
        if (!bytes) throw new Error(`Cache dependency not found: ${path}`);
        return decodeProjectFile(bytes);
      });
      this.sources.set(path, source);
    }
    return source;
  }

  private module(path: string): Promise<Module> {
    let pending = this.modules.get(path);
    if (!pending) {
      pending = (async () => {
        const text = await this.source(path);
        const source = ts.createSourceFile(
          path,
          text,
          ts.ScriptTarget.Latest,
          true,
        );
        const program = ts.createProgram(
          [path],
          {noLib: true, noResolve: true, allowJs: true},
          {
            getSourceFile: file => (file === path ? source : undefined),
            getDefaultLibFileName: () => '',
            writeFile() {},
            getCurrentDirectory: () => '/',
            getDirectories: () => [],
            fileExists: file => file === path,
            readFile: file => (file === path ? source.text : undefined),
            getCanonicalFileName: file => file,
            useCaseSensitiveFileNames: () => true,
            getNewLine: () => '\n',
          },
        );
        return {
          source,
          get checker() {
            return program.getTypeChecker();
          },
        };
      })();
      this.modules.set(path, pending);
    }
    return pending;
  }

  private async resolveFunction(
    module: Module,
    expression: ts.Expression,
    kind: 'factory' | 'compute',
    seen: Set<ts.Node | string>,
  ): Promise<boolean> {
    if (seen.has(expression)) return false;
    seen.add(expression);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
      return kind === 'compute';
    if (ts.isParenthesizedExpression(expression))
      return this.resolveFunction(module, expression.expression, kind, seen);
    if (ts.isPropertyAccessExpression(expression)) {
      const owner = expression.expression;
      const declaration = ts.isIdentifier(owner)
        ? module.checker.getSymbolAtLocation(owner)?.declarations?.[0]
        : undefined;
      const specifier =
        declaration && ts.isNamespaceImport(declaration)
          ? (declaration.parent.parent.moduleSpecifier as ts.StringLiteral).text
          : requiredModule(
              module,
              declaration && ts.isVariableDeclaration(declaration)
                ? declaration.initializer
                : owner,
            );
      return (
        specifier !== undefined &&
        this.exportedFunction(
          module.source.fileName,
          specifier,
          expression.name.text,
          kind,
          seen,
        )
      );
    }
    if (!ts.isIdentifier(expression)) return false;
    const symbol = ts.isExportSpecifier(expression.parent)
      ? module.checker.getExportSpecifierLocalTargetSymbol(expression.parent)
      : module.checker.getSymbolAtLocation(expression);
    const declaration = symbol?.declarations?.[0];
    if (!declaration) return false;
    if (ts.isFunctionDeclaration(declaration)) return kind === 'compute';
    if (ts.isVariableDeclaration(declaration) && declaration.initializer)
      return this.resolveFunction(module, declaration.initializer, kind, seen);
    if (ts.isImportClause(declaration) && !declaration.isTypeOnly)
      return this.exportedFunction(
        module.source.fileName,
        (declaration.parent.moduleSpecifier as ts.StringLiteral).text,
        'default',
        kind,
        seen,
      );
    if (ts.isImportSpecifier(declaration) && !declaration.isTypeOnly) {
      const imported = declaration.parent.parent.parent;
      return this.exportedFunction(
        module.source.fileName,
        (imported.moduleSpecifier as ts.StringLiteral).text,
        (declaration.propertyName ?? declaration.name).text,
        kind,
        seen,
      );
    }
    if (
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent) &&
      ts.isVariableDeclaration(declaration.parent.parent)
    ) {
      const specifier = requiredModule(
        module,
        declaration.parent.parent.initializer,
      );
      const name = declaration.propertyName ?? declaration.name;
      if (specifier !== undefined && ts.isIdentifier(name))
        return this.exportedFunction(
          module.source.fileName,
          specifier,
          name.text,
          kind,
          seen,
        );
    }
    // Parameter-supplied functions and dynamic factory outputs use object identity.
    return false;
  }

  private async exportedFunction(
    importer: string,
    specifier: string,
    name: string,
    kind: 'factory' | 'compute',
    seen: Set<ts.Node | string>,
  ): Promise<boolean> {
    if (kind === 'factory') {
      if (specifier === '@code3d/core') return name === 'cached';
      if (specifier === '@code3d/core/replicad')
        return name === 'definePrimitive';
    }
    const path = await this.resolve(specifier, importer);
    if (!path || path.endsWith('.json')) return false;
    if (kind === 'factory' && !this.hasImports(path, await this.source(path)))
      return false;
    const key = kind + ':' + path + ':' + name;
    if (seen.has(key)) return false;
    seen.add(key);
    const module = await this.module(path);
    for (const statement of module.source.statements) {
      if (
        name === 'default' &&
        ts.isExportAssignment(statement) &&
        !statement.isExportEquals
      )
        return this.resolveFunction(module, statement.expression, kind, seen);
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const clause = statement.exportClause;
        if (
          !clause &&
          statement.moduleSpecifier &&
          (await this.exportedFunction(
            path,
            (statement.moduleSpecifier as ts.StringLiteral).text,
            name,
            kind,
            seen,
          ))
        )
          return true;
        if (clause && ts.isNamedExports(clause))
          for (const item of clause.elements) {
            if (item.isTypeOnly || item.name.text !== name) continue;
            const local = item.propertyName ?? item.name;
            if (statement.moduleSpecifier) {
              if (
                await this.exportedFunction(
                  path,
                  (statement.moduleSpecifier as ts.StringLiteral).text,
                  local.text,
                  kind,
                  seen,
                )
              )
                return true;
            } else if (
              ts.isIdentifier(local) &&
              (await this.resolveFunction(module, local, kind, seen))
            )
              return true;
          }
      }
      if (
        !ts.canHaveModifiers(statement) ||
        !ts
          .getModifiers(statement)
          ?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      if (
        ts.isFunctionDeclaration(statement) &&
        (statement.name?.text === name ||
          (name === 'default' &&
            ts
              .getModifiers(statement)
              ?.some(
                modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword,
              )))
      )
        return kind === 'compute';
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name &&
            declaration.initializer &&
            (await this.resolveFunction(
              module,
              declaration.initializer,
              kind,
              seen,
            ))
          )
            return true;
    }
    return false;
  }

  private async fingerprint(
    module: Module,
    roots: readonly ts.Expression[],
  ): Promise<string | undefined> {
    let dynamic = false;
    const declarations = new Set<ts.Declaration>();
    const imports = new Set<string>();
    const pieces: string[] = [];
    const printer = ts.createPrinter({removeComments: true});
    const within = (node: ts.Node, owner: ts.Node) =>
      node.pos >= owner.pos && node.end <= owner.end;
    const add = (root: ts.Node): void => {
      pieces.push(
        printer
          .printNode(ts.EmitHint.Unspecified, root, module.source)
          .replace(/^export\s+(?:default\s+)?/, ''),
      );
      const visit = (node: ts.Node): void => {
        if (ts.isTypeNode(node)) return;
        if (ts.isCallExpression(node)) {
          const specifier = requiredModule(module, node);
          if (specifier) imports.add(specifier);
        }
        if (ts.isIdentifier(node)) {
          for (const declaration of module.checker.getSymbolAtLocation(node)
            ?.declarations ?? []) {
            if (within(declaration, root) || declarations.has(declaration))
              continue;
            declarations.add(declaration);
            let binding: ts.Node = declaration;
            while (ts.isBindingElement(binding))
              binding = binding.parent.parent;
            if (
              ts.isParameter(binding) ||
              (ts.isVariableDeclaration(binding) &&
                !(
                  ts.isVariableStatement(binding.parent.parent) &&
                  ts.isSourceFile(binding.parent.parent.parent)
                ))
            ) {
              dynamic = true;
              continue;
            }
            if (
              ts.isImportSpecifier(declaration) ||
              ts.isNamespaceImport(declaration) ||
              ts.isImportClause(declaration)
            ) {
              let imported: ts.Node = declaration;
              while (!ts.isImportDeclaration(imported))
                imported = imported.parent;
              imports.add(
                (
                  (imported as ts.ImportDeclaration)
                    .moduleSpecifier as ts.StringLiteral
                ).text,
              );
              pieces.push(
                printer.printNode(
                  ts.EmitHint.Unspecified,
                  imported,
                  module.source,
                ),
              );
            } else if (
              ts.isBindingElement(declaration) &&
              ts.isVariableDeclaration(binding)
            ) {
              add(binding);
            } else if (
              ts.isVariableDeclaration(declaration) ||
              ts.isFunctionDeclaration(declaration) ||
              ts.isClassDeclaration(declaration) ||
              ts.isEnumDeclaration(declaration)
            )
              add(declaration);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(root);
    };
    roots.forEach(add);
    if (dynamic) return undefined;
    for (const specifier of [...imports].sort()) {
      const path = await this.resolve(specifier, module.source.fileName);
      pieces.push(path ? await this.graph(path) : 'disabled:' + specifier);
    }
    return digest(JSON.stringify([module.source.fileName, pieces]));
  }

  private graph(root: string): Promise<string> {
    let pending = this.graphs.get(root);
    if (!pending) {
      pending = (async () => {
        const visited = new Set<string>();
        const pieces: [string, string][] = [];
        const visit = async (path: string): Promise<void> => {
          if (visited.has(path)) return;
          visited.add(path);
          const bytes = await this.files.readFile(path);
          if (!bytes) throw new Error(`Cache dependency not found: ${path}`);
          pieces.push([path, await digest(bytes)]);
          if (/\.(?:json|wasm)$/.test(path)) return;
          const source = decodeProjectFile(bytes);
          const {importedFiles} = ts.preProcessFile(source, true, true);
          for (const imported of importedFiles) {
            if (nodeBuiltin(imported.fileName)) {
              pieces.push([imported.fileName, 'node-builtin']);
              continue;
            }
            const resolved = await this.resolve(imported.fileName, path);
            if (resolved) await visit(resolved);
          }
        };
        await visit(root);
        return digest(
          JSON.stringify(pieces.sort(([a], [b]) => a.localeCompare(b))),
        );
      })();
      this.graphs.set(root, pending);
    }
    return pending;
  }
}

function nodeBuiltin(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    __CODE3D_NODE_BUILTINS__.includes(specifier)
  );
}

function requiredModule(
  module: Module,
  expression: ts.Expression | undefined,
): string | undefined {
  if (
    !expression ||
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== 'require' ||
    module.checker.getSymbolAtLocation(expression.expression)?.declarations
      ?.length
  )
    return undefined;
  const argument = expression.arguments[0];
  return argument && ts.isStringLiteralLike(argument)
    ? argument.text
    : undefined;
}

export function identifyCachedCall(
  original: ts.Node,
  visited: ts.Node,
  definitions: CachedDefinitions,
  factory: ts.NodeFactory,
): ts.Node {
  if (!ts.isCallExpression(original) || !ts.isCallExpression(visited))
    return visited;
  const identity = definitions.get(original.getStart());
  if (!identity) return visited;
  return factory.updateCallExpression(
    visited,
    visited.expression,
    visited.typeArguments,
    [
      factory.createCallExpression(
        factory.createIdentifier('__code3dCachedFunction'),
        undefined,
        [visited.arguments[0], factory.createStringLiteral(identity)],
      ),
      ...visited.arguments.slice(1),
    ],
  );
}

export function transformCachedDefinitions(
  path: string,
  source: string,
  definitions: CachedDefinitions,
): string {
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = ts.transform(parsed, [
    context => source => {
      const visit = (node: ts.Node): ts.Node =>
        identifyCachedCall(
          node,
          ts.visitEachChild(node, visit, context),
          definitions,
          context.factory,
        );
      return ts.visitNode(source, visit) as ts.SourceFile;
    },
  ]);
  try {
    return ts.createPrinter().printFile(result.transformed[0]);
  } finally {
    result.dispose();
  }
}

async function digest(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
