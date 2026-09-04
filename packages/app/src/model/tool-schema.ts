import ts from '@typescript/typescript6';
import es5Library from '@typescript/old/lib/lib.es5.d.ts?raw';
import type {ParameterKind} from '@code3d/core/tooling';
import type {SourceRef} from '@code3d/core/tooling';
import {
  injectedPackageFiles,
  injectedPackages,
} from '../monaco/injected-packages';
import {normalizeProjectPath, type ModelProject} from '../project/project';

export type ToolParameterKind = ParameterKind | 'edge';

export type ToolParameterAction = Readonly<{
  action: 'remove-argument';
  label: string;
}>;

export type ToolParameterConstraints = Readonly<{
  min?: number;
  exclusiveMin?: number;
  max?: number;
  exclusiveMax?: number;
}>;

export type ToolParameterSchema = Readonly<{
  index: number;
  name: string;
  optional: boolean;
  kind: ToolParameterKind;
  label: string;
  constraints?: ToolParameterConstraints;
  actions: readonly ToolParameterAction[];
}>;

export type ToolSignatureSchema = Readonly<{
  id: string;
  name: string;
  parameters: readonly ToolParameterSchema[];
}>;

export type ToolArgumentEditTarget = Readonly<
  | {
      kind: 'present';
      sourceRef: SourceRef;
      removalSourceRef: SourceRef;
    }
  | {
      kind: 'omitted';
      sourceRef: SourceRef;
      needsComma: boolean;
    }
>;

export type ToolArgumentSource = Readonly<{
  name: string;
  index: number;
  target: ToolArgumentEditTarget;
}>;

export type ToolCallSchemaMap = ReadonlyMap<string, ToolSignatureSchema>;

const toolParameterKinds = new Set<ToolParameterKind>([
  'length',
  'angle',
  'ratio',
  'count',
  'edge',
]);

export function resolveProjectToolCalls(
  project: ModelProject,
): ReadonlyMap<string, ToolCallSchemaMap> {
  const sources = new Map<string, string>();
  project.files.forEach(file =>
    sources.set(normalizeProjectPath(file.path), file.source),
  );
  injectedPackageFiles.forEach(file => {
    if (file.filePath.endsWith('.d.ts')) {
      sources.set(virtualFilePath(file.filePath), file.content);
    }
  });
  sources.set('/lib.es5.d.ts', es5Library);

  const sourceFiles = new Map<string, ts.SourceFile>();
  const host: ts.CompilerHost = {
    fileExists: fileName => sources.has(virtualFilePath(fileName)),
    readFile: fileName => sources.get(virtualFilePath(fileName)),
    getSourceFile(fileName, languageVersion) {
      const path = virtualFilePath(fileName);
      const source = sources.get(path);
      if (source === undefined) return undefined;
      const existing = sourceFiles.get(path);
      if (existing) return existing;
      const sourceFile = ts.createSourceFile(
        path,
        source,
        languageVersion,
        true,
        scriptKind(path),
      );
      sourceFiles.set(path, sourceFile);
      return sourceFile;
    },
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    getCanonicalFileName: fileName => virtualFilePath(fileName),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    resolveModuleNames: (moduleNames, containingFile) =>
      moduleNames.map(specifier =>
        resolveModule(specifier, virtualFilePath(containingFile), sources),
      ),
  };
  const program = ts.createProgram({
    rootNames: [...sources.keys()],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: true,
      noLib: false,
      skipLibCheck: true,
      strict: true,
    },
    host,
  });
  const checker = program.getTypeChecker();
  const declarationSchemas = new Map<
    ts.SignatureDeclaration,
    ToolSignatureSchema | undefined
  >();
  const result = new Map<string, ToolCallSchemaMap>();

  for (const file of project.files) {
    const path = normalizeProjectPath(file.path);
    const sourceFile = program.getSourceFile(path);
    if (!sourceFile) continue;
    const calls = new Map<string, ToolSignatureSchema>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const declaration = checker
          .getResolvedSignature(node)
          ?.getDeclaration();
        if (declaration) {
          let schema = declarationSchemas.get(declaration);
          if (!declarationSchemas.has(declaration)) {
            schema = toolSignatureSchema(declaration);
            declarationSchemas.set(declaration, schema);
          }
          if (schema) {
            calls.set(
              toolCallKey(node.getStart(sourceFile), node.getEnd()),
              schema,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    result.set(path, calls);
  }
  return result;
}

export function toolCallKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function toolSignatureSchema(
  declaration: ts.SignatureDeclaration,
): ToolSignatureSchema | undefined {
  const parameterAnnotations = ts
    .getJSDocTags(declaration)
    .flatMap(tag => code3dTag(tag, 'param'));
  if (parameterAnnotations.length === 0) return undefined;
  const name = declarationName(declaration);
  const parameters = parameterAnnotations.map(annotation => {
    const match = /^([A-Za-z_$][\w$]*)\s+([\s\S]+)$/.exec(annotation);
    if (!match) {
      throw toolSchemaError(
        declaration,
        '@code3d.param requires a parameter name and an object literal.',
      );
    }
    const [, parameterName, expression] = match;
    const index = declaration.parameters.findIndex(
      parameter =>
        ts.isIdentifier(parameter.name) &&
        parameter.name.text === parameterName,
    );
    if (index < 0) {
      throw toolSchemaError(
        declaration,
        `@code3d.param names an unknown parameter: ${parameterName}.`,
      );
    }
    const parameter = declaration.parameters[index];
    const config = parseObjectLiteral(expression, declaration);
    const allowedFields = new Set(['kind', 'label', 'constraints', 'actions']);
    rejectUnknownFields(config, allowedFields, declaration, parameterName);
    const kind = config.kind;
    if (
      typeof kind !== 'string' ||
      !toolParameterKinds.has(kind as ToolParameterKind)
    ) {
      throw toolSchemaError(
        declaration,
        `@code3d.param ${parameterName} has an unsupported kind.`,
      );
    }
    if (config.label !== undefined && typeof config.label !== 'string') {
      throw toolSchemaError(
        declaration,
        `@code3d.param ${parameterName} label must be a string.`,
      );
    }
    return {
      index,
      name: parameterName,
      optional: Boolean(parameter.questionToken || parameter.initializer),
      kind: kind as ToolParameterKind,
      label:
        typeof config.label === 'string'
          ? config.label
          : humanizeIdentifier(parameterName),
      constraints: parseConstraints(
        config.constraints,
        declaration,
        parameterName,
      ),
      actions: parseParameterActions(
        config.actions,
        declaration,
        parameterName,
      ),
    } satisfies ToolParameterSchema;
  });
  const duplicate = parameters.find(
    (parameter, index) =>
      parameters.findIndex(candidate => candidate.name === parameter.name) !==
      index,
  );
  if (duplicate) {
    throw toolSchemaError(
      declaration,
      `@code3d.param annotates ${duplicate.name} more than once.`,
    );
  }
  const sourceFile = declaration.getSourceFile();
  return {
    id: `${sourceFile.fileName}:${declaration.getStart(sourceFile)}:${declaration.getEnd()}`,
    name,
    parameters: [...parameters].sort((left, right) => left.index - right.index),
  };
}

function code3dTag(tag: ts.JSDocTag, name: string): string[] {
  if (tag.tagName.text !== 'code3d') return [];
  const comment = jsDocComment(tag.comment).trim();
  const prefix = `.${name}`;
  return comment.startsWith(prefix) && /\s/.test(comment[prefix.length] ?? '')
    ? [comment.slice(prefix.length).trim()]
    : [];
}

function jsDocComment(comment: ts.JSDocTag['comment']): string {
  if (typeof comment === 'string') return comment;
  return comment?.map(part => part.text).join('') ?? '';
}

function parseObjectLiteral(
  expression: string,
  declaration: ts.SignatureDeclaration,
): Readonly<Record<string, unknown>> {
  const prefix = 'const __code3dToolConfig = (';
  const sourceFile = ts.createSourceFile(
    'code3d-tool-annotation.ts',
    `${prefix}${expression});`,
    ts.ScriptTarget.Latest,
    true,
  );
  const diagnostic = (
    sourceFile as ts.SourceFile & {parseDiagnostics: readonly ts.Diagnostic[]}
  ).parseDiagnostics.find(
    candidate => candidate.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic) {
    throw toolSchemaError(
      declaration,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    );
  }
  const statement = sourceFile.statements[0];
  const initializer =
    statement && ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.initializer
      : undefined;
  const value =
    initializer && ts.isParenthesizedExpression(initializer)
      ? initializer.expression
      : initializer;
  if (!value || !ts.isObjectLiteralExpression(value)) {
    throw toolSchemaError(
      declaration,
      '@code3d.param configuration must be an object literal.',
    );
  }
  return staticObjectValue(value, declaration);
}

function staticObjectValue(
  object: ts.ObjectLiteralExpression,
  declaration: ts.SignatureDeclaration,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw toolSchemaError(
        declaration,
        'Tool configuration only accepts static property assignments.',
      );
    }
    const name = propertyName(property.name);
    if (!name) {
      throw toolSchemaError(
        declaration,
        'Tool configuration does not accept computed property names.',
      );
    }
    if (Object.hasOwn(result, name)) {
      throw toolSchemaError(
        declaration,
        `Tool configuration defines ${name} more than once.`,
      );
    }
    result[name] = staticValue(property.initializer, declaration);
  }
  return result;
}

function staticValue(
  expression: ts.Expression,
  declaration: ts.SignatureDeclaration,
): unknown {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.MinusToken ||
      expression.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const value = Number(expression.operand.text);
    return expression.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map(element => {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        throw toolSchemaError(
          declaration,
          'Tool configuration arrays must contain static values.',
        );
      }
      return staticValue(element, declaration);
    });
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return staticObjectValue(expression, declaration);
  }
  throw toolSchemaError(
    declaration,
    'Tool configuration values must be static literals.',
  );
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : ts.isNumericLiteral(name)
      ? name.text
      : undefined;
}

function parseConstraints(
  value: unknown,
  declaration: ts.SignatureDeclaration,
  parameterName: string,
): ToolParameterConstraints | undefined {
  if (value === undefined) return undefined;
  if (!isStaticObject(value)) {
    throw toolSchemaError(
      declaration,
      `@code3d.param ${parameterName} constraints must be an object.`,
    );
  }
  const allowedFields = new Set(['min', 'exclusiveMin', 'max', 'exclusiveMax']);
  rejectUnknownFields(value, allowedFields, declaration, parameterName);
  const constraints: Record<string, number> = {};
  for (const [name, bound] of Object.entries(value)) {
    if (typeof bound !== 'number' || !Number.isFinite(bound)) {
      throw toolSchemaError(
        declaration,
        `@code3d.param ${parameterName} constraint ${name} must be a finite number.`,
      );
    }
    constraints[name] = bound;
  }
  return constraints;
}

function parseParameterActions(
  value: unknown,
  declaration: ts.SignatureDeclaration,
  parameterName: string,
): readonly ToolParameterAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw toolSchemaError(
      declaration,
      `@code3d.param ${parameterName} actions must be an array.`,
    );
  }
  return value.map(action => {
    if (!isStaticObject(action)) {
      throw toolSchemaError(
        declaration,
        `@code3d.param ${parameterName} actions must be objects.`,
      );
    }
    rejectUnknownFields(
      action,
      new Set(['action', 'label']),
      declaration,
      parameterName,
    );
    if (action.action !== 'remove-argument') {
      throw toolSchemaError(
        declaration,
        `@code3d.param ${parameterName} has an unsupported action.`,
      );
    }
    if (typeof action.label !== 'string' || action.label.length === 0) {
      throw toolSchemaError(
        declaration,
        `@code3d.param ${parameterName} action label must be a non-empty string.`,
      );
    }
    return {
      action: 'remove-argument',
      label: action.label,
    };
  });
}

function rejectUnknownFields(
  object: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  declaration: ts.SignatureDeclaration,
  parameterName: string,
): void {
  const unknown = Object.keys(object).find(name => !allowed.has(name));
  if (unknown) {
    throw toolSchemaError(
      declaration,
      `@code3d.param ${parameterName} has an unknown field: ${unknown}.`,
    );
  }
}

function isStaticObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function declarationName(declaration: ts.SignatureDeclaration): string {
  const name = declaration.name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) {
    return name.text;
  }
  throw toolSchemaError(
    declaration,
    '@code3d.param requires a named function or method signature.',
  );
}

function toolSchemaError(
  declaration: ts.SignatureDeclaration,
  message: string,
): Error {
  const sourceFile = declaration.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(
    declaration.getStart(sourceFile),
  );
  return new Error(
    `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}: ${message}`,
  );
}

function resolveModule(
  specifier: string,
  containingFile: string,
  sources: ReadonlyMap<string, string>,
): ts.ResolvedModule | undefined {
  const packageEntry = injectedPackages.find(
    candidate => candidate.specifier === specifier,
  );
  if (packageEntry) {
    const entry = packageEntry.files.find(file =>
      file.filePath.endsWith('/bld/library/index.d.ts'),
    );
    return entry
      ? resolvedModule(virtualFilePath(entry.filePath), true)
      : undefined;
  }
  if (!specifier.startsWith('.')) return undefined;
  const directory = containingFile.slice(0, containingFile.lastIndexOf('/'));
  const candidate = normalizeProjectPath(`${directory}/${specifier}`);
  const resolved = moduleCandidates(candidate).find(path => sources.has(path));
  return resolved ? resolvedModule(resolved, false) : undefined;
}

function moduleCandidates(path: string): string[] {
  const scriptExtension = /\.(?:mjs|cjs|js|jsx)$/i.exec(path);
  if (scriptExtension) {
    const stem = path.slice(0, -scriptExtension[0].length);
    return [
      `${stem}.ts`,
      `${stem}.tsx`,
      `${stem}.mts`,
      `${stem}.cts`,
      `${stem}.d.ts`,
      path,
    ];
  }
  if (/\.[^/]+$/.test(path)) return [path];
  return [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.mts`,
    `${path}.cts`,
    `${path}.d.ts`,
    `${path}/index.ts`,
    `${path}/index.tsx`,
    `${path}/index.d.ts`,
  ];
}

function resolvedModule(
  resolvedFileName: string,
  isExternalLibraryImport: boolean,
): ts.ResolvedModule {
  return {
    resolvedFileName,
    isExternalLibraryImport,
  };
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

function virtualFilePath(path: string): string {
  return path.startsWith('file://')
    ? normalizeProjectPath(new URL(path).pathname)
    : normalizeProjectPath(path);
}

function humanizeIdentifier(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim();
  return words.length === 0
    ? value
    : `${words[0].toUpperCase()}${words.slice(1)}`;
}
