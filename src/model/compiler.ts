import ts from '@typescript/typescript6';
import {
  authoringApi,
  disposeModelObjects,
  isModelObject,
  type ModelSnapshotObject,
  type ModelObject,
  type ParameterKind,
  type ParameterTarget,
  type ParameterUsage,
  type SourceRef,
} from './runtime';

export type SourcePreview = Readonly<{
  sourceRef: SourceRef;
  objects: readonly ModelSnapshotObject[];
}>;

export type ModelModule = Readonly<{
  root: ModelSnapshotObject;
  exports: ReadonlyMap<string, string>;
  parameterImpacts: ReadonlyMap<string, number>;
  sourcePreviews: readonly SourcePreview[];
}>;

export class CompileFailure extends Error {
  readonly start?: number;
  readonly length?: number;

  constructor(message: string, start?: number, length?: number) {
    super(message);
    this.name = 'CompileFailure';
    this.start = start;
    this.length = length;
  }
}

type CommonJsModule = {
  exports: Record<string, unknown>;
};

type RuntimeParameterTarget = Readonly<{
  target: ParameterTarget;
  sensitivity: number;
}>;

type StaticParameterTarget = {
  binding?: string;
  sourceRef: Readonly<{start: number; end: number}>;
  value: number;
  label: string;
  description?: string;
  kind?: ParameterKind;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
};

type ParameterArgument = Readonly<{
  name: string;
  label: string;
  kind: ParameterKind;
  unit?: string;
}>;

type ParameterSignature = Readonly<{
  operation: string;
  arguments: readonly ParameterArgument[];
}>;

const signatures = new Map<string, ParameterSignature>([
  [
    'box',
    {
      operation: 'box',
      arguments: [
        {name: 'width', label: '宽度', kind: 'length'},
        {name: 'height', label: '高度', kind: 'length'},
        {name: 'depth', label: '深度', kind: 'length'},
      ],
    },
  ],
  [
    'cylinder',
    {
      operation: 'cylinder',
      arguments: [
        {name: 'radius', label: '半径', kind: 'length'},
        {name: 'height', label: '高度', kind: 'length'},
      ],
    },
  ],
  [
    'sphere',
    {
      operation: 'sphere',
      arguments: [{name: 'radius', label: '半径', kind: 'length'}],
    },
  ],
  [
    'at',
    {
      operation: 'at',
      arguments: [
        {name: 'x', label: 'X', kind: 'length'},
        {name: 'y', label: 'Y', kind: 'length'},
        {name: 'z', label: 'Z', kind: 'length'},
      ],
    },
  ],
  [
    'move',
    {
      operation: 'move',
      arguments: [
        {name: 'x', label: 'ΔX', kind: 'length'},
        {name: 'y', label: 'ΔY', kind: 'length'},
        {name: 'z', label: 'ΔZ', kind: 'length'},
      ],
    },
  ],
  [
    'rotate',
    {
      operation: 'rotate',
      arguments: [
        {name: 'x', label: 'X 旋转', kind: 'angle', unit: 'deg'},
        {name: 'y', label: 'Y 旋转', kind: 'angle', unit: 'deg'},
        {name: 'z', label: 'Z 旋转', kind: 'angle', unit: 'deg'},
      ],
    },
  ],
  [
    'scaled',
    {
      operation: 'scaled',
      arguments: [{name: 'factor', label: '缩放', kind: 'ratio'}],
    },
  ],
  [
    'fillet',
    {
      operation: 'fillet',
      arguments: [{name: 'radius', label: '圆角半径', kind: 'length'}],
    },
  ],
  [
    'chamfer',
    {
      operation: 'chamfer',
      arguments: [{name: 'distance', label: '倒角距离', kind: 'length'}],
    },
  ],
]);

const tracedObjects = new Set<ModelObject>();
const sourceTraces = new Map<
  string,
  {sourceRef: SourceRef; objects: Set<ModelObject>}
>();
const parameterFrames: ParameterUsage[][] = [];
const traceRuntime = Object.freeze({
  trace<T>(start: number, end: number, run: () => T): T {
    const parameters: ParameterUsage[] = [];
    parameterFrames.push(parameters);
    let result: T;
    try {
      result = run();
    } finally {
      parameterFrames.pop();
    }
    if (isModelObject(result)) {
      result.attachSource({start, end});
      result.attachParameters(parameters);
      recordSourceObject(start, end, result);
    } else {
      modelObjectsIn(result).forEach(object =>
        recordSourceObject(start, end, object),
      );
    }
    return result;
  },

  bind<T>(start: number, end: number, run: () => T): T {
    const result = run();
    modelObjectsIn(result).forEach(object =>
      recordSourceObject(start, end, object),
    );
    return result;
  },

  parameter(
    operation: string,
    argument: string,
    value: number,
    operationStart: number,
    operationEnd: number,
    expressionStart: number,
    expressionEnd: number,
    targets: readonly RuntimeParameterTarget[],
  ): number {
    const frame = parameterFrames.at(-1);
    if (!frame || !Number.isFinite(value)) {
      return value;
    }
    for (const {target, sensitivity} of targets) {
      if (Number.isFinite(sensitivity) && sensitivity !== 0) {
        frame.push({
          operation,
          argument,
          value,
          operationRef: {start: operationStart, end: operationEnd},
          expressionRef: {start: expressionStart, end: expressionEnd},
          target,
          sensitivity,
        });
      }
    }
    return value;
  },
});

function recordSourceObject(
  start: number,
  end: number,
  object: ModelObject,
): void {
  tracedObjects.add(object);
  const key = `${start}:${end}`;
  const sourceTrace = sourceTraces.get(key) ?? {
    sourceRef: {start, end},
    objects: new Set<ModelObject>(),
  };
  sourceTrace.objects.add(object);
  sourceTraces.set(key, sourceTrace);
}

function modelObjectsIn(
  value: unknown,
  seen = new Set<unknown>(),
): ModelObject[] {
  if (isModelObject(value)) {
    return [value];
  }
  if (!Array.isArray(value) || seen.has(value)) {
    return [];
  }
  seen.add(value);
  return value.flatMap(item => modelObjectsIn(item, seen));
}

export function compileModel(source: string): ModelModule {
  tracedObjects.clear();
  sourceTraces.clear();
  parameterFrames.length = 0;
  const result = ts.transpileModule(source, {
    fileName: 'model.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      isolatedModules: true,
    },
    reportDiagnostics: true,
    transformers: {
      before: [createTraceTransformer()],
    },
  });

  const errors = (result.diagnostics ?? []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw diagnosticFailure(errors[0]);
  }

  const module: CommonJsModule = {exports: {}};
  const requireModule = (specifier: string): unknown => {
    if (specifier === 'code3d') {
      return authoringApi;
    }
    throw new Error(`prototype 暂不支持导入模块：${specifier}`);
  };

  const execute = new Function(
    'require',
    'module',
    'exports',
    '__code3d',
    `"use strict";\n${result.outputText}\n//# sourceURL=code3d-model.js`,
  );

  try {
    execute(requireModule, module, module.exports, traceRuntime);

    const root = module.exports.default;
    if (!isModelObject(root)) {
      throw new Error('模型模块必须 default export 一个 ModelObject。');
    }

    const modelExports = new Map<string, ModelObject>();
    for (const [name, value] of Object.entries(module.exports)) {
      if (isModelObject(value)) {
        modelExports.set(name, value);
      }
    }

    const meshCache = new Map();
    const snapshots = new Map<ModelObject, ModelSnapshotObject>();
    const snapshotOf = (object: ModelObject): ModelSnapshotObject => {
      const snapshot = snapshots.get(object) ?? object.toSnapshot(meshCache);
      snapshots.set(object, snapshot);
      return snapshot;
    };
    const rootSnapshot = snapshotOf(root);
    return {
      root: rootSnapshot,
      exports: new Map(
        [...modelExports].map(([name, modelObject]) => [
          name,
          modelObject.nodeId,
        ]),
      ),
      parameterImpacts: countParameterImpacts(rootSnapshot),
      sourcePreviews: [...sourceTraces.values()].map(
        ({sourceRef, objects}) => ({
          sourceRef,
          objects: [...objects].map(snapshotOf),
        }),
      ),
    };
  } finally {
    disposeModelObjects(tracedObjects);
    tracedObjects.clear();
    sourceTraces.clear();
    parameterFrames.length = 0;
  }
}

function createTraceTransformer(): ts.TransformerFactory<ts.SourceFile> {
  return context => {
    const {factory} = context;

    return sourceFile => {
      const bindings = collectStaticParameterTargets(sourceFile);
      const visit: ts.Visitor = node => {
        const visited = ts.visitEachChild(node, visit, context);
        if (
          ts.isVariableDeclaration(node) &&
          ts.isVariableDeclaration(visited) &&
          node.initializer &&
          visited.initializer &&
          isTraceableExpression(node.initializer, sourceFile)
        ) {
          return factory.updateVariableDeclaration(
            visited,
            visited.name,
            visited.exclamationToken,
            visited.type,
            traceExpression(
              visited.initializer,
              node.name.getStart(sourceFile),
              node.initializer.getEnd(),
              factory,
              'bind',
            ),
          );
        }

        if (
          ts.isExportAssignment(node) &&
          ts.isExportAssignment(visited) &&
          !node.isExportEquals &&
          isTraceableExpression(node.expression, sourceFile)
        ) {
          return factory.updateExportAssignment(
            visited,
            visited.modifiers,
            traceExpression(
              visited.expression,
              node.expression.getStart(sourceFile),
              node.expression.getEnd(),
              factory,
              'bind',
            ),
          );
        }

        if (
          ts.isCallExpression(node) &&
          ts.isCallExpression(visited) &&
          isTraceableCall(node, sourceFile)
        ) {
          const signature = getParameterSignature(node);
          const call = signature
            ? instrumentCallParameters(
                node,
                visited,
                signature,
                bindings,
                sourceFile,
                factory,
              )
            : visited;

          return traceExpression(
            call,
            node.getStart(sourceFile),
            node.getEnd(),
            factory,
          );
        }

        return visited;
      };

      return ts.visitNode(sourceFile, visit) as ts.SourceFile;
    };
  };
}

function traceExpression(
  expression: ts.Expression,
  start: number,
  end: number,
  factory: ts.NodeFactory,
  method: 'trace' | 'bind' = 'trace',
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('__code3d'),
      method,
    ),
    undefined,
    [
      factory.createNumericLiteral(start),
      factory.createNumericLiteral(end),
      factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        expression,
      ),
    ],
  );
}

function instrumentCallParameters(
  original: ts.CallExpression,
  visited: ts.CallExpression,
  signature: ParameterSignature,
  bindings: ReadonlyMap<string, StaticParameterTarget>,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.CallExpression {
  const argumentsWithTracing = visited.arguments.map((argument, index) => {
    const originalArgument = original.arguments[index];
    const argumentDefinition = signature.arguments[index];
    if (!originalArgument || !argumentDefinition) {
      return argument;
    }

    const targets = collectExpressionTargets(
      originalArgument,
      argumentDefinition,
      bindings,
      sourceFile,
    )
      .map(target => {
        const derivative = derivativeOf(
          originalArgument,
          target,
          sourceFile,
          factory,
        );
        if (!derivative || !isSafeSensitivityExpression(derivative)) {
          return undefined;
        }
        return createRuntimeTarget(target, derivative, factory);
      })
      .filter(
        (target): target is ts.ObjectLiteralExpression => target !== undefined,
      );

    if (targets.length === 0) {
      return argument;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier('__code3d'),
        'parameter',
      ),
      undefined,
      [
        factory.createStringLiteral(signature.operation),
        factory.createStringLiteral(argumentDefinition.name),
        argument,
        factory.createNumericLiteral(original.getStart(sourceFile)),
        factory.createNumericLiteral(original.getEnd()),
        factory.createNumericLiteral(originalArgument.getStart(sourceFile)),
        factory.createNumericLiteral(originalArgument.getEnd()),
        factory.createArrayLiteralExpression(targets),
      ],
    );
  });

  return factory.updateCallExpression(
    visited,
    visited.expression,
    visited.typeArguments,
    argumentsWithTracing,
  );
}

function collectStaticParameterTargets(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, StaticParameterTarget> {
  const targets = new Map<string, StaticParameterTarget>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const metadata = parseCode3dMetadata(statement, sourceFile);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }
      const value = numericExpressionValue(declaration.initializer);
      if (value === undefined) {
        continue;
      }
      const name = declaration.name.text;
      targets.set(name, {
        binding: name,
        sourceRef: {
          start: declaration.initializer.getStart(sourceFile),
          end: declaration.initializer.getEnd(),
        },
        value,
        label: metadata.label ?? humanizeIdentifier(name),
        description: metadata.description,
        kind: metadata.kind,
        unit: metadata.unit,
        min: metadata.min,
        max: metadata.max,
        step: metadata.step,
      });
    }
  }
  return targets;
}

function collectExpressionTargets(
  expression: ts.Expression,
  argument: ParameterArgument,
  bindings: ReadonlyMap<string, StaticParameterTarget>,
  sourceFile: ts.SourceFile,
): readonly StaticParameterTarget[] {
  const targets = new Map<string, StaticParameterTarget>();
  const add = (target: StaticParameterTarget): void => {
    const id = `${target.sourceRef.start}:${target.sourceRef.end}`;
    targets.set(id, {
      ...target,
      kind: target.kind ?? argument.kind,
      unit: target.unit ?? argument.unit,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isValueIdentifier(node)) {
      const binding = bindings.get(node.text);
      if (binding && !isShadowedBinding(node, node.text, sourceFile)) {
        add(binding);
      }
      return;
    }
    const numeric = numericExpressionValue(node);
    if (numeric !== undefined && isStandaloneNumericExpression(node)) {
      add({
        sourceRef: {
          start: node.getStart(sourceFile),
          end: node.getEnd(),
        },
        value: numeric,
        label: argument.label,
        kind: argument.kind,
        unit: argument.unit,
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return [...targets.values()];
}

function derivativeOf(
  expression: ts.Expression,
  target: StaticParameterTarget,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.Expression | undefined {
  if (matchesTarget(expression, target, sourceFile)) {
    return factory.createNumericLiteral(1);
  }
  if (!containsTarget(expression, target, sourceFile)) {
    return factory.createNumericLiteral(0);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return derivativeOf(expression.expression, target, sourceFile, factory);
  }
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return derivativeOf(expression.expression, target, sourceFile, factory);
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    const operand = derivativeOf(
      expression.operand,
      target,
      sourceFile,
      factory,
    );
    if (!operand) {
      return undefined;
    }
    if (expression.operator === ts.SyntaxKind.PlusToken) {
      return operand;
    }
    if (expression.operator === ts.SyntaxKind.MinusToken) {
      return factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        operand,
      );
    }
    return undefined;
  }
  if (!ts.isBinaryExpression(expression)) {
    return undefined;
  }

  const leftDerivative = derivativeOf(
    expression.left,
    target,
    sourceFile,
    factory,
  );
  const rightDerivative = derivativeOf(
    expression.right,
    target,
    sourceFile,
    factory,
  );
  if (!leftDerivative || !rightDerivative) {
    return undefined;
  }
  const left = expression.left;
  const right = expression.right;
  switch (expression.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      return factory.createBinaryExpression(
        leftDerivative,
        ts.SyntaxKind.PlusToken,
        rightDerivative,
      );
    case ts.SyntaxKind.MinusToken:
      return factory.createBinaryExpression(
        leftDerivative,
        ts.SyntaxKind.MinusToken,
        rightDerivative,
      );
    case ts.SyntaxKind.AsteriskToken:
      return factory.createBinaryExpression(
        factory.createBinaryExpression(
          leftDerivative,
          ts.SyntaxKind.AsteriskToken,
          right,
        ),
        ts.SyntaxKind.PlusToken,
        factory.createBinaryExpression(
          left,
          ts.SyntaxKind.AsteriskToken,
          rightDerivative,
        ),
      );
    case ts.SyntaxKind.SlashToken:
      return factory.createBinaryExpression(
        factory.createParenthesizedExpression(
          factory.createBinaryExpression(
            factory.createBinaryExpression(
              leftDerivative,
              ts.SyntaxKind.AsteriskToken,
              right,
            ),
            ts.SyntaxKind.MinusToken,
            factory.createBinaryExpression(
              left,
              ts.SyntaxKind.AsteriskToken,
              rightDerivative,
            ),
          ),
        ),
        ts.SyntaxKind.SlashToken,
        factory.createParenthesizedExpression(
          factory.createBinaryExpression(
            right,
            ts.SyntaxKind.AsteriskToken,
            right,
          ),
        ),
      );
    default:
      return undefined;
  }
}

function containsTarget(
  node: ts.Node,
  target: StaticParameterTarget,
  sourceFile: ts.SourceFile,
): boolean {
  if (matchesTarget(node, target, sourceFile)) {
    return true;
  }
  let contains = false;
  ts.forEachChild(node, child => {
    if (!contains && containsTarget(child, target, sourceFile)) {
      contains = true;
    }
  });
  return contains;
}

function matchesTarget(
  node: ts.Node,
  target: StaticParameterTarget,
  sourceFile: ts.SourceFile,
): boolean {
  if (target.binding && ts.isIdentifier(node)) {
    return (
      node.text === target.binding &&
      isValueIdentifier(node) &&
      !isShadowedBinding(node, target.binding, sourceFile)
    );
  }
  return (
    !target.binding &&
    node.getStart(sourceFile) === target.sourceRef.start &&
    node.getEnd() === target.sourceRef.end
  );
}

function createRuntimeTarget(
  target: StaticParameterTarget,
  sensitivity: ts.Expression,
  factory: ts.NodeFactory,
): ts.ObjectLiteralExpression {
  const targetProperties: ts.ObjectLiteralElementLike[] = [
    property(
      'id',
      factory.createStringLiteral(
        `${target.sourceRef.start}:${target.sourceRef.end}`,
      ),
      factory,
    ),
    property('label', factory.createStringLiteral(target.label), factory),
    property('value', createNumberExpression(target.value, factory), factory),
    property(
      'sourceRef',
      factory.createObjectLiteralExpression([
        property(
          'start',
          factory.createNumericLiteral(target.sourceRef.start),
          factory,
        ),
        property(
          'end',
          factory.createNumericLiteral(target.sourceRef.end),
          factory,
        ),
      ]),
      factory,
    ),
  ];
  addOptionalString(
    targetProperties,
    'description',
    target.description,
    factory,
  );
  addOptionalString(targetProperties, 'kind', target.kind, factory);
  addOptionalString(targetProperties, 'unit', target.unit, factory);
  addOptionalNumber(targetProperties, 'min', target.min, factory);
  addOptionalNumber(targetProperties, 'max', target.max, factory);
  addOptionalNumber(targetProperties, 'step', target.step, factory);

  return factory.createObjectLiteralExpression([
    property(
      'target',
      factory.createObjectLiteralExpression(targetProperties),
      factory,
    ),
    property('sensitivity', sensitivity, factory),
  ]);
}

function property(
  name: string,
  initializer: ts.Expression,
  factory: ts.NodeFactory,
): ts.PropertyAssignment {
  return factory.createPropertyAssignment(name, initializer);
}

function addOptionalString(
  properties: ts.ObjectLiteralElementLike[],
  name: string,
  value: string | undefined,
  factory: ts.NodeFactory,
): void {
  if (value !== undefined) {
    properties.push(
      property(name, factory.createStringLiteral(value), factory),
    );
  }
}

function addOptionalNumber(
  properties: ts.ObjectLiteralElementLike[],
  name: string,
  value: number | undefined,
  factory: ts.NodeFactory,
): void {
  if (value !== undefined) {
    properties.push(
      property(name, createNumberExpression(value, factory), factory),
    );
  }
}

function createNumberExpression(
  value: number,
  factory: ts.NodeFactory,
): ts.Expression {
  if (value < 0) {
    return factory.createPrefixUnaryExpression(
      ts.SyntaxKind.MinusToken,
      factory.createNumericLiteral(Math.abs(value)),
    );
  }
  return factory.createNumericLiteral(Object.is(value, -0) ? 0 : value);
}

function getParameterSignature(
  node: ts.CallExpression,
): ParameterSignature | undefined {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return signatures.get(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return signatures.get(expression.name.text);
  }
  return undefined;
}

function parseCode3dMetadata(
  statement: ts.VariableStatement,
  sourceFile: ts.SourceFile,
): Partial<StaticParameterTarget> {
  const comments =
    ts.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()) ?? [];
  const text = comments
    .map(({pos, end}) => sourceFile.text.slice(pos, end))
    .join('\n');
  const metadata: Partial<StaticParameterTarget> = {};
  const pattern =
    /@code3d\.(label|description|kind|unit|min|max|step)\s+([^\r\n*]+)/g;
  for (const match of text.matchAll(pattern)) {
    const key = match[1];
    const value = match[2].trim();
    if (key === 'label' || key === 'description' || key === 'unit') {
      metadata[key] = value;
    } else if (key === 'kind' && isParameterKind(value)) {
      metadata.kind = value;
    } else if (key === 'min' || key === 'max' || key === 'step') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        metadata[key] = numeric;
      }
    }
  }
  return metadata;
}

function numericExpressionValue(node: ts.Node): number | undefined {
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    return Number.isFinite(value) ? value : undefined;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.PlusToken ||
      node.operator === ts.SyntaxKind.MinusToken) &&
    ts.isNumericLiteral(node.operand)
  ) {
    const value = Number(node.getText());
    return Number.isFinite(value) ? value : undefined;
  }
  if (ts.isParenthesizedExpression(node)) {
    return numericExpressionValue(node.expression);
  }
  return undefined;
}

function isStandaloneNumericExpression(node: ts.Node): node is ts.Expression {
  if (ts.isNumericLiteral(node)) {
    return !(
      ts.isPrefixUnaryExpression(node.parent) &&
      (node.parent.operator === ts.SyntaxKind.PlusToken ||
        node.parent.operator === ts.SyntaxKind.MinusToken)
    );
  }
  return (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.PlusToken ||
      node.operator === ts.SyntaxKind.MinusToken) &&
    ts.isNumericLiteral(node.operand)
  );
}

function isSafeSensitivityExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression) || ts.isNumericLiteral(expression)) {
    return true;
  }
  if (ts.isParenthesizedExpression(expression)) {
    return isSafeSensitivityExpression(expression.expression);
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    return isSafeSensitivityExpression(expression.operand);
  }
  if (ts.isBinaryExpression(expression)) {
    return (
      isSafeSensitivityExpression(expression.left) &&
      isSafeSensitivityExpression(expression.right)
    );
  }
  return false;
}

function isValueIdentifier(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    return false;
  }
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent)) &&
    parent.name === identifier
  ) {
    return ts.isShorthandPropertyAssignment(parent);
  }
  return !(ts.isVariableDeclaration(parent) && parent.name === identifier);
}

function isShadowedBinding(
  identifier: ts.Identifier,
  binding: string,
  sourceFile: ts.SourceFile,
): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current && current !== sourceFile) {
    if (
      ts.isFunctionLike(current) &&
      current.parameters.some(parameter =>
        bindingNameContains(parameter.name, binding),
      )
    ) {
      return true;
    }
    if (
      ts.isCatchClause(current) &&
      current.variableDeclaration &&
      bindingNameContains(current.variableDeclaration.name, binding)
    ) {
      return true;
    }
    if (
      ts.isBlock(current) &&
      current.statements.some(statement =>
        statementDeclares(statement, binding),
      )
    ) {
      return true;
    }
    if (
      (ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current)) &&
      current.initializer &&
      ts.isVariableDeclarationList(current.initializer) &&
      current.initializer.declarations.some(declaration =>
        bindingNameContains(declaration.name, binding),
      )
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function statementDeclares(statement: ts.Statement, binding: string): boolean {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(declaration =>
      bindingNameContains(declaration.name, binding),
    );
  }
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name?.text === binding
  ) {
    return true;
  }
  return false;
}

function bindingNameContains(name: ts.BindingName, binding: string): boolean {
  if (ts.isIdentifier(name)) {
    return name.text === binding;
  }
  return name.elements.some(
    element =>
      !ts.isOmittedExpression(element) &&
      bindingNameContains(element.name, binding),
  );
}

function isTraceableCall(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return (
    ts.isCallExpression(node) &&
    node.expression.kind !== ts.SyntaxKind.SuperKeyword &&
    isTraceableExpression(node, sourceFile)
  );
}

function isTraceableExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): boolean {
  if (
    ts.isAwaitExpression(node) ||
    node.kind === ts.SyntaxKind.YieldExpression
  ) {
    return false;
  }
  let traceable = true;
  const inspect = (child: ts.Node): void => {
    if (
      ts.isAwaitExpression(child) ||
      child.kind === ts.SyntaxKind.YieldExpression
    ) {
      traceable = false;
      return;
    }
    ts.forEachChild(child, inspect);
  };
  ts.forEachChild(node, inspect);

  return traceable && node.getStart(sourceFile) >= 0;
}

function countParameterImpacts(
  root: ModelSnapshotObject,
): ReadonlyMap<string, number> {
  const impacts = new Map<string, number>();
  const visit = (node: ModelSnapshotObject): void => {
    const targets = new Set(
      node.parameters.map(parameter => parameter.target.id),
    );
    for (const target of targets) {
      impacts.set(target, (impacts.get(target) ?? 0) + 1);
    }
    node.children.forEach(visit);
  };
  visit(root);
  return impacts;
}

function humanizeIdentifier(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, character => character.toUpperCase());
}

function isParameterKind(value: string): value is ParameterKind {
  return ['length', 'angle', 'ratio', 'count', 'scalar'].includes(value);
}

function diagnosticFailure(diagnostic: ts.Diagnostic): CompileFailure {
  return new CompileFailure(
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    diagnostic.start,
    diagnostic.length,
  );
}
