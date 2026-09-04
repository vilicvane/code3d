import ts from '@typescript/typescript6';
import {
  normalizeProjectPath,
  resolveProjectImport,
  type ModelProject,
} from '../project/project';
import {
  authoringApi,
  constraintTraceReference,
  createModelSnapshotter,
  disposeModelObjects,
  instrumentConstraint,
  instrumentModelOperation,
  isConstraint,
  isModelObject,
  modelElementReference,
  modelObjectRuntimeInfo,
  modelTopologyReference,
  relatedModelObjects,
  type Constraint,
  type EdgeId,
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
  type TopologyKind,
} from '@code3d/core/tooling';
import * as screwApi from '@code3d/screws';
import {code3dAnnotations} from './annotations';
import {designArgumentAnnotationSites} from './design-functions';
import {
  isToolSelectionParameter,
  resolveProjectTooling,
  sourceNodeKey,
  toolCallKey,
  type ParameterDefinitionMap,
  type SourceParameterTarget,
  type ToolCallSchemaMap,
  type ToolArgumentSource,
  type ToolSelectionParameterSchema,
  type ToolSignatureSchema,
} from './tool-schema';
import {
  createModelDiagnostic,
  diagnosticFromError,
  locateModelError,
  ModelDiagnosticError,
  type ModelDiagnostic,
  type ModelDiagnosticKind,
} from './diagnostic';

const workspacePackages = new Map<string, unknown>([
  ['@code3d/core', authoringApi],
  ['@code3d/screws', screwApi],
]);

export type SourceTargetEvaluation = Readonly<{
  runtime: RuntimeReach;
  toolExecutionOrder?: number;
  nodeIds: readonly string[];
  parameters?: readonly ParameterUsage[];
  toolArguments?: Readonly<Record<number, number>>;
  operationId?: string;
  operationInput?: Readonly<{
    role: ModelOperationInputRole;
    nodeIds: readonly string[];
  }>;
  constraintId?: string;
  constraintSourceNodeId?: string;
  contextId: string;
  element?: Readonly<{
    nodeId: string;
    name: string;
    kind: ElementKind;
  }>;
  selection?:
    | Readonly<{
        kind: 'edges';
        inputNodeId: string;
        ids: readonly EdgeId[];
      }>
    | Readonly<{
        kind: TopologyKind;
        inputNodeId: string;
        ids: readonly number[];
      }>;
}>;

export type RuntimeReach = Readonly<{
  order: number;
  outcome: 'completed' | 'failed';
}>;

export type EdgeArgumentTarget = Readonly<
  | {
      kind: 'replace';
      sourceRef: SourceRef;
      removalSourceRef: SourceRef;
    }
  | {kind: 'append'; sourceRef: SourceRef; needsComma: boolean}
>;

export type SourceTarget = Readonly<{
  id: string;
  kind:
    | 'value'
    | 'constraint'
    | 'element'
    | 'tool'
    | 'topology-selection'
    | 'operation-input'
    | 'operation-output'
    | 'operation-selection';
  sourceRef: SourceRef;
  receiverRef?: SourceRef;
  functionId?: string;
  evaluations: readonly SourceTargetEvaluation[];
  contextTargetIds: readonly string[];
  tool?: Readonly<{
    callId: string;
    signature: ToolSignatureSchema;
    arguments: readonly ToolArgumentSource[];
  }>;
  operation?: Readonly<{
    kind: ModelOperationKind;
    role?: ModelOperationInputRole;
    edgeArgument?: EdgeArgumentTarget;
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
  diagnostic?: ModelDiagnostic;
  fallback?: ModelSnapshotObject;
  objects: ReadonlyMap<string, ModelSnapshotObject>;
  operations: ReadonlyMap<string, ModelOperationSnapshot>;
  toolNodeIds: ReadonlySet<string>;
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
  arguments: readonly (ParameterArgument | undefined)[];
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
    Readonly<{
      objects: readonly ModelObject[];
      contextId: string;
      runtime: RuntimeReach;
    }>
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
  runtime: RuntimeReach;
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
      runtime: RuntimeReach;
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
      runtime: RuntimeReach;
    }>
  >;
};

type EdgeSelectionSite = Readonly<{
  siteId: string;
  operation: 'fillet' | 'chamfer';
  sourceRef: SourceRef;
  edgeArgument: EdgeArgumentTarget;
}>;

type ToolCallSite = Readonly<{
  siteId: string;
  sourceRef: SourceRef;
  signature: ToolSignatureSchema;
  arguments: readonly ToolArgumentSource[];
}>;

type TraceFrame = Readonly<{
  trace: SourceExecutionTrace;
}>;

type SourceExecutionTrace = {
  siteId: string;
  execution: number;
  contextId: string;
  sourceRef: SourceRef;
  outcome: 'entered' | 'completed' | 'failed';
  order: number;
  parameters: readonly ParameterUsage[];
  arguments: Map<number, unknown>;
  receiver?: unknown;
  inputs: SourceInputTrace[];
  failure?: ModelDiagnostic;
};

const tracedObjects = new Set<ModelObject>();
const sourceValueTraces = new Map<string, SourceValueTrace>();
const sourceConstraintTraces = new Map<string, SourceConstraintTrace>();
const sourceElementTraces = new Map<string, SourceElementTrace>();
const edgeSelectionSites = new Map<string, EdgeSelectionSite>();
const toolCallSites = new Map<string, ToolCallSite>();
const sourceExecutionTraces = new Map<string, SourceExecutionTrace>();
const catalogTraces = new Map<string, CatalogTrace>();
const parameterFrames: ParameterUsage[][] = [];
const traceFrames: TraceFrame[] = [];
const traceExecutionCounts = new Map<string, number>();
const evaluationContexts = new Map<string, EvaluationContext>();
const designContextFrames: EvaluationContext[] = [];
const designRootObjects = new Set<ModelObject>();
let latestTracedObject: ModelObject | undefined;
let evaluationOrder = 0;
let sourceReachOrder = 0;
const traceRuntime = Object.freeze({
  trace<T>(
    file: string,
    start: number,
    end: number,
    failureStart: number,
    failureEnd: number,
    id: string,
    label: string,
    run: () => T,
  ): T {
    const execution = nextTraceExecution(id);
    const location = sourceRef(file, start, end);
    const context =
      currentEvaluationContext() ??
      callEvaluationContext(id, execution, label, location);
    const parameters: ParameterUsage[] = [];
    const executionTrace: SourceExecutionTrace = {
      siteId: id,
      execution,
      contextId: context.id,
      sourceRef: location,
      outcome: 'entered',
      order: nextSourceReachOrder(),
      parameters,
      arguments: new Map(),
      inputs: [],
    };
    sourceExecutionTraces.set(traceExecutionKey(id, execution), executionTrace);
    parameterFrames.push(parameters);
    traceFrames.push({trace: executionTrace});
    let result: T;
    try {
      result = run();
    } catch (error) {
      executionTrace.outcome = 'failed';
      executionTrace.order = nextSourceReachOrder();
      const failure = locateModelError(
        error,
        sourceRef(file, failureStart, failureEnd),
      );
      executionTrace.failure = failure.diagnostic;
      throw failure;
    } finally {
      traceFrames.pop();
      parameterFrames.pop();
    }
    executionTrace.outcome = 'completed';
    executionTrace.order = nextSourceReachOrder();
    const runtime = sourceExecutionRuntime(executionTrace);
    if (isConstraint(result)) {
      instrumentConstraint(result, location, parameters);
      recordSourceConstraint(id, location, result, context.id, runtime);
    } else if (isModelObject(result)) {
      const order = ++evaluationOrder;
      instrumentModelOperation(result, {
        siteId: id,
        execution,
        order,
        sourceRef: location,
        parameters,
      });
      recordSourceValue(
        id,
        'operation-output',
        location,
        result,
        context.id,
        runtime,
      );
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
      recordSourceValue(id, 'value', location, result, context.id, runtime);
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
    const runtime = completedRuntimeReach();
    if (isConstraint(result)) {
      recordSourceConstraint(id, location, result, context.id, runtime);
    } else {
      recordSourceValue(id, 'value', location, result, context.id, runtime);
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
      completedRuntimeReach(),
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
    const executionTrace = traceFrames.at(-1)?.trace;
    if (executionTrace?.siteId !== siteId) {
      return value;
    }
    const objects = modelObjectsIn(value);
    if (objects.length > 0) {
      objects.forEach(object => tracedObjects.add(object));
      executionTrace.inputs.push({
        siteId,
        execution: executionTrace.execution,
        sourceRef: sourceRef(file, start, end),
        role,
        index,
        objects,
        contextId: executionTrace.contextId,
        runtime: completedRuntimeReach(),
      });
    }
    return value;
  },

  argument<T>(siteId: string, index: number, value: T): T {
    const executionTrace = traceFrames.at(-1)?.trace;
    if (executionTrace?.siteId === siteId) {
      executionTrace.arguments.set(index, value);
    }
    return value;
  },

  receiver<T>(siteId: string, value: T): T {
    const executionTrace = traceFrames.at(-1)?.trace;
    if (executionTrace?.siteId === siteId) {
      executionTrace.receiver = value;
      const reference = modelTopologyReference(value);
      const model = isModelObject(value) ? value : reference?.model;
      if (model) tracedObjects.add(model);
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
    trace.evaluations.push({
      ...reference,
      contextId: context.id,
      runtime: completedRuntimeReach(),
    });
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
  const contextId = traceFrames[0]?.trace.contextId;
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
  const execution = traceExecutionCounts.get(id) ?? 0;
  traceExecutionCounts.set(id, execution + 1);
  return execution;
}

function nextSourceReachOrder(): number {
  sourceReachOrder += 1;
  return sourceReachOrder;
}

function completedRuntimeReach(): RuntimeReach {
  return {order: nextSourceReachOrder(), outcome: 'completed'};
}

function sourceExecutionRuntime(trace: SourceExecutionTrace): RuntimeReach {
  if (trace.outcome === 'entered') {
    throw new Error(
      'A running source execution cannot produce a source target.',
    );
  }
  return {order: trace.order, outcome: trace.outcome};
}

function traceExecutionKey(siteId: string, execution: number): string {
  return `${siteId}:execution:${execution}`;
}

function recordSourceValue(
  id: string,
  kind: SourceValueTrace['kind'],
  sourceRef: SourceRef,
  value: unknown,
  contextId: string,
  runtime: RuntimeReach,
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
  sourceTrace.evaluations.push({objects, contextId, runtime});
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
  runtime: RuntimeReach,
): void {
  const reference = constraintTraceReference(constraint);
  const key = `${id}:${location.file}:${location.start}:${location.end}`;
  const trace = sourceConstraintTraces.get(key) ?? {
    id,
    sourceRef: location,
    evaluations: [],
  };
  trace.evaluations.push({...reference, contextId, runtime});
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
  const topology = modelTopologyReference(value);
  if (topology) return [topology.model];
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
  rootModulePath: string,
  requestedDesignContextId?: string,
): ModelModule {
  const files = new Map(
    project.files.map(file => [normalizeProjectPath(file.path), file.source]),
  );
  const designArguments = [...files].flatMap(([path, source]) =>
    parseDesignArgumentContexts(path, source),
  );
  const tooling = resolveProjectTooling(project);
  const activeDesignContext = designArguments.find(
    context => context.id === requestedDesignContextId,
  );
  const rootPath = resolveModuleFile(
    normalizeProjectPath(rootModulePath),
    files,
  );
  if (!rootPath) {
    throw modelFailure('project', `Project file not found: ${rootModulePath}`);
  }

  tracedObjects.clear();
  sourceValueTraces.clear();
  sourceConstraintTraces.clear();
  sourceElementTraces.clear();
  edgeSelectionSites.clear();
  toolCallSites.clear();
  sourceExecutionTraces.clear();
  catalogTraces.clear();
  parameterFrames.length = 0;
  traceFrames.length = 0;
  traceExecutionCounts.clear();
  evaluationContexts.clear();
  designContextFrames.length = 0;
  designRootObjects.clear();
  latestTracedObject = undefined;
  evaluationOrder = 0;
  sourceReachOrder = 0;
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
        tooling.toolCalls.get(normalized),
        tooling.parameterDefinitions.get(normalized),
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
        const workspacePackage = workspacePackages.get(specifier);
        if (workspacePackage) return workspacePackage;
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

    let diagnostic: ModelDiagnostic | undefined;
    try {
      executeModule(rootPath);
      if (
        activeDesignContext &&
        !modules.has(activeDesignContext.functionRef.file)
      ) {
        executeModule(activeDesignContext.functionRef.file);
      }
    } catch (error) {
      diagnostic = diagnosticFromError(error);
    }

    const modelExports = new Map<string, ModelObject>();
    const exportNamesByObject = new Map<ModelObject, Set<string>>();
    for (const [modulePath, module] of modules) {
      for (const [name, value] of Object.entries(module.exports)) {
        const exportLabel =
          modulePath === rootPath ? name : `${modulePath}:${name}`;
        if (modulePath === rootPath && isModelObject(value)) {
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
    if (!fallbackObject && !diagnostic && designArguments.length === 0) {
      throw new Error(
        'The current program did not produce a renderable ModelObject.',
      );
    }
    if (diagnostic && fallbackObject) {
      diagnostic = relateDiagnosticToFallback(diagnostic, fallbackObject);
    }

    const snapshotModel = createModelSnapshotter();
    const snapshots = new Map<ModelObject, ModelSnapshotObject>();
    const snapshotOf = (object: ModelObject): ModelSnapshotObject => {
      const existing = snapshots.get(object);
      if (existing) return existing;
      let snapshot: ModelSnapshotObject;
      try {
        snapshot = snapshotModel(object);
      } catch (error) {
        const location = modelObjectSourceRefs(object).at(-1);
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
      graphObjects.map(object => [
        modelObjectNodeId(object),
        snapshotOf(object),
      ]),
    );
    const operations = new Map(
      [...objectSnapshots.values()].map(object => [
        object.operation.id,
        object.operation,
      ]),
    );
    return {
      diagnostic,
      fallback: fallbackSnapshot,
      objects: objectSnapshots,
      operations,
      toolNodeIds: operationRoleLineageNodeIds(operations, 'tool'),
      exports: new Map(
        [...modelExports].map(([name, modelObject]) => [
          name,
          modelObjectNodeId(modelObject),
        ]),
      ),
      catalog: [...catalogTraces.values()]
        .sort((left, right) => left.runs[0].order - right.runs[0].order)
        .map(trace => {
          const occurrences = trace.runs.flatMap((run, execution) =>
            run.objects.map((object, output) => ({
              id: `${trace.id}:execution:${execution}:output:${output}`,
              nodeId: modelObjectNodeId(object),
              label: modelObjectName(object),
              sourceRef:
                modelObjectSourceRefs(object).at(-1) ?? trace.sourceRef,
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
            nodeIds: [...trace.objects].map(modelObjectNodeId),
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
      sourceTargets: buildSourceTargets(
        operations,
        objectSnapshots,
        designArguments,
      ),
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
    sourceConstraintTraces.clear();
    sourceElementTraces.clear();
    edgeSelectionSites.clear();
    toolCallSites.clear();
    sourceExecutionTraces.clear();
    catalogTraces.clear();
    parameterFrames.length = 0;
    traceFrames.length = 0;
    traceExecutionCounts.clear();
    evaluationContexts.clear();
    designContextFrames.length = 0;
    designRootObjects.clear();
    latestTracedObject = undefined;
    evaluationOrder = 0;
    sourceReachOrder = 0;
  }
}

function transpileSource(
  path: string,
  source: string,
  toolCalls: ToolCallSchemaMap | undefined,
  parameterDefinitions: ParameterDefinitionMap | undefined,
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
    transformers: {
      before: [
        createTraceTransformer(
          source.length,
          toolCalls,
          parameterDefinitions ?? new Map(),
        ),
      ],
    },
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
    relatedModelObjects(object).forEach(visit);
  };
  for (const root of roots) {
    visit(root);
  }
  return [...found];
}

function modelObjectNodeId(object: ModelObject): string {
  return modelObjectRuntimeInfo(object).nodeId;
}

function modelObjectName(object: ModelObject): string {
  return modelObjectRuntimeInfo(object).name;
}

function modelObjectSourceRefs(object: ModelObject): readonly SourceRef[] {
  return modelObjectRuntimeInfo(object).sourceRefs;
}

function relateDiagnosticToFallback(
  diagnostic: ModelDiagnostic,
  fallback: ModelObject,
): ModelDiagnostic {
  if (diagnostic.kind !== 'evaluation') return diagnostic;
  const failureInputs = [...sourceExecutionTraces.values()]
    .filter(execution => execution.failure === diagnostic)
    .flatMap(execution => [
      ...execution.inputs.flatMap(input => input.objects),
      ...modelObjectsIn(execution.receiver),
    ]);
  if (failureInputs.length === 0) return diagnostic;
  const fallbackNodeIds = new Set(
    collectObjectGraph([fallback]).map(modelObjectNodeId),
  );
  const relatedModelNodeIds = [
    ...new Set(
      collectObjectGraph(failureInputs)
        .map(modelObjectNodeId)
        .filter(nodeId => fallbackNodeIds.has(nodeId)),
    ),
  ];
  return relatedModelNodeIds.length > 0
    ? {...diagnostic, relatedModelNodeIds}
    : diagnostic;
}

function buildSourceTargets(
  operations: ReadonlyMap<string, ModelOperationSnapshot>,
  objects: ReadonlyMap<string, ModelSnapshotObject>,
  designArguments: readonly ParsedDesignArgumentContext[],
): SourceTarget[] {
  const operationsByOutputNodeId = new Map(
    [...operations.values()].map(operation => [
      operation.outputNodeId,
      operation,
    ]),
  );
  const sourceInputTraces = [...sourceExecutionTraces.values()].flatMap(
    execution => execution.inputs,
  );
  const valueTargets = [...sourceValueTraces.values()].map(trace => {
    const toolSite = toolCallSites.get(trace.id);
    const evaluations = trace.evaluations.map(
      ({objects, contextId, runtime}) => {
        const nodeIds = objects.map(modelObjectNodeId);
        const operationId = [...operations.values()].find(
          operation =>
            operation.siteId === trace.id &&
            nodeIds.includes(operation.outputNodeId),
        )?.id;
        return {
          runtime,
          nodeIds,
          operationId,
          contextId,
          parameters: sourceExecutionFor(trace.id, contextId, runtime)
            ?.parameters,
        };
      },
    );
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
      sourceRef: toolSite?.sourceRef ?? trace.sourceRef,
      functionId: designFunctionAt(trace.sourceRef, designArguments),
      evaluations,
      contextTargetIds: [],
      tool: sourceTool(toolSite),
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
      runtime: trace.runtime,
    });
    inputTargets.set(key, target);
  }

  const operationInputTargets = [...inputTargets.values()];
  const operationSelectionTargets = [...edgeSelectionSites.values()].flatMap(
    site => {
      const evaluations = [
        ...sourceExecutionTraces.values(),
      ].flatMap<SourceTargetEvaluation>(execution => {
        if (execution.siteId !== site.siteId) {
          return [];
        }
        const trace = execution.inputs.find(
          input => input.role === 'source' && input.index === 0,
        );
        if (!trace) return [];
        const operation = operations.get(
          traceExecutionKey(execution.siteId, execution.execution),
        );
        const sourceObject = trace.objects[0];
        const selection = operation?.selections.find(
          candidate =>
            candidate.kind === 'edge' &&
            candidate.inputNodeId ===
              (sourceObject ? modelObjectNodeId(sourceObject) : undefined),
        );
        if (operation && selection) {
          return [
            {
              runtime: sourceExecutionRuntime(execution),
              nodeIds: [operation.outputNodeId],
              parameters: execution.parameters,
              operationId: operation.id,
              contextId: trace.contextId,
              selection: {
                kind: 'edges',
                inputNodeId: selection.inputNodeId,
                ids: selection.ids,
              },
            },
          ];
        }
        const input = trace.objects[0];
        const inputSnapshot = input
          ? objects.get(modelObjectNodeId(input))
          : undefined;
        if (execution.outcome !== 'failed' || inputSnapshot?.kind !== 'solid') {
          return [];
        }
        return [
          {
            runtime: sourceExecutionRuntime(execution),
            nodeIds: [modelObjectNodeId(input)],
            parameters: execution.parameters,
            contextId: execution.contextId,
            selection: {
              kind: 'edges',
              inputNodeId: modelObjectNodeId(input),
              ids: validAttemptedEdgeIds(
                inputSnapshot,
                attemptedEdgeIds(execution.arguments.get(1)),
              ),
            },
          },
        ];
      });
      return evaluations.length > 0
        ? [
            {
              id: `source:operation-selection:${site.siteId}:edge`,
              kind: 'operation-selection' as const,
              sourceRef: site.sourceRef,
              functionId: designFunctionAt(site.sourceRef, designArguments),
              evaluations,
              contextTargetIds: [],
              tool: sourceTool(toolCallSites.get(site.siteId)),
              operation: {
                kind: site.operation,
                role: 'source' as const,
                edgeArgument: site.edgeArgument,
              },
            } satisfies SourceTarget,
          ]
        : [];
    },
  );
  const topologySelectionTargets = [...toolCallSites.values()].flatMap(site => {
    if (edgeSelectionSites.has(site.siteId)) return [];
    const parameter = site.signature.parameters.find(
      (candidate): candidate is ToolSelectionParameterSchema =>
        isToolSelectionParameter(candidate),
    );
    if (!parameter) return [];
    const evaluations = [...sourceExecutionTraces.values()].flatMap(
      execution => {
        if (execution.siteId !== site.siteId) return [];
        const receiver = execution.receiver;
        if (!isModelObject(receiver)) return [];
        const attemptedIds = attemptedTopologyIds(
          execution.arguments.get(parameter.index),
          parameter.multiple,
        );
        return [
          {
            runtime: sourceExecutionRuntime(execution),
            nodeIds: [modelObjectNodeId(receiver)],
            parameters: execution.parameters,
            contextId: execution.contextId,
            selection: {
              kind: parameter.kind,
              inputNodeId: modelObjectNodeId(receiver),
              ids: validAttemptedTopologyIds(
                objects.get(modelObjectNodeId(receiver)),
                parameter.kind,
                attemptedIds,
              ),
            },
          } satisfies SourceTargetEvaluation,
        ];
      },
    );
    return evaluations.length > 0
      ? [
          {
            id: `source:topology-selection:${site.siteId}:${parameter.kind}`,
            kind: 'topology-selection' as const,
            sourceRef: site.sourceRef,
            functionId: designFunctionAt(site.sourceRef, designArguments),
            evaluations,
            contextTargetIds: [],
            tool: sourceTool(site),
          } satisfies SourceTarget,
        ]
      : [];
  });
  const constraintTargets = [...sourceConstraintTraces.values()].map(trace => {
    const toolSite = toolCallSites.get(trace.id);
    const evaluations = trace.evaluations.flatMap<SourceTargetEvaluation>(
      evaluation => {
        const execution = sourceExecutionFor(
          trace.id,
          evaluation.contextId,
          evaluation.runtime,
        );
        const consumers = operationInputTargets.flatMap(target =>
          isCompositionInputRole(target.role)
            ? target.evaluations
                .filter(candidate =>
                  candidate.objects.some(object =>
                    sourceLineageContains(
                      operationsByOutputNodeId,
                      modelObjectNodeId(object),
                      modelObjectNodeId(evaluation.source),
                    ),
                  ),
                )
                .map(input => ({input, role: target.role}))
            : [],
        );
        return consumers.length > 0
          ? consumers.map(consumer => ({
              runtime: consumer.input.runtime,
              toolExecutionOrder: evaluation.runtime.order,
              parameters: execution?.parameters,
              nodeIds: uniqueNodeIds(evaluation.source, evaluation.target),
              operationId: consumer.input.operationId,
              operationInput: {
                role: consumer.role,
                nodeIds: consumer.input.objects.map(modelObjectNodeId),
              },
              constraintId: evaluation.constraintId,
              constraintSourceNodeId: modelObjectNodeId(evaluation.source),
              contextId: evaluation.contextId,
            }))
          : [
              {
                runtime: evaluation.runtime,
                toolExecutionOrder: evaluation.runtime.order,
                parameters: execution?.parameters,
                nodeIds: uniqueNodeIds(evaluation.source, evaluation.target),
                constraintId: evaluation.constraintId,
                constraintSourceNodeId: modelObjectNodeId(evaluation.source),
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
      sourceRef: toolSite?.sourceRef ?? trace.sourceRef,
      functionId: designFunctionAt(trace.sourceRef, designArguments),
      evaluations,
      tool: sourceTool(toolSite),
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
                evaluation.nodeIds.includes(modelObjectNodeId(element.model)),
            )
            .map(evaluation => ({target, evaluation})),
        );
        const elementSnapshot = {
          nodeId: modelObjectNodeId(element.model),
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
                runtime: element.runtime,
                nodeIds: [modelObjectNodeId(element.model)],
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

  const targets: SourceTarget[] = [
    ...elementTargets,
    ...constraintTargets,
    ...operationSelectionTargets,
    ...topologySelectionTargets,
    ...valueTargets,
    ...operationInputTargets.map(
      target =>
        ({
          id: target.id,
          kind: target.kind,
          sourceRef: target.sourceRef,
          functionId: designFunctionAt(target.sourceRef, designArguments),
          evaluations: target.evaluations.map(evaluation => ({
            runtime: evaluation.runtime,
            nodeIds: evaluation.objects.map(modelObjectNodeId),
            operationId: evaluation.operationId,
            operationInput: {
              role: target.role,
              nodeIds: evaluation.objects.map(modelObjectNodeId),
            },
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
  const fallbackToolTargets: SourceTarget[] = [
    ...toolCallSites.values(),
  ].flatMap(site => {
    const evaluations = [...sourceExecutionTraces.values()]
      .filter(
        execution =>
          execution.siteId === site.siteId &&
          !toolExecutionIsRepresented(site, execution, targets),
      )
      .map(execution => ({
        runtime: sourceExecutionRuntime(execution),
        nodeIds: toolExecutionNodeIds(execution, objects),
        parameters: execution.parameters,
        contextId: execution.contextId,
      }));
    return evaluations.length > 0
      ? [
          {
            id: `source:tool:${site.siteId}`,
            kind: 'tool' as const,
            sourceRef: site.sourceRef,
            functionId: designFunctionAt(site.sourceRef, designArguments),
            evaluations,
            contextTargetIds: [],
            tool: sourceTool(site),
          } satisfies SourceTarget,
        ]
      : [];
  });
  return [...fallbackToolTargets, ...targets].map(target => ({
    ...target,
    evaluations: target.evaluations
      .map(evaluation => {
        const execution = target.tool
          ? sourceExecutionFor(target.tool.callId, evaluation.contextId, {
              ...evaluation.runtime,
              order: evaluation.toolExecutionOrder ?? evaluation.runtime.order,
            })
          : undefined;
        const toolArguments = execution
          ? numericToolArguments(execution.arguments)
          : undefined;
        return toolArguments ? {...evaluation, toolArguments} : evaluation;
      })
      .sort((left, right) => right.runtime.order - left.runtime.order),
  }));
}

function numericToolArguments(
  arguments_: ReadonlyMap<number, unknown>,
): Readonly<Record<number, number>> | undefined {
  const values: Record<number, number> = {};
  arguments_.forEach((value, index) => {
    if (typeof value === 'number') values[index] = value;
  });
  return Object.keys(values).length > 0 ? values : undefined;
}

function toolExecutionIsRepresented(
  site: ToolCallSite,
  execution: SourceExecutionTrace,
  targets: readonly SourceTarget[],
): boolean {
  return targets.some(
    target =>
      target.tool !== undefined &&
      target.sourceRef.file === site.sourceRef.file &&
      target.sourceRef.start === site.sourceRef.start &&
      target.sourceRef.end === site.sourceRef.end &&
      target.evaluations.some(
        evaluation =>
          evaluation.contextId === execution.contextId &&
          (evaluation.toolExecutionOrder ?? evaluation.runtime.order) ===
            execution.order,
      ),
  );
}

function toolExecutionNodeIds(
  execution: SourceExecutionTrace,
  objects: ReadonlyMap<string, ModelSnapshotObject>,
): string[] {
  const models = [
    ...execution.inputs.flatMap(input => input.objects),
    ...modelObjectsIn(execution.receiver),
    ...[...execution.arguments.values()].flatMap(value =>
      modelObjectsIn(value),
    ),
  ];
  return [
    ...new Set(
      models.map(modelObjectNodeId).filter(nodeId => objects.has(nodeId)),
    ),
  ];
}

function sourceTool(site: ToolCallSite | undefined): SourceTarget['tool'] {
  return site
    ? {
        callId: site.siteId,
        signature: site.signature,
        arguments: site.arguments,
      }
    : undefined;
}

function sourceExecutionFor(
  siteId: string,
  contextId: string,
  runtime: RuntimeReach,
): SourceExecutionTrace | undefined {
  return [...sourceExecutionTraces.values()].find(
    execution =>
      execution.siteId === siteId &&
      execution.contextId === contextId &&
      execution.order === runtime.order,
  );
}

function attemptedEdgeIds(value: unknown): EdgeId[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (candidate): candidate is EdgeId =>
          typeof candidate === 'number' &&
          Number.isSafeInteger(candidate) &&
          candidate >= 1,
      ),
    ),
  ];
}

function attemptedTopologyIds(value: unknown, multiple: boolean): number[] {
  const values = multiple ? (Array.isArray(value) ? value : []) : [value];
  return [
    ...new Set(
      values.filter(
        (candidate): candidate is number =>
          typeof candidate === 'number' &&
          Number.isSafeInteger(candidate) &&
          candidate >= 1,
      ),
    ),
  ];
}

function validAttemptedTopologyIds(
  input: ModelSnapshotObject | undefined,
  kind: TopologyKind,
  attempted: readonly number[],
): number[] {
  if (!input?.mesh) return [];
  const available = new Set(
    kind === 'vertex'
      ? input.mesh.vertexIds
      : kind === 'edge'
        ? input.mesh.edgeGroups.map(group => group.edgeId)
        : input.mesh.surfaceGroups.map(group => group.surfaceId),
  );
  return attempted.filter(id => available.has(id));
}

function validAttemptedEdgeIds(
  input: ModelSnapshotObject,
  attempted: readonly EdgeId[] | undefined,
): EdgeId[] {
  if (input.kind !== 'solid' || !input.mesh || !attempted) return [];
  const available = new Set(
    input.mesh.edgeGroups.map(edgeGroup => edgeGroup.edgeId),
  );
  return attempted.filter(edgeId => available.has(edgeId));
}

function sourceLineageContains(
  operationsByOutputNodeId: ReadonlyMap<string, ModelOperationSnapshot>,
  nodeId: string,
  sourceNodeId: string,
): boolean {
  let currentNodeId: string | undefined = nodeId;
  while (currentNodeId) {
    if (currentNodeId === sourceNodeId) return true;
    currentNodeId = operationsByOutputNodeId
      .get(currentNodeId)
      ?.inputs.find(input => input.role === 'source')?.nodeId;
  }
  return false;
}

function operationRoleLineageNodeIds(
  operations: ReadonlyMap<string, ModelOperationSnapshot>,
  role: ModelOperationInputRole,
): ReadonlySet<string> {
  const operationsByOutputNodeId = new Map(
    [...operations.values()].map(operation => [
      operation.outputNodeId,
      operation,
    ]),
  );
  const nodeIds = new Set<string>();
  for (const operation of operations.values()) {
    for (const input of operation.inputs.filter(input => input.role === role)) {
      let nodeId: string | undefined = input.nodeId;
      while (nodeId) {
        nodeIds.add(nodeId);
        nodeId = operationsByOutputNodeId
          .get(nodeId)
          ?.inputs.find(candidate => candidate.role === 'source')?.nodeId;
      }
    }
  }
  return nodeIds;
}

function uniqueNodeIds(...models: readonly ModelObject[]): string[] {
  return [...new Set(models.map(modelObjectNodeId))];
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
      runtime: RuntimeReach;
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
    role === 'collection' ||
    role === 'section' ||
    role === 'spine'
  );
}

function createTraceTransformer(
  authorSourceLength: number,
  toolCalls: ToolCallSchemaMap | undefined,
  parameterDefinitions: ParameterDefinitionMap,
): ts.TransformerFactory<ts.SourceFile> {
  return context => {
    const {factory} = context;

    return sourceFile => {
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
          const toolSignature = toolCalls?.get(
            toolCallKey(node.getStart(sourceFile), node.getEnd()),
          );
          if (toolSignature) {
            toolCallSites.set(
              siteId,
              toolCallSite(node, siteId, toolSignature, sourceFile),
            );
          }
          const edgeSelection = edgeSelectionSite(node, siteId, sourceFile);
          if (edgeSelection) {
            edgeSelectionSites.set(siteId, edgeSelection);
          }
          const parameterSignature = toolSignature
            ? parameterSignatureFor(toolSignature)
            : undefined;
          const parameterizedCall = parameterSignature
            ? instrumentCallParameters(
                node,
                visited,
                parameterSignature,
                parameterDefinitions,
                sourceFile,
                factory,
              )
            : visited;
          const inputPlan = operationInputPlan(node);
          const callWithInputs = inputPlan
            ? instrumentOperationInputs(
                node,
                parameterizedCall,
                inputPlan,
                siteId,
                sourceFile,
                factory,
              )
            : parameterizedCall;
          const callWithReceiver = toolSignature?.parameters.some(
            isToolSelectionParameter,
          )
            ? instrumentToolReceiver(callWithInputs, siteId, factory)
            : callWithInputs;
          const call = instrumentCallArguments(
            callWithReceiver,
            siteId,
            factory,
          );

          return traceExpression(
            call,
            node.getStart(sourceFile),
            node.getEnd(),
            callFailureStart(node, sourceFile),
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

function edgeSelectionSite(
  node: ts.CallExpression,
  siteId: string,
  sourceFile: ts.SourceFile,
): EdgeSelectionSite | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const operation = node.expression.name.text;
  if (operation !== 'fillet' && operation !== 'chamfer') return undefined;
  const firstArgument = node.arguments[0];
  if (!firstArgument) return undefined;
  const edgeArgument = node.arguments[1];
  const closeParen = node.getEnd() - 1;
  return {
    siteId,
    operation,
    sourceRef: sourceRef(
      sourceFile.fileName,
      node.expression.name.getStart(sourceFile),
      node.getEnd(),
    ),
    edgeArgument: edgeArgument
      ? {
          kind: 'replace',
          sourceRef: sourceRef(
            sourceFile.fileName,
            edgeArgument.getStart(sourceFile),
            edgeArgument.getEnd(),
          ),
          removalSourceRef: sourceRef(
            sourceFile.fileName,
            firstArgument.getEnd(),
            closeParen,
          ),
        }
      : {
          kind: 'append',
          sourceRef: sourceRef(sourceFile.fileName, closeParen, closeParen),
          needsComma: !node.arguments.hasTrailingComma,
        },
  };
}

function instrumentCallArguments(
  call: ts.CallExpression,
  siteId: string,
  factory: ts.NodeFactory,
): ts.CallExpression {
  const argumentsWithTracing = call.arguments.map((argument, index) => {
    const value = ts.isSpreadElement(argument) ? argument.expression : argument;
    const traced = factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier('__code3d'),
        'argument',
      ),
      undefined,
      [
        factory.createStringLiteral(siteId),
        factory.createNumericLiteral(index),
        value,
      ],
    );
    return ts.isSpreadElement(argument)
      ? factory.updateSpreadElement(argument, traced)
      : traced;
  });
  return factory.updateCallExpression(
    call,
    call.expression,
    call.typeArguments,
    argumentsWithTracing,
  );
}

function instrumentToolReceiver(
  call: ts.CallExpression,
  siteId: string,
  factory: ts.NodeFactory,
): ts.CallExpression {
  if (!ts.isPropertyAccessExpression(call.expression)) return call;
  const property = call.expression;
  const receiver = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('__code3d'),
      'receiver',
    ),
    undefined,
    [factory.createStringLiteral(siteId), property.expression],
  );
  const expression = ts.isPropertyAccessChain(property)
    ? factory.updatePropertyAccessChain(
        property,
        receiver,
        property.questionDotToken,
        property.name,
      )
    : factory.updatePropertyAccessExpression(property, receiver, property.name);
  return factory.updateCallExpression(
    call,
    expression,
    call.typeArguments,
    call.arguments,
  );
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
  failureStart: number,
  failureEnd: number,
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
      factory.createNumericLiteral(failureStart),
      factory.createNumericLiteral(failureEnd),
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

function callFailureStart(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): number {
  return ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.getStart(sourceFile)
    : call.getStart(sourceFile);
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
  object?: Readonly<{
    argumentIndex: number;
    properties: Readonly<Record<string, ModelOperationInputRole>>;
    fallback: ModelOperationInputRole;
  }>;
}>;

function operationInputPlan(
  node: ts.CallExpression,
): OperationInputPlan | undefined {
  if (ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'loft') {
      return {
        collection: {argumentIndex: 0, first: 'receiver', rest: 'section'},
        object: {
          argumentIndex: 1,
          properties: {spine: 'spine'},
          fallback: 'spine',
        },
      };
    }
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
    if (plan.object?.argumentIndex === index && original.arguments[index]) {
      return instrumentOperationObject(
        original.arguments[index],
        argument,
        plan.object,
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

function instrumentOperationObject(
  original: ts.Expression,
  visited: ts.Expression,
  plan: NonNullable<OperationInputPlan['object']>,
  siteId: string,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.Expression {
  if (
    !ts.isObjectLiteralExpression(original) ||
    !ts.isObjectLiteralExpression(visited)
  ) {
    return operationInputExpression(
      visited,
      original,
      siteId,
      plan.fallback,
      plan.argumentIndex,
      sourceFile,
      factory,
    );
  }

  const properties = visited.properties.map((property, index) => {
    const originalProperty = original.properties[index];
    if (!originalProperty) return property;
    const name = operationObjectPropertyName(originalProperty.name);
    const role = name ? plan.properties[name] : undefined;
    if (!role) return property;

    if (
      ts.isPropertyAssignment(originalProperty) &&
      ts.isPropertyAssignment(property)
    ) {
      return factory.updatePropertyAssignment(
        property,
        property.name,
        operationInputExpression(
          property.initializer,
          originalProperty.initializer,
          siteId,
          role,
          plan.argumentIndex,
          sourceFile,
          factory,
        ),
      );
    }
    if (
      ts.isShorthandPropertyAssignment(originalProperty) &&
      ts.isShorthandPropertyAssignment(property)
    ) {
      return factory.createPropertyAssignment(
        property.name,
        operationInputExpression(
          factory.createIdentifier(property.name.text),
          originalProperty.name,
          siteId,
          role,
          plan.argumentIndex,
          sourceFile,
          factory,
        ),
      );
    }
    return property;
  });
  return factory.updateObjectLiteralExpression(visited, properties);
}

function operationObjectPropertyName(
  name: ts.PropertyName | undefined,
): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
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
  parameterDefinitions: ParameterDefinitionMap,
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
      parameterDefinitions,
      sourceFile,
    )
      .map(target => {
        const derivative = derivativeOf(
          originalArgument,
          target,
          parameterDefinitions,
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

function collectExpressionTargets(
  expression: ts.Expression,
  argument: ParameterArgument,
  parameterDefinitions: ParameterDefinitionMap,
  sourceFile: ts.SourceFile,
): readonly SourceParameterTarget[] {
  const targets = new Map<string, SourceParameterTarget>();
  const add = (target: SourceParameterTarget): void => {
    const id = `${target.sourceRef.file}:${target.sourceRef.start}:${target.sourceRef.end}`;
    targets.set(id, {
      ...target,
      kind: target.kind ?? argument.kind,
      unit: target.unit ?? argument.unit,
    });
  };

  const visit = (node: ts.Node): void => {
    const definition = parameterDefinitions.get(
      sourceNodeKey(node.getStart(sourceFile), node.getEnd()),
    );
    if (definition) {
      add(definition);
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
  target: SourceParameterTarget,
  parameterDefinitions: ParameterDefinitionMap,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.Expression | undefined {
  if (matchesTarget(expression, target, parameterDefinitions, sourceFile)) {
    return factory.createNumericLiteral(1);
  }
  if (!containsTarget(expression, target, parameterDefinitions, sourceFile)) {
    return factory.createNumericLiteral(0);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return derivativeOf(
      expression.expression,
      target,
      parameterDefinitions,
      sourceFile,
      factory,
    );
  }
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return derivativeOf(
      expression.expression,
      target,
      parameterDefinitions,
      sourceFile,
      factory,
    );
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    const operand = derivativeOf(
      expression.operand,
      target,
      parameterDefinitions,
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
      return negateNumericExpression(operand, factory);
    }
    return undefined;
  }
  if (!ts.isBinaryExpression(expression)) {
    return undefined;
  }

  const leftDerivative = derivativeOf(
    expression.left,
    target,
    parameterDefinitions,
    sourceFile,
    factory,
  );
  const rightDerivative = derivativeOf(
    expression.right,
    target,
    parameterDefinitions,
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
      return combineNumericExpressions(
        leftDerivative,
        rightDerivative,
        'add',
        factory,
      );
    case ts.SyntaxKind.MinusToken:
      return combineNumericExpressions(
        leftDerivative,
        rightDerivative,
        'subtract',
        factory,
      );
    case ts.SyntaxKind.AsteriskToken:
      return combineNumericExpressions(
        combineNumericExpressions(leftDerivative, right, 'multiply', factory),
        combineNumericExpressions(left, rightDerivative, 'multiply', factory),
        'add',
        factory,
      );
    case ts.SyntaxKind.SlashToken:
      return combineNumericExpressions(
        combineNumericExpressions(
          combineNumericExpressions(leftDerivative, right, 'multiply', factory),
          combineNumericExpressions(left, rightDerivative, 'multiply', factory),
          'subtract',
          factory,
        ),
        combineNumericExpressions(right, right, 'multiply', factory),
        'divide',
        factory,
      );
    default:
      return undefined;
  }
}

type NumericExpressionOperation = 'add' | 'subtract' | 'multiply' | 'divide';

function combineNumericExpressions(
  left: ts.Expression,
  right: ts.Expression,
  operation: NumericExpressionOperation,
  factory: ts.NodeFactory,
): ts.Expression {
  const leftValue = generatedNumericValue(left);
  const rightValue = generatedNumericValue(right);
  if (leftValue !== undefined && rightValue !== undefined) {
    const value =
      operation === 'add'
        ? leftValue + rightValue
        : operation === 'subtract'
          ? leftValue - rightValue
          : operation === 'multiply'
            ? leftValue * rightValue
            : leftValue / rightValue;
    if (Number.isFinite(value)) return createNumberExpression(value, factory);
  }
  if (operation === 'add') {
    if (leftValue === 0) return right;
    if (rightValue === 0) return left;
  } else if (operation === 'subtract') {
    if (rightValue === 0) return left;
    if (leftValue === 0) return negateNumericExpression(right, factory);
  } else if (operation === 'multiply') {
    if (leftValue === 0 || rightValue === 0) {
      return factory.createNumericLiteral(0);
    }
    if (leftValue === 1) return right;
    if (rightValue === 1) return left;
  } else if (leftValue === 0) {
    return factory.createNumericLiteral(0);
  } else if (rightValue === 1) {
    return left;
  }
  const token =
    operation === 'add'
      ? ts.SyntaxKind.PlusToken
      : operation === 'subtract'
        ? ts.SyntaxKind.MinusToken
        : operation === 'multiply'
          ? ts.SyntaxKind.AsteriskToken
          : ts.SyntaxKind.SlashToken;
  return factory.createBinaryExpression(left, token, right);
}

function negateNumericExpression(
  expression: ts.Expression,
  factory: ts.NodeFactory,
): ts.Expression {
  const value = generatedNumericValue(expression);
  return value === undefined
    ? factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, expression)
    : createNumberExpression(-value, factory);
}

function generatedNumericValue(expression: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return -Number(expression.operand.text);
  }
  return undefined;
}

function containsTarget(
  node: ts.Node,
  target: SourceParameterTarget,
  parameterDefinitions: ParameterDefinitionMap,
  sourceFile: ts.SourceFile,
): boolean {
  if (matchesTarget(node, target, parameterDefinitions, sourceFile)) {
    return true;
  }
  let contains = false;
  ts.forEachChild(node, child => {
    if (
      !contains &&
      containsTarget(child, target, parameterDefinitions, sourceFile)
    ) {
      contains = true;
    }
  });
  return contains;
}

function matchesTarget(
  node: ts.Node,
  target: SourceParameterTarget,
  parameterDefinitions: ParameterDefinitionMap,
  sourceFile: ts.SourceFile,
): boolean {
  const definition = parameterDefinitions.get(
    sourceNodeKey(node.getStart(sourceFile), node.getEnd()),
  );
  if (definition) return sameSourceRef(definition.sourceRef, target.sourceRef);
  return (
    node.getStart(sourceFile) === target.sourceRef.start &&
    node.getEnd() === target.sourceRef.end &&
    normalizeProjectPath(sourceFile.fileName) === target.sourceRef.file
  );
}

function createRuntimeTarget(
  target: SourceParameterTarget,
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

function toolCallSite(
  node: ts.CallExpression,
  siteId: string,
  signature: ToolSignatureSchema,
  sourceFile: ts.SourceFile,
): ToolCallSite {
  const sourceStart = ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.getStart(sourceFile)
    : node.expression.getStart(sourceFile);
  return {
    siteId,
    sourceRef: sourceRef(sourceFile.fileName, sourceStart, node.getEnd()),
    signature,
    arguments: signature.parameters.flatMap(parameter => {
      const target = toolArgumentSource(node, parameter.index, sourceFile);
      return target
        ? [{name: parameter.name, index: parameter.index, target}]
        : [];
    }),
  };
}

function toolArgumentSource(
  call: ts.CallExpression,
  index: number,
  sourceFile: ts.SourceFile,
): ToolArgumentSource['target'] | undefined {
  const argument = call.arguments[index];
  if (argument) {
    const previous = call.arguments[index - 1];
    const next = call.arguments[index + 1];
    const removalStart = previous
      ? previous.getEnd()
      : argument.getStart(sourceFile);
    const removalEnd = previous
      ? argument.getEnd()
      : next
        ? next.getStart(sourceFile)
        : argument.getEnd();
    return {
      kind: 'present',
      sourceRef: sourceRef(
        sourceFile.fileName,
        argument.getStart(sourceFile),
        argument.getEnd(),
      ),
      removalSourceRef: sourceRef(
        sourceFile.fileName,
        removalStart,
        removalEnd,
      ),
    };
  }
  if (index !== call.arguments.length) return undefined;
  const closeParen = call.getEnd() - 1;
  return {
    kind: 'omitted',
    sourceRef: sourceRef(sourceFile.fileName, closeParen, closeParen),
    needsComma: call.arguments.length > 0 && !call.arguments.hasTrailingComma,
  };
}

function parameterSignatureFor(
  schema: ToolSignatureSchema,
): ParameterSignature | undefined {
  const numericParameters = schema.parameters.filter(
    (
      parameter,
    ): parameter is typeof parameter & Readonly<{kind: ParameterKind}> =>
      !isToolSelectionParameter(parameter),
  );
  if (numericParameters.length === 0) return undefined;
  const lastIndex = Math.max(
    ...numericParameters.map(parameter => parameter.index),
  );
  const arguments_: Array<ParameterArgument | undefined> = Array.from({
    length: lastIndex + 1,
  });
  numericParameters.forEach(parameter => {
    arguments_[parameter.index] = {
      name: parameter.name,
      label: parameter.label,
      kind: parameter.kind,
    };
  });
  return {operation: schema.name, arguments: arguments_};
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

function sourceRef(file: string, start: number, end: number): SourceRef {
  return {file: normalizeProjectPath(file), start, end};
}

function sameSourceRef(left: SourceRef, right: SourceRef): boolean {
  return (
    left.file === right.file &&
    left.start === right.start &&
    left.end === right.end
  );
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
