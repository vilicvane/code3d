import ts from '@typescript/typescript6';
import es5Library from '@typescript/old/lib/lib.es5.d.ts?raw';
import type {
  ParameterKind,
  SourceRef,
  TopologyKind,
} from '@code3d/core/tooling';
import {
  injectedPackageFiles,
  injectedPackages,
} from '../monaco/injected-packages';
import {normalizeProjectPath, type ModelProject} from '../project/project';
import {
  indexParameterDefinitions,
  sourceNodeKey,
  type ParameterDefinitionMap,
  type SourceParameterTarget,
} from './parameter-definitions';

export {sourceNodeKey};
export type {ParameterDefinitionMap, SourceParameterTarget};

export type ToolParameterKind = ParameterKind | TopologyKind;

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

type ToolParameterSchemaBase = Readonly<{
  index: number;
  name: string;
  optional: boolean;
  label: string;
  actions: readonly ToolParameterAction[];
}>;

export type ToolValueParameterSchema = ToolParameterSchemaBase &
  Readonly<{
    kind: ParameterKind;
    constraints?: ToolParameterConstraints;
  }>;

export type ToolSelectionParameterSchema = ToolParameterSchemaBase &
  Readonly<{
    kind: TopologyKind;
    multiple: boolean;
  }>;

export type ToolParameterSchema =
  ToolValueParameterSchema | ToolSelectionParameterSchema;

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

export type ProjectToolingIndex = Readonly<{
  toolCalls: ReadonlyMap<string, ToolCallSchemaMap>;
  parameterDefinitions: ReadonlyMap<string, ParameterDefinitionMap>;
}>;

const toolParameterKinds = new Set<ToolParameterKind>([
  'length',
  'angle',
  'ratio',
  'count',
  'scalar',
  'vertex',
  'edge',
  'surface',
]);

export function isToolSelectionParameter(
  parameter: ToolParameterSchema,
): parameter is ToolSelectionParameterSchema {
  return isTopologyKind(parameter.kind);
}

function isTopologyKind(kind: unknown): kind is TopologyKind {
  return kind === 'vertex' || kind === 'edge' || kind === 'surface';
}

export function resolveProjectTooling(
  project: ModelProject,
): ProjectToolingIndex {
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
    ts.Signature,
    Map<ts.Node, ToolSignatureSchema | undefined>
  >();
  const toolCalls = new Map<string, ToolCallSchemaMap>();
  const parameterDefinitions = new Map<string, ParameterDefinitionMap>();
  const parameterTargets = new Map<ts.Symbol, SourceParameterTarget | null>();

  for (const file of project.files) {
    const path = normalizeProjectPath(file.path);
    const sourceFile = program.getSourceFile(path);
    if (!sourceFile) continue;
    // TypeScript 6 can cache a recovery signature and omit its overload error
    // if semantic diagnostics are requested after getResolvedSignature().
    const semanticDiagnostics = program.getSemanticDiagnostics(sourceFile);
    const calls = new Map<string, ToolSignatureSchema>();
    const definitions = new Map<string, SourceParameterTarget>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const candidates: ts.Signature[] = [];
        const resolved = checker.getResolvedSignature(node, candidates);
        const resolvedSchema = signatureToolSchema(
          resolved,
          node.expression,
          checker,
          declarationSchemas,
        );
        let schema = resolvedSchema;
        if (!schema) {
          const recoverySchema = candidates
            .map(candidate =>
              signatureToolSchema(
                candidate,
                node.expression,
                checker,
                declarationSchemas,
              ),
            )
            .find(candidate => candidate !== undefined);
          if (
            recoverySchema &&
            hasCallSignatureError(node, semanticDiagnostics)
          ) {
            schema = recoverySchema;
          }
        }
        if (schema) {
          calls.set(
            toolCallKey(node.getStart(sourceFile), node.getEnd()),
            schema,
          );
          indexParameterDefinitions(
            node,
            schema,
            checker,
            parameterTargets,
            definitions,
            sourceFile,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    toolCalls.set(path, calls);
    parameterDefinitions.set(path, definitions);
  }
  return {toolCalls, parameterDefinitions};
}

const callSignatureDiagnosticCodes = new Set([
  2345, // Argument of type ... is not assignable ...
  2554, // Expected ... arguments, but got ...
  2555, // Expected at least ... arguments, but got ...
  2556, // A spread argument must have a tuple type or target a rest parameter.
  2575, // No overload expects ... arguments.
  2769, // No overload matches this call.
]);

function hasCallSignatureError(
  call: ts.CallExpression,
  diagnostics: readonly ts.Diagnostic[],
): boolean {
  return diagnostics.some(
    diagnostic =>
      callSignatureDiagnosticCodes.has(diagnostic.code) &&
      diagnostic.start !== undefined &&
      diagnosticBelongsToCall(diagnostic, call),
  );
}

function diagnosticBelongsToCall(
  diagnostic: ts.Diagnostic,
  call: ts.CallExpression,
): boolean {
  const start = diagnostic.start;
  if (start === undefined) return false;
  const end = start + Math.max(diagnostic.length ?? 0, 1);
  const sourceFile = call.getSourceFile();
  return [call.expression, ...call.arguments].some(node => {
    return node.getStart(sourceFile) <= start && end <= node.getEnd();
  });
}

type SignatureParameter = Readonly<{
  name: string;
  optional: boolean;
  multiple: boolean;
}>;

function signatureToolSchema(
  signature: ts.Signature | undefined,
  expression: ts.Expression,
  checker: ts.TypeChecker,
  schemas: Map<ts.Signature, Map<ts.Node, ToolSignatureSchema | undefined>>,
): ToolSignatureSchema | undefined {
  if (!signature) return undefined;
  const declaration = annotationDeclaration(signature, expression, checker);
  if (!declaration) return undefined;
  let declarations = schemas.get(signature);
  if (!declarations) {
    declarations = new Map();
    schemas.set(signature, declarations);
  }
  if (!declarations.has(declaration)) {
    declarations.set(
      declaration,
      toolSignatureSchema(
        declaration,
        signatureParameters(signature, checker, declaration),
      ),
    );
  }
  return declarations.get(declaration);
}

function parameterAnnotations(node: ts.Node): string[] {
  return ts.getJSDocTags(node).flatMap(tag => code3dTag(tag, 'param'));
}

function annotationDeclaration(
  signature: ts.Signature,
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.Node | undefined {
  const declaration = signature.getDeclaration();
  // Overload-specific annotations remain attached to the resolved signature.
  if (declaration?.name) {
    return parameterAnnotations(declaration).length ? declaration : undefined;
  }
  let symbol = checker.getSymbolAtLocation(expression);
  const visited = new Set<ts.Symbol>();
  while (symbol && !visited.has(symbol)) {
    visited.add(symbol);
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
      continue;
    }
    const annotated = symbol.declarations?.find(
      node => parameterAnnotations(node).length > 0,
    );
    if (annotated) return annotated;
    const variable = symbol.valueDeclaration;
    if (
      !variable ||
      !ts.isVariableDeclaration(variable) ||
      !variable.initializer
    )
      break;
    // Follow ordinary aliases, but do not borrow annotations from a factory's
    // implementation or assume that a wrapper preserves its input signature.
    symbol = checker.getSymbolAtLocation(variable.initializer);
  }
  return declaration && parameterAnnotations(declaration).length
    ? declaration
    : undefined;
}

function signatureParameters(
  signature: ts.Signature,
  checker: ts.TypeChecker,
  location: ts.Node,
): readonly SignatureParameter[] {
  const acceptsArray = (type: ts.Type): boolean =>
    type.isUnion()
      ? type.types.some(acceptsArray)
      : checker.isArrayType(type) || checker.isTupleType(type);

  return signature.getParameters().flatMap(parameter => {
    const declaration = parameter.valueDeclaration;
    const type = checker.getTypeOfSymbolAtLocation(parameter, location);
    if (
      declaration &&
      ts.isParameter(declaration) &&
      declaration.dotDotDotToken &&
      checker.isTupleType(type)
    ) {
      const reference = type as ts.TypeReference;
      const tuple = reference.target as ts.TupleType;
      return checker.getTypeArguments(reference).map((element, index) => {
        const label = tuple.labeledElementDeclarations?.[index];
        return {
          name:
            label && ts.isIdentifier(label.name)
              ? label.name.text
              : `arg${index}`,
          optional: Boolean(
            tuple.elementFlags[index] & ts.ElementFlags.Optional,
          ),
          multiple: acceptsArray(element),
        };
      });
    }
    return [
      {
        name: parameter.getName(),
        optional: Boolean(
          parameter.flags & ts.SymbolFlags.Optional ||
          (declaration &&
            ts.isParameter(declaration) &&
            (declaration.questionToken || declaration.initializer)),
        ),
        multiple: acceptsArray(type),
      },
    ];
  });
}

export function toolCallKey(start: number, end: number): string {
  return sourceNodeKey(start, end);
}

function toolSignatureSchema(
  declaration: ts.Node,
  signatureParameters: readonly SignatureParameter[],
): ToolSignatureSchema | undefined {
  const annotations = parameterAnnotations(declaration);
  if (annotations.length === 0) return undefined;
  const name = declarationName(declaration);
  const parameters = annotations.map(annotation => {
    const match = /^([A-Za-z_$][\w$]*)\s+([\s\S]+)$/.exec(annotation);
    if (!match) {
      throw toolSchemaError(
        declaration,
        '@code3d.param requires a parameter name and an object literal.',
      );
    }
    const [, parameterName, expression] = match;
    const index = signatureParameters.findIndex(
      parameter => parameter.name === parameterName,
    );
    if (index < 0) {
      throw toolSchemaError(
        declaration,
        `@code3d.param names an unknown parameter: ${parameterName}.`,
      );
    }
    const parameter = signatureParameters[index];
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
    const constraints = parseConstraints(
      config.constraints,
      declaration,
      parameterName,
    );
    const common = {
      index,
      name: parameterName,
      optional: parameter.optional,
      label:
        typeof config.label === 'string'
          ? config.label
          : humanizeIdentifier(parameterName),
      actions: parseParameterActions(
        config.actions,
        declaration,
        parameterName,
      ),
    } as const;
    if (isTopologyKind(kind)) {
      if (constraints) {
        throw toolSchemaError(
          declaration,
          `@code3d.param ${parameterName} selection does not accept numeric constraints.`,
        );
      }
      return {
        ...common,
        kind,
        multiple: parameter.multiple,
      } satisfies ToolSelectionParameterSchema;
    }
    return {
      ...common,
      kind: kind as ParameterKind,
      constraints,
    } satisfies ToolValueParameterSchema;
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
  declaration: ts.Node,
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
  declaration: ts.Node,
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

function staticValue(expression: ts.Expression, declaration: ts.Node): unknown {
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
  declaration: ts.Node,
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
  declaration: ts.Node,
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
  declaration: ts.Node,
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

function declarationName(declaration: ts.Node): string {
  const name = (declaration as ts.NamedDeclaration).name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) {
    return name.text;
  }
  throw toolSchemaError(
    declaration,
    '@code3d.param requires a named callable declaration.',
  );
}

function toolSchemaError(declaration: ts.Node, message: string): Error {
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
    return resolvedModule(virtualFilePath(packageEntry.entryFilePath), true);
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
