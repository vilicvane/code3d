import ts from '@typescript/typescript6';
import type {TopologyKind} from '@code3d/core/tooling';
import {code3dAnnotations, type Code3dAnnotation} from './annotations';
import type {
  ToolParameterAction,
  ToolParameterConfig,
  ToolParameterConstraints,
  ToolParameterKind,
} from './tool-parameter-config';

export type ParameterAnnotationSite = Readonly<{
  annotation: Code3dAnnotation;
  declaration?: ts.Node;
  parameters?: readonly SignatureParameter[];
}>;

export type ResolvedParameterAnnotation = Readonly<{
  annotation: Code3dAnnotation;
  parameter: SignatureParameter;
  index: number;
  name: string;
  config: ToolParameterConfig;
}>;

export class ParameterAnnotationError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
  }
}

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

export function isToolSelectionKind(kind: unknown): kind is TopologyKind {
  return kind === 'vertex' || kind === 'edge' || kind === 'surface';
}

export type SignatureParameter = Readonly<{
  name: string;
  optional: boolean;
  multiple: boolean;
}>;

export function signatureParameters(
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

export function parameterAnnotations(
  node: ts.Node,
): readonly Code3dAnnotation[] {
  const sourceFile = node.getSourceFile();
  // JSDoc on a const belongs to its variable statement, including emitted .d.ts.
  const owner =
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
      ? node.parent.parent
      : node;
  return code3dAnnotations(
    sourceFile,
    owner.getFullStart(),
    owner.getStart(sourceFile),
  ).filter(annotation => annotation.name === 'param');
}

export function parameterAnnotationSites(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): ParameterAnnotationSite[] {
  const sites = new Map<number, ParameterAnnotationSite>(
    code3dAnnotations(sourceFile)
      .filter(annotation => annotation.name === 'param')
      .map(annotation => [annotation.start, {annotation}]),
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node)
    ) {
      const annotations = parameterAnnotations(node);
      if (annotations.length) {
        const signature = ts.isFunctionLike(node)
          ? checker.getSignatureFromDeclaration(node)
          : checker.getTypeAtLocation(node).getCallSignatures()[0];
        const parameters =
          signature && signatureParameters(signature, checker, node);
        for (const annotation of annotations) {
          sites.set(annotation.start, {
            annotation,
            declaration: node,
            parameters,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...sites.values()];
}

export function readToolParameterAnnotations(
  declaration: ts.Node,
  parameters: readonly SignatureParameter[],
): ResolvedParameterAnnotation[] {
  const seen = new Set<string>();
  return parameterAnnotations(declaration).map(annotation =>
    validateParameterAnnotation({annotation, declaration, parameters}, seen),
  );
}

export function parameterAnnotationDiagnostics(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): ts.Diagnostic[] {
  const diagnostics: ts.Diagnostic[] = [];
  const seenByDeclaration = new Map<ts.Node | undefined, Set<string>>();
  for (const site of parameterAnnotationSites(sourceFile, checker)) {
    const seen = seenByDeclaration.get(site.declaration) ?? new Set<string>();
    seenByDeclaration.set(site.declaration, seen);
    try {
      validateParameterAnnotation(site, seen);
    } catch (error) {
      if (!(error instanceof ParameterAnnotationError)) throw error;
      diagnostics.push({
        category: ts.DiagnosticCategory.Error,
        code: 0,
        source: 'code3d',
        start: error.start,
        length: Math.max(1, error.end - error.start),
        messageText: error.message,
        file: sourceFile,
      });
    }
  }
  return diagnostics;
}

function validateParameterAnnotation(
  {annotation, parameters}: ParameterAnnotationSite,
  seen: Set<string>,
): ResolvedParameterAnnotation {
  if (!parameters) {
    throw annotationError(
      annotation,
      '@code3d.param requires a callable declaration.',
    );
  }
  const match = /^([A-Za-z_$][\w$]*)\s+([\s\S]+)$/.exec(annotation.value);
  if (!match) {
    throw annotationError(
      annotation,
      '@code3d.param requires a parameter name and an object literal.',
    );
  }
  const [, name, expression] = match;
  const index = parameters.findIndex(parameter => parameter.name === name);
  if (index < 0 || seen.has(name)) {
    throw new ParameterAnnotationError(
      index < 0
        ? `@code3d.param names an unknown parameter: ${name}.`
        : `@code3d.param annotates ${name} more than once.`,
      annotation.valueStart,
      annotation.valueStart + name.length,
    );
  }
  seen.add(name);
  const value = parseObjectLiteral(expression, annotation);
  rejectUnknownFields(
    value,
    new Set(['kind', 'label', 'constraints', 'actions']),
    annotation,
    name,
  );
  const kind = value.kind;
  if (
    typeof kind !== 'string' ||
    !toolParameterKinds.has(kind as ToolParameterKind)
  ) {
    throw annotationError(
      annotation,
      `@code3d.param ${name} has an unsupported kind.`,
    );
  }
  if (value.label !== undefined && typeof value.label !== 'string') {
    throw annotationError(
      annotation,
      `@code3d.param ${name} label must be a string.`,
    );
  }
  const constraints = parseConstraints(value.constraints, annotation, name);
  const actions = parseParameterActions(value.actions, annotation, name);
  if (isToolSelectionKind(kind) && constraints) {
    throw annotationError(
      annotation,
      `@code3d.param ${name} selection does not accept numeric constraints.`,
    );
  }
  const config = {
    kind: kind as ToolParameterKind,
    ...(value.label === undefined ? {} : {label: value.label as string}),
    ...(constraints ? {constraints} : {}),
    actions,
  } as ToolParameterConfig;
  return {
    annotation,
    parameter: parameters[index],
    index,
    name,
    config,
  };
}

function annotationError(
  annotation: Code3dAnnotation,
  message: string,
): ParameterAnnotationError {
  return new ParameterAnnotationError(
    message,
    annotation.valueStart,
    annotation.valueEnd,
  );
}

function parseObjectLiteral(
  expression: string,
  annotation: Code3dAnnotation,
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
    throw annotationError(
      annotation,
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
    throw annotationError(
      annotation,
      '@code3d.param configuration must be an object literal.',
    );
  }
  return staticObjectValue(value, annotation);
}

function staticObjectValue(
  object: ts.ObjectLiteralExpression,
  annotation: Code3dAnnotation,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw annotationError(
        annotation,
        'Tool configuration only accepts static property assignments.',
      );
    }
    const name = propertyName(property.name);
    if (!name) {
      throw annotationError(
        annotation,
        'Tool configuration does not accept computed property names.',
      );
    }
    if (Object.hasOwn(result, name)) {
      throw annotationError(
        annotation,
        `Tool configuration defines ${name} more than once.`,
      );
    }
    result[name] = staticValue(property.initializer, annotation);
  }
  return result;
}

function staticValue(
  expression: ts.Expression,
  annotation: Code3dAnnotation,
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
        throw annotationError(
          annotation,
          'Tool configuration arrays must contain static values.',
        );
      }
      return staticValue(element, annotation);
    });
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return staticObjectValue(expression, annotation);
  }
  throw annotationError(
    annotation,
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
  annotation: Code3dAnnotation,
  parameterName: string,
): ToolParameterConstraints | undefined {
  if (value === undefined) return undefined;
  if (!isStaticObject(value)) {
    throw annotationError(
      annotation,
      `@code3d.param ${parameterName} constraints must be an object.`,
    );
  }
  const allowedFields = new Set(['min', 'exclusiveMin', 'max', 'exclusiveMax']);
  rejectUnknownFields(value, allowedFields, annotation, parameterName);
  const constraints: Record<string, number> = {};
  for (const [name, bound] of Object.entries(value)) {
    if (typeof bound !== 'number' || !Number.isFinite(bound)) {
      throw annotationError(
        annotation,
        `@code3d.param ${parameterName} constraint ${name} must be a finite number.`,
      );
    }
    constraints[name] = bound;
  }
  return constraints;
}

function parseParameterActions(
  value: unknown,
  annotation: Code3dAnnotation,
  parameterName: string,
): readonly ToolParameterAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw annotationError(
      annotation,
      `@code3d.param ${parameterName} actions must be an array.`,
    );
  }
  return value.map(action => {
    if (!isStaticObject(action)) {
      throw annotationError(
        annotation,
        `@code3d.param ${parameterName} actions must be objects.`,
      );
    }
    rejectUnknownFields(
      action,
      new Set(['action', 'label']),
      annotation,
      parameterName,
    );
    if (action.action !== 'remove-argument') {
      throw annotationError(
        annotation,
        `@code3d.param ${parameterName} has an unsupported action.`,
      );
    }
    if (typeof action.label !== 'string' || action.label.length === 0) {
      throw annotationError(
        annotation,
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
  annotation: Code3dAnnotation,
  parameterName: string,
): void {
  const unknown = Object.keys(object).find(name => !allowed.has(name));
  if (unknown) {
    throw annotationError(
      annotation,
      `@code3d.param ${parameterName} has an unknown field: ${unknown}.`,
    );
  }
}

function isStaticObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
