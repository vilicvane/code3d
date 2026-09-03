import ts from '@typescript/typescript6';
import {
  normalizeProjectPath,
  resolveProjectImport,
  type ModelProject,
} from '../project/project';
import {
  authoringApi,
  disposeModelObjects,
  isConstraint,
  isModelObject,
  modelElementReference,
  type Constraint,
  type ElementKind,
  type ModelOperationInputRole,
  type ModelOperationKind,
  type ModelOperationSnapshot,
  type ModelSnapshotObject,
  type ModelObject,
  type ParameterKind,
  type ParameterTarget,
  type ParameterUsage,
  type SourceRef,
} from './runtime';
import {code3dAnnotations} from './annotations';
import {designArgumentAnnotationSites} from './design-functions';
import {
  createModelDiagnostic,
  locateModelError,
  ModelDiagnosticError,
  type ModelDiagnosticKind,
} from './diagnostic';

export type SourceTargetEvaluation = Readonly<{
  nodeIds: readonly string[];
  operationId?: string;
  constraintId?: string;
  constraintSourceNodeId?: string;
  contextId: string;
  element?: Readonly<{
    nodeId: string;
    name: string;
    kind: ElementKind;
  }>;
}>;

export type SourceTarget = Readonly<{
  id: string;
  kind:
    'value' | 'constraint' | 'element' | 'operation-input' | 'operation-output';
  sourceRef: SourceRef;
  receiverRef?: SourceRef;
  functionId?: string;
  evaluations: readonly SourceTargetEvaluation[];
  contextTargetIds: readonly string[];
  operation?: Readonly<{
    kind: ModelOperationKind;
    role?: ModelOperationInputRole;
  }>;
}>;

export type EvaluationContext = Readonly<{
  id: string;
  kind: 'call' | 'design';
  label: string;
  sourceRef: SourceRef;
}>;

export type DesignArgumentContext = Readonly<{
  id: string;
  functionId: string;
  functionName: string;
  label: string;
  functionRef: SourceRef;
  annotationRef: SourceRef;
  argumentsRef: SourceRef;
  signature: Readonly<{
    typeParametersSource: string;
    parametersSource: string;
  }>;
}>;

export type ObjectCatalogOccurrence = Readonly<{
  id: string;
  nodeId: string;
  label: string;
  sourceRef: SourceRef;
  execution: number;
  output: number;
  order: number;
}>;

export type ObjectCatalogEntry = Readonly<{
  id: string;
  label: string;
  category: 'binding' | 'export' | 'expression';
  scope: 'module' | 'local';
  visibility: 'primary' | 'lineage';
  sourceRef: SourceRef;
  nodeIds: readonly string[];
  occurrences: readonly ObjectCatalogOccurrence[];
  executions: number;
  firstOrder: number;
  lastOrder: number;
  exportNames: readonly string[];
}>;

export type ModelModule = Readonly<{
  fallback?: ModelSnapshotObject;
  objects: ReadonlyMap<string, ModelSnapshotObject>;
  operations: ReadonlyMap<string, ModelOperationSnapshot>;
  exports: ReadonlyMap<string, string>;
  catalog: readonly ObjectCatalogEntry[];
  parameterImpacts: ReadonlyMap<string, number>;
  sourceTargets: readonly SourceTarget[];
  evaluationContexts: readonly EvaluationContext[];
  designArguments: readonly DesignArgumentContext[];
  activeDesignContextId?: string;
}>;

type CommonJsModule = {
  exports: Record<string, unknown>;
};

type RuntimeParameterTarget = Readonly<{
  target: ParameterTarget;
  sensitivity: number;
}>;

type StaticParameterTarget = {
  binding?: string;
  sourceRef: SourceRef;
  value: number;
  label: string;
  description?: string;
  kind?: ParameterKind;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
};

type ParsedDesignArgumentContext = DesignArgumentContext &
  Readonly<{
    binding: string;
    argumentsSource: string;
  }>;

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

type CatalogTrace = {
  id: string;
  label: string;
  category: ObjectCatalogEntry['category'];
  scope: ObjectCatalogEntry['scope'];
  sourceRef: SourceRef;
  objects: Set<ModelObject>;
  runs: Array<
    Readonly<{
      order: number;
      objects: readonly ModelObject[];
    }>
  >;
};

type SourceValueTrace = {
  id: string;
  kind: 'value' | 'operation-output';
  sourceRef: SourceRef;
  evaluations: Array<
    Readonly<{objects: readonly ModelObject[]; contextId: string}>
  >;
};

type SourceInputTrace = Readonly<{
  siteId: string;
  execution: number;
  sourceRef: SourceRef;
  role: ModelOperationInputRole;
  index: number;
  objects: readonly ModelObject[];
  contextId: string;
}>;

type SourceConstraintTrace = {
  id: string;
  sourceRef: SourceRef;
  evaluations: Array<
    Readonly<{
      constraintId: string;
      source: ModelObject;
      target: ModelObject;
      contextId: string;
    }>
  >;
};

type SourceElementTrace = {
  id: string;
  sourceRef: SourceRef;
  receiverRef: SourceRef;
  evaluations: Array<
    Readonly<{
      model: ModelObject;
      name: string;
      kind: ElementKind;
      contextId: string;
    }>
  >;
};

type TraceFrame = Readonly<{
  siteId: string;
  execution: number;
  contextId: string;
}>;

const signatures = new Map<string, ParameterSignature>([
  [
    'box',
    {
      operation: 'box',
      arguments: [
        {name: 'width', label: 'Width', kind: 'length'},
        {name: 'height', label: 'Height', kind: 'length'},
        {name: 'depth', label: 'Depth', kind: 'length'},
      ],
    },
  ],
  [
    'cylinder',
    {
      operation: 'cylinder',
      arguments: [
        {name: 'radius', label: 'Radius', kind: 'length'},
        {name: 'height', label: 'Height', kind: 'length'},
      ],
    },
  ],
  [
    'sphere',
    {
      operation: 'sphere',
      arguments: [{name: 'radius', label: 'Radius', kind: 'length'}],
    },
  ],
  [
    'frustum',
    {
      operation: 'frustum',
      arguments: [
        {name: 'bottomRadius', label: 'Bottom radius', kind: 'length'},
        {name: 'topRadius', label: 'Top radius', kind: 'length'},
        {name: 'height', label: 'Height', kind: 'length'},
      ],
    },
  ],
  [
    'regularPrism',
    {
      operation: 'regularPrism',
      arguments: [
        {name: 'radius', label: 'Radius', kind: 'length'},
        {name: 'height', label: 'Height', kind: 'length'},
        {name: 'sides', label: 'Sides', kind: 'count'},
        {name: 'rotation', label: 'Rotation', kind: 'angle', unit: 'deg'},
      ],
    },
  ],
  [
    'offset',
    {
      operation: 'offset',
      arguments: [
        {name: 'x', label: 'ΔX', kind: 'length'},
        {name: 'y', label: 'ΔY', kind: 'length'},
        {name: 'z', label: 'ΔZ', kind: 'length'},
      ],
    },
  ],
  [
    'scaled',
    {
      operation: 'scaled',
      arguments: [{name: 'factor', label: 'Scale', kind: 'ratio'}],
    },
  ],
  [
    'fillet',
    {
      operation: 'fillet',
      arguments: [{name: 'radius', label: 'Fillet radius', kind: 'length'}],
    },
  ],
  [
    'chamfer',
    {
      operation: 'chamfer',
      arguments: [
        {name: 'distance', label: 'Chamfer distance', kind: 'length'},
      ],
    },
  ],
]);

const tracedObjects = new Set<ModelObject>();
const sourceValueTraces = new Map<string, SourceValueTrace>();
const sourceInputTraces: SourceInputTrace[] = [];
const sourceConstraintTraces = new Map<string, SourceConstraintTrace>();
const sourceElementTraces = new Map<string, SourceElementTrace>();
const catalogTraces = new Map<string, CatalogTrace>();
const parameterFrames: ParameterUsage[][] = [];
const traceFrames: TraceFrame[] = [];
const traceExecutions = new Map<string, number>();
const evaluationContexts = new Map<string, EvaluationContext>();
const designContextFrames: EvaluationContext[] = [];
const designRootObjects = new Set<ModelObject>();
let latestTracedObject: ModelObject | undefined;
let evaluationOrder = 0;
const traceRuntime = Object.freeze({
  trace<T>(
    file: string,
    start: number,
    end: number,
    id: string,
    label: string,
    run: () => T,
  ): T {
    const execution = traceExecutions.get(id) ?? 0;
    traceExecutions.set(id, execution + 1);
    const location = sourceRef(file, start, end);
    const context =
      currentEvaluationContext() ??
      callEvaluationContext(id, execution, label, location);
    const parameters: ParameterUsage[] = [];
    parameterFrames.push(parameters);
    traceFrames.push({siteId: id, execution, contextId: context.id});
    let result: T;
    try {
      result = run();
    } catch (error) {
      throw locateModelError(error, location);
    } finally {
      traceFrames.pop();
      parameterFrames.pop();
    }
    if (isConstraint(result)) {
      result.attachSource(location);
      result.attachParameters(parameters);
      recordSourceConstraint(id, location, result, context.id);
    } else if (isModelObject(result)) {
      const order = ++evaluationOrder;
      result.attachSource(location);
      result.attachParameters(parameters);
      result.attachOperationTrace(id, execution, order, location);
      recordSourceValue(id, 'operation-output', location, result, context.id);
      if (context.kind === 'call') {
        recordCatalogValue(
          {
            id,
            label,
            category: 'expression',
            scope: 'local',
            sourceRef: location,
          },
          result,
          order,
        );
      }
      return result;
    } else {
      recordSourceValue(id, 'value', location, result, context.id);
    }
    const order = ++evaluationOrder;
    if (context.kind === 'call') {
      recordCatalogValue(
        {
          id,
          label,
          category: 'expression',
          scope: 'local',
          sourceRef: location,
        },
        result,
        order,
      );
    }
    return result;
  },

  bind<T>(
    file: string,
    start: number,
    end: number,
    id: string,
    label: string,
    category: ObjectCatalogEntry['category'],
    scope: ObjectCatalogEntry['scope'],
    run: () => T,
  ): T {
    const location = sourceRef(file, start, end);
    const context =
      currentEvaluationContext() ??
      callEvaluationContext(
        id,
        nextTraceExecution(`binding:${id}`),
        label,
        location,
      );
    let result: T;
    try {
      result = run();
    } catch (error) {
      throw locateModelError(error, location);
    }
    if (isConstraint(result)) {
      recordSourceConstraint(id, location, result, context.id);
    } else {
      recordSourceValue(id, 'value', location, result, context.id);
    }
    const order = ++evaluationOrder;
    if (context.kind === 'call') {
      recordCatalogValue(
        {id, label, category, scope, sourceRef: location},
        result,
        order,
      );
    }
    return result;
  },

  design<T>(
    file: string,
    functionStart: number,
    functionEnd: number,
    annotationStart: number,
    annotationEnd: number,
    id: string,
    functionId: string,
    label: string,
    run: () => T,
  ): T {
    const context: EvaluationContext = {
      id,
      kind: 'design',
      label,
      sourceRef: sourceRef(file, annotationStart, annotationEnd),
    };
    evaluationContexts.set(id, context);
    designContextFrames.push(context);
    let result: T;
    try {
      result = run();
    } catch (error) {
      throw locateModelError(
        error,
        sourceRef(file, annotationStart, annotationEnd),
      );
    } finally {
      designContextFrames.pop();
    }
    modelObjectsIn(result).forEach(object => designRootObjects.add(object));
    recordSourceValue(
      `${functionId}:result`,
      'value',
      sourceRef(file, functionStart, functionEnd),
      result,
      id,
    );
    return result;
  },

  input<T>(
    file: string,
    start: number,
    end: number,
    siteId: string,
    role: ModelOperationInputRole,
    index: number,
    value: T,
  ): T {
    const frame = traceFrames.at(-1);
    if (frame?.siteId !== siteId) {
      return value;
    }
    const objects = modelObjectsIn(value);
    if (objects.length > 0) {
      objects.forEach(object => tracedObjects.add(object));
      sourceInputTraces.push({
        siteId,
        execution: frame.execution,
        sourceRef: sourceRef(file, start, end),
        role,
        index,
        objects,
        contextId: frame.contextId,
      });
    }
    return value;
  },

  element<T>(
    file: string,
    start: number,
    end: number,
    receiverStart: number,
    receiverEnd: number,
    id: string,
    value: T,
  ): T {
    const reference = modelElementReference(value);
    if (!reference) return value;
    const location = sourceRef(file, start, end);
    const receiver = sourceRef(file, receiverStart, receiverEnd);
    const context =
      currentEvaluationContext() ??
      callEvaluationContext(
        id,
        nextTraceExecution(`element:${id}`),
        reference.name,
        location,
      );
    const key = `${id}:${location.file}:${location.start}:${location.end}`;
    const trace = sourceElementTraces.get(key) ?? {
      id,
      sourceRef: location,
      receiverRef: receiver,
      evaluations: [],
    };
    trace.evaluations.push({...reference, contextId: context.id});
    sourceElementTraces.set(key, trace);
    tracedObjects.add(reference.model);
    return value;
  },

  parameter(
    file: string,
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
          operationRef: sourceRef(file, operationStart, operationEnd),
          expressionRef: sourceRef(file, expressionStart, expressionEnd),
          target,
          sensitivity,
        });
      }
    }
    return value;
  },
});

function currentEvaluationContext(): EvaluationContext | undefined {
  const design = designContextFrames.at(-1);
  if (design) return design;
  const contextId = traceFrames[0]?.contextId;
  return contextId ? evaluationContexts.get(contextId) : undefined;
}

function callEvaluationContext(
  siteId: string,
  execution: number,
  label: string,
  sourceRef: SourceRef,
): EvaluationContext {
  const id = `${siteId}:context:${execution}`;
  const context = {id, kind: 'call', label, sourceRef} as const;
  evaluationContexts.set(id, context);
  return context;
}

function nextTraceExecution(id: string): number {
  const execution = traceExecutions.get(id) ?? 0;
  traceExecutions.set(id, execution + 1);
  return execution;
}

function recordSourceValue(
  id: string,
  kind: SourceValueTrace['kind'],
  sourceRef: SourceRef,
  value: unknown,
  contextId: string,
): void {
  const objects = modelObjectsIn(value);
  if (objects.length === 0) {
    return;
  }
  const key = `${kind}:${id}:${sourceRef.file}:${sourceRef.start}:${sourceRef.end}`;
  const sourceTrace = sourceValueTraces.get(key) ?? {
    id,
    kind,
    sourceRef,
    evaluations: [],
  };
  sourceTrace.evaluations.push({objects, contextId});
  objects.forEach(object => {
    tracedObjects.add(object);
    if (evaluationContexts.get(contextId)?.kind === 'call') {
      latestTracedObject = object;
    }
  });
  sourceValueTraces.set(key, sourceTrace);
}

function recordSourceConstraint(
  id: string,
  location: SourceRef,
  constraint: Constraint,
  contextId: string,
): void {
  const reference = constraint.traceReference();
  const key = `${id}:${location.file}:${location.start}:${location.end}`;
  const trace = sourceConstraintTraces.get(key) ?? {
    id,
    sourceRef: location,
    evaluations: [],
  };
  trace.evaluations.push({...reference, contextId});
  sourceConstraintTraces.set(key, trace);
  tracedObjects.add(reference.source);
  tracedObjects.add(reference.target);
}

function recordCatalogValue(
  metadata: Readonly<
    Pick<CatalogTrace, 'id' | 'label' | 'category' | 'scope' | 'sourceRef'>
  >,
  value: unknown,
  order: number,
): void {
  const objects = modelObjectsIn(value);
  if (objects.length === 0) {
    return;
  }
  const trace = catalogTraces.get(metadata.id) ?? {
    ...metadata,
    objects: new Set<ModelObject>(),
    runs: [],
  };
  objects.forEach(object => trace.objects.add(object));
  trace.runs.push({order, objects});
  catalogTraces.set(metadata.id, trace);
}

function modelObjectsIn(
  value: unknown,
  seen = new Set<unknown>(),
): ModelObject[] {
  if (isModelObject(value)) {
    return [value];
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return [];
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap(item => modelObjectsIn(item, seen));
  }
  if (value instanceof Map) {
    return [...value.values()].flatMap(item => modelObjectsIn(item, seen));
  }
  if (value instanceof Set) {
    return [...value].flatMap(item => modelObjectsIn(item, seen));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    return Object.values(value).flatMap(item => modelObjectsIn(item, seen));
  }
  return [];
}

function parseDesignArgumentContexts(
  path: string,
  source: string,
): ParsedDesignArgumentContext[] {
  const normalizedPath = normalizeProjectPath(path);
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const contexts: ParsedDesignArgumentContext[] = [];
  const consumedAnnotations = new Set<number>();

  for (const {
    annotation,
    designFunction,
    signature,
    index,
  } of designArgumentAnnotationSites(source, sourceFile)) {
    const functionId = `${normalizedPath}:function:${designFunction.name}`;
    consumedAnnotations.add(annotation.start);
    const argumentsRef = sourceRef(
      normalizedPath,
      annotation.valueStart,
      annotation.valueEnd,
    );
    const argumentsExpression = parseDesignArgumentsExpression(
      annotation.value,
      argumentsRef,
    );
    validateDesignArgumentCount(
      argumentsExpression,
      signature.parameters,
      argumentsRef,
    );
    contexts.push({
      id: `${functionId}:arguments:${index}`,
      functionId,
      functionName: designFunction.name,
      label: designArgumentsLabel(annotation.value),
      functionRef: sourceRef(
        normalizedPath,
        designFunction.signatures[0].statement.getFullStart(),
        designFunction.node.getEnd(),
      ),
      annotationRef: sourceRef(
        normalizedPath,
        annotation.start,
        annotation.valueEnd,
      ),
      argumentsRef,
      signature: {
        typeParametersSource:
          signature.typeParameters.length === 0
            ? ''
            : `<${signature.typeParameters
                .map(parameter => parameter.getText(sourceFile))
                .join(', ')}>`,
        parametersSource: signature.parameters
          .map(parameter => parameter.getText(sourceFile))
          .join(', '),
      },
      binding: designFunction.name,
      argumentsSource: annotation.value,
    });
  }

  const misplaced = code3dAnnotations(source).find(
    annotation =>
      annotation.name === 'arguments' &&
      !consumedAnnotations.has(annotation.start),
  );
  if (misplaced) {
    throw modelFailure(
      'syntax',
      '@code3d.arguments must annotate a named module-level function.',
      sourceRef(normalizedPath, misplaced.start, misplaced.end),
    );
  }
  return contexts;
}

function parseDesignArgumentsExpression(
  source: string,
  sourceRef: SourceRef,
): ts.ArrayLiteralExpression {
  const prefix = 'const __code3dArguments = (';
  const parsed = ts.createSourceFile(
    sourceRef.file,
    `${prefix}${source});`,
    ts.ScriptTarget.Latest,
    true,
  );
  const parseDiagnostics = (
    parsed as ts.SourceFile & {parseDiagnostics: readonly ts.Diagnostic[]}
  ).parseDiagnostics;
  const error = parseDiagnostics.find(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (error) {
    const relativeStart = Math.max(
      0,
      (error.start ?? prefix.length) - prefix.length,
    );
    throw modelFailure(
      'syntax',
      ts.flattenDiagnosticMessageText(error.messageText, '\n'),
      {
        file: sourceRef.file,
        start: sourceRef.start + relativeStart,
        end: sourceRef.start + relativeStart + (error.length ?? 1),
      },
    );
  }
  const statement = parsed.statements[0];
  const declaration =
    statement && ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]
      : undefined;
  const expression = declaration?.initializer;
  const argumentsExpression =
    expression && ts.isParenthesizedExpression(expression)
      ? expression.expression
      : expression;
  if (
    !argumentsExpression ||
    !ts.isArrayLiteralExpression(argumentsExpression)
  ) {
    throw modelFailure(
      'syntax',
      '@code3d.arguments requires an array expression.',
      sourceRef,
    );
  }
  return argumentsExpression;
}

function validateDesignArgumentCount(
  argumentsExpression: ts.ArrayLiteralExpression,
  parameters: readonly ts.ParameterDeclaration[],
  sourceRef: SourceRef,
): void {
  if (
    argumentsExpression.elements.some(ts.isSpreadElement) ||
    parameters.some(parameter => parameter.dotDotDotToken)
  ) {
    return;
  }
  const required = parameters.filter(
    parameter => !parameter.questionToken && !parameter.initializer,
  ).length;
  const count = argumentsExpression.elements.length;
  if (required <= count && count <= parameters.length) return;
  const expected =
    required === parameters.length
      ? String(required)
      : `${required}–${parameters.length}`;
  throw modelFailure(
    'evaluation',
    `@code3d.arguments provides ${count} arguments; ${expected} expected.`,
    sourceRef,
  );
}

function designArgumentsLabel(source: string): string {
  const trimmed = source.trim();
  return trimmed.slice(1, -1).trim() || 'no arguments';
}

export function compileProject(
  project: ModelProject,
  requestedDesignContextId?: string,
): ModelModule {
  const files = new Map(
    project.files.map(file => [normalizeProjectPath(file.path), file.source]),
  );
  const designArguments = [...files].flatMap(([path, source]) =>
    parseDesignArgumentContexts(path, source),
  );
  const activeDesignContext = designArguments.find(
    context => context.id === requestedDesignContextId,
  );
  const entryPath = resolveModuleFile(
    normalizeProjectPath(project.entryPath),
    files,
  );
  if (!entryPath) {
    throw modelFailure(
      'project',
      `Project entry not found: ${project.entryPath}`,
    );
  }

  tracedObjects.clear();
  sourceValueTraces.clear();
  sourceInputTraces.length = 0;
  sourceConstraintTraces.clear();
  sourceElementTraces.clear();
  catalogTraces.clear();
  parameterFrames.length = 0;
  traceFrames.length = 0;
  traceExecutions.clear();
  evaluationContexts.clear();
  designContextFrames.length = 0;
  designRootObjects.clear();
  latestTracedObject = undefined;
  evaluationOrder = 0;
  try {
    const modules = new Map<string, CommonJsModule>();
    const executeModule = (path: string): CommonJsModule => {
      const normalized = normalizeProjectPath(path);
      const cached = modules.get(normalized);
      if (cached) {
        return cached;
      }
      const source = files.get(normalized);
      if (source === undefined) {
        throw modelFailure('project', `Project file not found: ${normalized}`);
      }
      const module: CommonJsModule = {exports: {}};
      modules.set(normalized, module);
      const result = transpileSource(
        normalized,
        source,
        activeDesignContext?.functionRef.file === normalized
          ? activeDesignContext
          : undefined,
      );
      const execute = new Function(
        'require',
        'module',
        'exports',
        '__code3d',
        `"use strict";\n${result}\n//# sourceURL=code3d:${normalized}`,
      );
      const sourceFile = ts.createSourceFile(
        normalized,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const requireModule = (specifier: string): unknown => {
        const importRef = moduleSpecifierSourceRef(sourceFile, specifier);
        if (specifier === 'code3d') {
          return authoringApi;
        }
        if (!specifier.startsWith('.')) {
          throw modelFailure(
            'module',
            `Unsupported module import: ${specifier}`,
            importRef,
          );
        }
        const candidate = resolveProjectImport(normalized, specifier);
        const resolved = resolveModuleFile(candidate, files);
        if (!resolved) {
          throw modelFailure(
            'module',
            `Could not resolve ${specifier} from ${normalized}`,
            importRef,
          );
        }
        return executeModule(resolved).exports;
      };
      execute(requireModule, module, module.exports, traceRuntime);
      return module;
    };

    executeModule(entryPath);
    if (
      activeDesignContext &&
      !modules.has(activeDesignContext.functionRef.file)
    ) {
      executeModule(activeDesignContext.functionRef.file);
    }

    const modelExports = new Map<string, ModelObject>();
    const exportNamesByObject = new Map<ModelObject, Set<string>>();
    for (const [modulePath, module] of modules) {
      for (const [name, value] of Object.entries(module.exports)) {
        const exportLabel =
          modulePath === entryPath ? name : `${modulePath}:${name}`;
        if (modulePath === entryPath && isModelObject(value)) {
          modelExports.set(name, value);
        }
        for (const object of modelObjectsIn(value)) {
          tracedObjects.add(object);
          const names = exportNamesByObject.get(object) ?? new Set<string>();
          names.add(exportLabel);
          exportNamesByObject.set(object, names);
        }
      }
    }
    const fallbackObject =
      modelExports.get('default') ??
      [...modelExports.values()].at(-1) ??
      latestTracedObject;
    if (!fallbackObject && designArguments.length === 0) {
      throw new Error(
        'The current program did not produce a renderable ModelObject.',
      );
    }

    const meshCache = new Map();
    const snapshots = new Map<ModelObject, ModelSnapshotObject>();
    const snapshotOf = (object: ModelObject): ModelSnapshotObject => {
      const existing = snapshots.get(object);
      if (existing) return existing;
      let snapshot: ModelSnapshotObject;
      try {
        snapshot = object.toSnapshot(meshCache);
      } catch (error) {
        const location = object.sourceRefs.at(-1);
        if (!location) throw error;
        throw locateModelError(error, location);
      }
      snapshots.set(object, snapshot);
      return snapshot;
    };
    const fallbackSnapshot = fallbackObject
      ? snapshotOf(fallbackObject)
      : undefined;
    const graphObjects = collectObjectGraph(tracedObjects);
    graphObjects.forEach(object => tracedObjects.add(object));
    const objectSnapshots = new Map(
      graphObjects.map(object => [object.nodeId, snapshotOf(object)]),
    );
    const operations = new Map(
      [...objectSnapshots.values()].map(object => [
        object.operation.id,
        object.operation,
      ]),
    );
    return {
      fallback: fallbackSnapshot,
      objects: objectSnapshots,
      operations,
      exports: new Map(
        [...modelExports].map(([name, modelObject]) => [
          name,
          modelObject.nodeId,
        ]),
      ),
      catalog: [...catalogTraces.values()]
        .sort((left, right) => left.runs[0].order - right.runs[0].order)
        .map(trace => {
          const occurrences = trace.runs.flatMap((run, execution) =>
            run.objects.map((object, output) => ({
              id: `${trace.id}:execution:${execution}:output:${output}`,
              nodeId: object.nodeId,
              label: object.name,
              sourceRef: object.sourceRefs.at(-1) ?? trace.sourceRef,
              execution,
              output,
              order: run.order,
            })),
          );
          return {
            id: trace.id,
            label: trace.label,
            category: trace.category,
            scope: trace.scope,
            visibility:
              trace.category === 'expression' || trace.scope === 'local'
                ? 'lineage'
                : 'primary',
            sourceRef: trace.sourceRef,
            nodeIds: [...trace.objects].map(object => object.nodeId),
            occurrences,
            executions: trace.runs.length,
            firstOrder: trace.runs[0].order,
            lastOrder: trace.runs.at(-1)?.order ?? trace.runs[0].order,
            exportNames: [
              ...new Set(
                [...trace.objects].flatMap(object => [
                  ...(exportNamesByObject.get(object) ?? []),
                ]),
              ),
            ],
          };
        }),
      parameterImpacts: countParameterImpacts(
        fallbackSnapshot
          ? [fallbackSnapshot]
          : [...designRootObjects].map(snapshotOf),
      ),
      sourceTargets: buildSourceTargets(operations, designArguments),
      evaluationContexts: [...evaluationContexts.values()],
      designArguments: designArguments.map(
        ({binding: _binding, argumentsSource: _argumentsSource, ...context}) =>
          context,
      ),
      activeDesignContextId: activeDesignContext?.id,
    };
  } finally {
    disposeModelObjects(tracedObjects);
    tracedObjects.clear();
    sourceValueTraces.clear();
    sourceInputTraces.length = 0;
    sourceConstraintTraces.clear();
    sourceElementTraces.clear();
    catalogTraces.clear();
    parameterFrames.length = 0;
    traceFrames.length = 0;
    traceExecutions.clear();
    evaluationContexts.clear();
    designContextFrames.length = 0;
    designRootObjects.clear();
    latestTracedObject = undefined;
    evaluationOrder = 0;
  }
}

function transpileSource(
  path: string,
  source: string,
  designContext?: ParsedDesignArgumentContext,
): string {
  const executableSource = designContext
    ? `${source}\n${designEvaluationSource(designContext)}\n`
    : source;
  const result = ts.transpileModule(executableSource, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      isolatedModules: true,
    },
    reportDiagnostics: true,
    transformers: {before: [createTraceTransformer(source.length)]},
  });
  const error = (result.diagnostics ?? []).find(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (error) {
    throw diagnosticFailure(error, path);
  }
  return result.outputText;
}

function designEvaluationSource(context: ParsedDesignArgumentContext): string {
  return `__code3d.design(${JSON.stringify(context.functionRef.file)}, ${context.functionRef.start}, ${context.functionRef.end}, ${context.annotationRef.start}, ${context.annotationRef.end}, ${JSON.stringify(context.id)}, ${JSON.stringify(context.functionId)}, ${JSON.stringify(context.label)}, () => ${context.binding}(...(${context.argumentsSource})));`;
}

function resolveModuleFile(
  candidate: string,
  files: ReadonlyMap<string, string>,
): string | undefined {
  const normalized = normalizeProjectPath(candidate);
  const extension = /\.[^/]+$/.test(normalized);
  const sourceExtensions = [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
  ];
  const candidates = extension
    ? [normalized]
    : [
        normalized,
        ...sourceExtensions.map(suffix => normalized + suffix),
        ...sourceExtensions.map(suffix => `${normalized}/index${suffix}`),
      ];
  return candidates.find(path => files.has(path));
}

function moduleSpecifierSourceRef(
  sourceFile: ts.SourceFile,
  specifier: string,
): SourceRef | undefined {
  let match: ts.StringLiteralLike | undefined;
  const visit = (node: ts.Node): void => {
    if (match) return;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === specifier
    ) {
      match = node.moduleSpecifier;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === specifier
    ) {
      match = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return match
    ? sourceRef(sourceFile.fileName, match.getStart(sourceFile), match.getEnd())
    : undefined;
}

function collectObjectGraph(roots: Iterable<ModelObject>): ModelObject[] {
  const found = new Set<ModelObject>();
  const visit = (object: ModelObject): void => {
    if (found.has(object)) {
      return;
    }
    found.add(object);
    object.relatedObjects().forEach(visit);
  };
  for (const root of roots) {
    visit(root);
  }
  return [...found];
}

function buildSourceTargets(
  operations: ReadonlyMap<string, ModelOperationSnapshot>,
  designArguments: readonly ParsedDesignArgumentContext[],
): SourceTarget[] {
  const valueTargets = [...sourceValueTraces.values()].map(trace => {
    const evaluations = trace.evaluations.map(({objects, contextId}) => {
      const nodeIds = objects.map(object => object.nodeId);
      const operationId = [...operations.values()].find(
        operation =>
          operation.siteId === trace.id &&
          nodeIds.includes(operation.outputNodeId),
      )?.id;
      return {nodeIds, operationId, contextId};
    });
    const outputOperation = evaluations
      .map(evaluation =>
        evaluation.operationId
          ? operations.get(evaluation.operationId)
          : undefined,
      )
      .find(operation => operation !== undefined);
    return {
      id: `source:${trace.kind}:${trace.id}`,
      kind: trace.kind,
      sourceRef: trace.sourceRef,
      functionId: designFunctionAt(trace.sourceRef, designArguments),
      evaluations,
      contextTargetIds: [],
      operation:
        trace.kind === 'operation-output' && outputOperation
          ? {kind: outputOperation.kind}
          : undefined,
    } satisfies SourceTarget;
  });

  const inputTargets = new Map<string, MutableSourceInputTarget>();
  for (const trace of sourceInputTraces) {
    const operationId = `${trace.siteId}:execution:${trace.execution}`;
    const operation = operations.get(operationId);
    if (!operation) {
      continue;
    }
    const key = [
      trace.siteId,
      trace.role,
      trace.index,
      trace.sourceRef.file,
      trace.sourceRef.start,
      trace.sourceRef.end,
    ].join(':');
    const target = inputTargets.get(key) ?? {
      id: `source:operation-input:${trace.siteId}:${trace.role}:${trace.index}`,
      kind: 'operation-input' as const,
      sourceRef: trace.sourceRef,
      evaluations: [],
      operationKind: operation.kind,
      role: trace.role,
    };
    target.evaluations.push({
      operationId: operation.id,
      objects: trace.objects,
      contextId: trace.contextId,
    });
    inputTargets.set(key, target);
  }

  const operationInputTargets = [...inputTargets.values()];
  const constraintTargets = [...sourceConstraintTraces.values()].map(trace => {
    const evaluations = trace.evaluations.flatMap<SourceTargetEvaluation>(
      evaluation => {
        const consumers = operationInputTargets.flatMap(target =>
          isCompositionInputRole(target.role)
            ? target.evaluations.filter(candidate =>
                candidate.objects.includes(evaluation.source),
              )
            : [],
        );
        return consumers.length > 0
          ? consumers.map(consumer => ({
              nodeIds: uniqueNodeIds(evaluation.source, evaluation.target),
              operationId: consumer.operationId,
              constraintId: evaluation.constraintId,
              constraintSourceNodeId: evaluation.source.nodeId,
              contextId: evaluation.contextId,
            }))
          : [
              {
                nodeIds: uniqueNodeIds(evaluation.source, evaluation.target),
                constraintId: evaluation.constraintId,
                constraintSourceNodeId: evaluation.source.nodeId,
                contextId: evaluation.contextId,
              },
            ];
      },
    );
    const consumerOperationIds = new Set(
      evaluations.flatMap(evaluation =>
        evaluation.operationId ? [evaluation.operationId] : [],
      ),
    );
    return {
      id: `source:constraint:${trace.id}`,
      kind: 'constraint',
      sourceRef: trace.sourceRef,
      functionId: designFunctionAt(trace.sourceRef, designArguments),
      evaluations,
      contextTargetIds: operationInputTargets
        .filter(target =>
          target.evaluations.some(evaluation =>
            consumerOperationIds.has(evaluation.operationId),
          ),
        )
        .map(target => target.id),
    } satisfies SourceTarget;
  });

  const elementTargets = [...sourceElementTraces.values()].map(trace => {
    const containingConstraints = constraintTargets.filter(
      target =>
        target.sourceRef.file === trace.sourceRef.file &&
        target.sourceRef.start <= trace.sourceRef.start &&
        trace.sourceRef.end <= target.sourceRef.end,
    );
    const narrowestConstraintSpan = Math.min(
      ...containingConstraints.map(target => sourceSpan(target.sourceRef)),
    );
    const relatedConstraints = containingConstraints.filter(
      target => sourceSpan(target.sourceRef) === narrowestConstraintSpan,
    );
    const evaluations = trace.evaluations.flatMap<SourceTargetEvaluation>(
      element => {
        const related = relatedConstraints.flatMap(target =>
          target.evaluations
            .filter(
              evaluation =>
                evaluation.contextId === element.contextId &&
                evaluation.nodeIds.includes(element.model.nodeId),
            )
            .map(evaluation => ({target, evaluation})),
        );
        const elementSnapshot = {
          nodeId: element.model.nodeId,
          name: element.name,
          kind: element.kind,
        } as const;
        return related.length > 0
          ? related.map(({evaluation}) => ({
              ...evaluation,
              element: elementSnapshot,
            }))
          : [
              {
                nodeIds: [element.model.nodeId],
                contextId: element.contextId,
                element: elementSnapshot,
              },
            ];
      },
    );
    return {
      id: `source:element:${trace.id}`,
      kind: 'element',
      sourceRef: trace.sourceRef,
      receiverRef: trace.receiverRef,
      functionId: designFunctionAt(trace.sourceRef, designArguments),
      evaluations,
      contextTargetIds: [
        ...new Set(
          relatedConstraints.flatMap(target => target.contextTargetIds),
        ),
      ],
    } satisfies SourceTarget;
  });

  return [
    ...elementTargets,
    ...constraintTargets,
    ...valueTargets,
    ...operationInputTargets.map(
      target =>
        ({
          id: target.id,
          kind: target.kind,
          sourceRef: target.sourceRef,
          functionId: designFunctionAt(target.sourceRef, designArguments),
          evaluations: target.evaluations.map(evaluation => ({
            nodeIds: evaluation.objects.map(object => object.nodeId),
            operationId: evaluation.operationId,
            contextId: evaluation.contextId,
          })),
          contextTargetIds: operationInputTargets
            .filter(
              candidate =>
                candidate !== target && sharesOperation(candidate, target),
            )
            .map(candidate => candidate.id),
          operation: {
            kind: target.operationKind,
            role: target.role,
          },
        }) satisfies SourceTarget,
    ),
  ];
}

function uniqueNodeIds(...models: readonly ModelObject[]): string[] {
  return [...new Set(models.map(model => model.nodeId))];
}

function sourceSpan(sourceRef: SourceRef): number {
  return sourceRef.end - sourceRef.start;
}

type MutableSourceInputTarget = {
  id: string;
  kind: 'operation-input';
  sourceRef: SourceRef;
  evaluations: Array<
    Readonly<{
      operationId: string;
      objects: readonly ModelObject[];
      contextId: string;
    }>
  >;
  operationKind: ModelOperationKind;
  role: ModelOperationInputRole;
};

function designFunctionAt(
  sourceRef: SourceRef,
  designArguments: readonly ParsedDesignArgumentContext[],
): string | undefined {
  return designArguments
    .filter(
      candidate =>
        candidate.functionRef.file === sourceRef.file &&
        candidate.functionRef.start <= sourceRef.start &&
        sourceRef.end <= candidate.functionRef.end,
    )
    .sort(
      (left, right) =>
        left.functionRef.end -
        left.functionRef.start -
        (right.functionRef.end - right.functionRef.start),
    )[0]?.functionId;
}

function sharesOperation(
  left: MutableSourceInputTarget,
  right: MutableSourceInputTarget,
) {
  const rightIds = new Set(
    right.evaluations.map(evaluation => evaluation.operationId),
  );
  return left.evaluations.some(evaluation =>
    rightIds.has(evaluation.operationId),
  );
}

function isCompositionInputRole(role: ModelOperationInputRole): boolean {
  return (
    role === 'receiver' ||
    role === 'operand' ||
    role === 'tool' ||
    role === 'child' ||
    role === 'collection'
  );
}

function createTraceTransformer(
  authorSourceLength: number,
): ts.TransformerFactory<ts.SourceFile> {
  return context => {
    const {factory} = context;

    return sourceFile => {
      const bindings = collectStaticParameterTargets(sourceFile);
      const visit: ts.Visitor = node => {
        if (
          !ts.isSourceFile(node) &&
          node.getStart(sourceFile) >= authorSourceLength
        ) {
          return node;
        }
        const visited = ts.visitEachChild(node, visit, context);
        if (
          ts.isVariableDeclaration(node) &&
          ts.isVariableDeclaration(visited) &&
          node.initializer &&
          visited.initializer &&
          isTraceableExpression(node.initializer, sourceFile)
        ) {
          const scope = isModuleVariableDeclaration(node) ? 'module' : 'local';
          const label = node.name.getText(sourceFile);
          const id =
            scope === 'module' && ts.isIdentifier(node.name)
              ? `${sourceFile.fileName}:binding:${node.name.text}`
              : `${stableSourceId('binding', node, sourceFile)}:${label}`;
          return factory.updateVariableDeclaration(
            visited,
            visited.name,
            visited.exclamationToken,
            visited.type,
            bindExpression(
              visited.initializer,
              node.name.getStart(sourceFile),
              node.initializer.getEnd(),
              sourceFile.fileName,
              id,
              label,
              'binding',
              scope,
              factory,
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
            bindExpression(
              visited.expression,
              node.expression.getStart(sourceFile),
              node.expression.getEnd(),
              sourceFile.fileName,
              `${sourceFile.fileName}:export:default`,
              'default',
              'export',
              'module',
              factory,
            ),
          );
        }

        if (
          ts.isCallExpression(node) &&
          ts.isCallExpression(visited) &&
          isTraceableCall(node, sourceFile)
        ) {
          const siteId = stableSourceId('expression', node, sourceFile);
          const parameterSignature = getParameterSignature(node);
          const parameterizedCall = parameterSignature
            ? instrumentCallParameters(
                node,
                visited,
                parameterSignature,
                bindings,
                sourceFile,
                factory,
              )
            : visited;
          const inputPlan = operationInputPlan(node);
          const call = inputPlan
            ? instrumentOperationInputs(
                node,
                parameterizedCall,
                inputPlan,
                siteId,
                sourceFile,
                factory,
              )
            : parameterizedCall;

          return traceExpression(
            call,
            node.getStart(sourceFile),
            node.getEnd(),
            sourceFile.fileName,
            siteId,
            callLabel(node),
            factory,
          );
        }

        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isPropertyAccessExpression(visited) &&
          isReadablePropertyAccess(node)
        ) {
          return traceElementExpression(node, visited, sourceFile, factory);
        }

        return visited;
      };

      return ts.visitNode(sourceFile, visit) as ts.SourceFile;
    };
  };
}

function traceElementExpression(
  original: ts.PropertyAccessExpression,
  visited: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.CallExpression {
  const id = stableSourceId('element', original.name, sourceFile);
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('__code3d'),
      'element',
    ),
    undefined,
    [
      factory.createStringLiteral(sourceFile.fileName),
      factory.createNumericLiteral(original.name.getStart(sourceFile)),
      factory.createNumericLiteral(original.name.getEnd()),
      factory.createNumericLiteral(original.expression.getStart(sourceFile)),
      factory.createNumericLiteral(original.expression.getEnd()),
      factory.createStringLiteral(id),
      visited,
    ],
  );
}

function isReadablePropertyAccess(node: ts.PropertyAccessExpression): boolean {
  const {parent} = node;
  if (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.expression === node
  ) {
    return false;
  }
  if (ts.isTaggedTemplateExpression(parent) && parent.tag === node) {
    return false;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return false;
  }
  if (
    (ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return false;
  }
  return !(ts.isDeleteExpression(parent) && parent.expression === node);
}

function traceExpression(
  expression: ts.Expression,
  start: number,
  end: number,
  file: string,
  id: string,
  label: string,
  factory: ts.NodeFactory,
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('__code3d'),
      'trace',
    ),
    undefined,
    [
      factory.createStringLiteral(file),
      factory.createNumericLiteral(start),
      factory.createNumericLiteral(end),
      factory.createStringLiteral(id),
      factory.createStringLiteral(label),
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

function bindExpression(
  expression: ts.Expression,
  start: number,
  end: number,
  file: string,
  id: string,
  label: string,
  category: ObjectCatalogEntry['category'],
  scope: ObjectCatalogEntry['scope'],
  factory: ts.NodeFactory,
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('__code3d'),
      'bind',
    ),
    undefined,
    [
      factory.createStringLiteral(file),
      factory.createNumericLiteral(start),
      factory.createNumericLiteral(end),
      factory.createStringLiteral(id),
      factory.createStringLiteral(label),
      factory.createStringLiteral(category),
      factory.createStringLiteral(scope),
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

function isModuleVariableDeclaration(node: ts.VariableDeclaration): boolean {
  const statement = node.parent.parent;
  return ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent);
}

function stableSourceId(
  category: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string {
  const statement = topLevelStatement(node);
  const path: string[] = [];
  let current = node;
  while (current !== statement && current.parent) {
    const siblings: ts.Node[] = [];
    ts.forEachChild(current.parent, child => {
      siblings.push(child);
    });
    path.unshift(`${current.kind}-${siblings.indexOf(current)}`);
    current = current.parent;
  }
  return `${sourceFile.fileName}:${category}:${statementIdentity(statement, sourceFile)}:${path.join('/') || 'root'}`;
}

function topLevelStatement(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    current = current.parent;
  }
  return current;
}

function statementIdentity(
  statement: ts.Node,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isVariableStatement(statement)) {
    const names = statement.declarationList.declarations.map(declaration =>
      declaration.name.getText(sourceFile).replace(/\s+/g, ''),
    );
    return `binding:${names.join(',')}`;
  }
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return `function:${statement.name.text}`;
  }
  if (ts.isClassDeclaration(statement) && statement.name) {
    return `class:${statement.name.text}`;
  }
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    return 'export:default';
  }
  const index = sourceFile.statements.indexOf(statement as ts.Statement);
  return `statement:${statement.kind}:${Math.max(index, 0)}`;
}

function callLabel(node: ts.CallExpression): string {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  if (
    ts.isElementAccessExpression(node.expression) &&
    ts.isStringLiteralLike(node.expression.argumentExpression)
  ) {
    return node.expression.argumentExpression.text;
  }
  return 'call';
}

type OperationInputPlan = Readonly<{
  receiver?: ModelOperationInputRole;
  arguments?: readonly (ModelOperationInputRole | undefined)[];
  rest?: ModelOperationInputRole;
  collection?: Readonly<{
    argumentIndex: number;
    first: ModelOperationInputRole;
    rest: ModelOperationInputRole;
    indexOffset?: number;
  }>;
}>;

function operationInputPlan(
  node: ts.CallExpression,
): OperationInputPlan | undefined {
  if (ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'union') {
      return {
        collection: {argumentIndex: 0, first: 'receiver', rest: 'operand'},
      };
    }
    if (node.expression.text === 'cut') {
      return {
        arguments: ['receiver'],
        collection: {
          argumentIndex: 1,
          first: 'tool',
          rest: 'tool',
          indexOffset: 1,
        },
      };
    }
    if (node.expression.text === 'intersect') {
      return {
        collection: {argumentIndex: 0, first: 'receiver', rest: 'operand'},
      };
    }
    if (node.expression.text === 'group') {
      return {
        collection: {argumentIndex: 0, first: 'child', rest: 'child'},
      };
    }
    return undefined;
  }
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const method = node.expression.name.text;
  if (
    method === 'named' ||
    method === 'paint' ||
    method === 'scaled' ||
    method === 'fillet' ||
    method === 'chamfer' ||
    method === 'expose' ||
    method === 'relate'
  ) {
    return {receiver: 'source'};
  }
  return undefined;
}

function instrumentOperationInputs(
  original: ts.CallExpression,
  visited: ts.CallExpression,
  plan: OperationInputPlan,
  siteId: string,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.CallExpression {
  let expression = visited.expression;
  if (
    plan.receiver &&
    ts.isPropertyAccessExpression(original.expression) &&
    ts.isPropertyAccessExpression(visited.expression)
  ) {
    const originalReceiver = original.expression.expression;
    expression = factory.updatePropertyAccessExpression(
      visited.expression,
      operationInputExpression(
        visited.expression.expression,
        originalReceiver,
        siteId,
        plan.receiver,
        0,
        sourceFile,
        factory,
      ),
      visited.expression.name,
    );
  }

  const args = visited.arguments.map((argument, index) => {
    if (plan.collection?.argumentIndex === index && original.arguments[index]) {
      return instrumentOperationCollection(
        original.arguments[index],
        argument,
        plan.collection,
        siteId,
        sourceFile,
        factory,
      );
    }
    const role = plan.arguments?.[index] ?? plan.rest;
    const originalArgument = original.arguments[index];
    if (!role || !originalArgument) {
      return argument;
    }
    const originalValue = ts.isSpreadElement(originalArgument)
      ? originalArgument.expression
      : originalArgument;
    const visitedValue = ts.isSpreadElement(argument)
      ? argument.expression
      : argument;
    const traced = operationInputExpression(
      visitedValue,
      originalValue,
      siteId,
      role,
      index,
      sourceFile,
      factory,
    );
    return ts.isSpreadElement(argument)
      ? factory.updateSpreadElement(argument, traced)
      : traced;
  });

  return factory.updateCallExpression(
    visited,
    expression,
    visited.typeArguments,
    args,
  );
}

function instrumentOperationCollection(
  original: ts.Expression,
  visited: ts.Expression,
  plan: NonNullable<OperationInputPlan['collection']>,
  siteId: string,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.Expression {
  if (
    !ts.isArrayLiteralExpression(original) ||
    !ts.isArrayLiteralExpression(visited)
  ) {
    return operationInputExpression(
      visited,
      original,
      siteId,
      'collection',
      plan.indexOffset ?? 0,
      sourceFile,
      factory,
    );
  }

  const elements = visited.elements.map((element, index) => {
    const originalElement = original.elements[index];
    if (
      !originalElement ||
      ts.isOmittedExpression(originalElement) ||
      ts.isOmittedExpression(element)
    ) {
      return element;
    }
    const originalValue = ts.isSpreadElement(originalElement)
      ? originalElement.expression
      : originalElement;
    const visitedValue = ts.isSpreadElement(element)
      ? element.expression
      : element;
    const role =
      index === 0 && ts.isSpreadElement(originalElement)
        ? 'collection'
        : index === 0
          ? plan.first
          : plan.rest;
    const traced = operationInputExpression(
      visitedValue,
      originalValue,
      siteId,
      role,
      index + (plan.indexOffset ?? 0),
      sourceFile,
      factory,
    );
    return ts.isSpreadElement(element)
      ? factory.updateSpreadElement(element, traced)
      : traced;
  });
  return factory.updateArrayLiteralExpression(visited, elements);
}

function operationInputExpression(
  expression: ts.Expression,
  original: ts.Expression,
  siteId: string,
  role: ModelOperationInputRole,
  index: number,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('__code3d'),
      'input',
    ),
    undefined,
    [
      factory.createStringLiteral(sourceFile.fileName),
      factory.createNumericLiteral(original.getStart(sourceFile)),
      factory.createNumericLiteral(original.getEnd()),
      factory.createStringLiteral(siteId),
      factory.createStringLiteral(role),
      factory.createNumericLiteral(index),
      expression,
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
        factory.createStringLiteral(sourceFile.fileName),
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
          file: sourceFile.fileName,
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
    const id = `${target.sourceRef.file}:${target.sourceRef.start}:${target.sourceRef.end}`;
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
          file: sourceFile.fileName,
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
        `${target.sourceRef.file}:${target.sourceRef.start}:${target.sourceRef.end}`,
      ),
      factory,
    ),
    property('label', factory.createStringLiteral(target.label), factory),
    property('value', createNumberExpression(target.value, factory), factory),
    property(
      'sourceRef',
      factory.createObjectLiteralExpression([
        property(
          'file',
          factory.createStringLiteral(target.sourceRef.file),
          factory,
        ),
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
  const metadata: Partial<StaticParameterTarget> = {};
  const annotations = code3dAnnotations(
    sourceFile.text,
    statement.getFullStart(),
    statement.getStart(sourceFile),
  );
  for (const {name: key, value} of annotations) {
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
  roots: readonly ModelSnapshotObject[],
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
  roots.forEach(visit);
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

function sourceRef(file: string, start: number, end: number): SourceRef {
  return {file: normalizeProjectPath(file), start, end};
}

function diagnosticFailure(
  diagnostic: ts.Diagnostic,
  file?: string,
): ModelDiagnosticError {
  return modelFailure(
    'syntax',
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    file && diagnostic.start !== undefined
      ? sourceRef(
          file,
          diagnostic.start,
          diagnostic.start + (diagnostic.length ?? 1),
        )
      : undefined,
  );
}

function modelFailure(
  kind: ModelDiagnosticKind,
  message: string,
  sourceRef?: SourceRef,
): ModelDiagnosticError {
  return new ModelDiagnosticError(
    createModelDiagnostic(kind, message, sourceRef),
  );
}
