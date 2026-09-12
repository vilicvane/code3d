import type {CompilationProgress} from './compilation-progress';
import type * as CoreTooling from '@code3d/core/tooling';
import {
  isTopologyId,
  sameTopologyId,
  TopologyIdSet,
  type RelationExpression,
  type RelationPreview,
  type EdgeId,
  type ElementKind,
  type ElementSnapshot,
  type ModelObject,
  type ModelOperationInputRole,
  type ModelOperationSnapshot,
  type ModelSnapshotObject,
  type ParameterTarget,
  type ParameterUsage,
  type RelationObject,
  type Sketch,
  type SourceRef,
  type TopologyId,
  type Transform,
} from '@code3d/core/tooling';
import {normalizeProjectPath} from '../project/project';
import {sketchSourceDiagnostics} from '../tools/sketch-diagnostics';
import {evaluatedConstraint, focusedConstraintSide} from './constraint-context';
import {
  diagnosticFromError as describeError,
  locateModelError as locateError,
  type ModelDiagnostic,
} from './diagnostic';
import {ModuleEvaluator, type ModuleExports} from './module-evaluator';
import {isCompositionInputRole} from './operation-context';
import {SketchTraceRegistry} from './sketch-trace';
import {isToolSelectionParameter} from './tool-parameter-config';
import type {
  ToolSelectionParameterSchema,
  ToolSignatureSchema,
} from './tool-schema';

import type {
  AnchorValueReference,
  CompiledModelSource,
  DesignArgumentContext,
  EvaluationContext,
  ModelModule,
  ObjectCatalogEntry,
  RuntimeReach,
  SourceTarget,
  SourceTargetEvaluation,
  ToolCallSite,
  TopologyValueReference,
} from './compiler';
import {sourceRef} from './source-location';
type RuntimeParameterTarget = Readonly<{
  target: ParameterTarget;
  sensitivity: number;
}>;

type CatalogTrace = {
  id: string;
  label: string;
  category: ObjectCatalogEntry['category'];
  scope: ObjectCatalogEntry['scope'];
  sourceRef: SourceRef;
  objects: Set<RelationObject>;
  runs: Array<
    Readonly<{
      order: number;
      objects: readonly RelationObject[];
    }>
  >;
};

type SourceValueTrace = {
  id: string;
  kind: 'value' | 'operation-output';
  sourceRef: SourceRef;
  /** A parameter can inspect relations constructed in its function body. */
  scopeRef?: SourceRef;
  evaluations: Array<
    Readonly<{
      objects: readonly RelationObject[];
      isCollection: boolean;
      sketches: readonly Sketch[];
      topologyReferences: readonly TopologyValueReference[];
      anchorReferences: readonly AnchorValueReference[];
      contextId: string;
      runtime: RuntimeReach;
    }>
  >;
};

type SourceInputTrace = Readonly<{
  id: string;
  siteId: string;
  execution: number;
  sourceRef: SourceRef;
  isCollection: boolean;
  objects: readonly RelationObject[];
  contextId: string;
  runtime: RuntimeReach;
}>;

type SourceConstraintTrace = {
  id: string;
  sourceRef: SourceRef;
  evaluations: Array<
    Readonly<{
      constraintId: string;
      source: RelationObject;
      target: RelationObject;
      self?: RelationObject;
      expression: RelationExpression;
      contextId: string;
      runtime: RuntimeReach;
    }>
  >;
};

type SourceTransformationTrace = {
  id: string;
  sourceRef: SourceRef;
  evaluations: Array<
    Readonly<{
      transformationId: string;
      self: RelationObject;
      expression: RelationExpression;
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
      model: RelationObject;
      name: string;
      kind: ElementKind;
      transform: Transform;
      topology?: TopologyValueReference;
      bound?: ElementSnapshot['bound'];
      facing?: 1 | -1;
      direction?: 1 | -1;
      contextId: string;
      runtime: RuntimeReach;
    }>
  >;
};

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
  relationSelf?: RelationObject;
  inputs: SourceInputTrace[];
  failure?: ModelDiagnostic;
};

export function createModelExecutor(
  runtime: typeof CoreTooling,
  evaluator = new ModuleEvaluator(),
) {
  const {
    beginModelEvaluation,
    relationTraceReference,
    relationPreview,
    currentRelationSelf,
    relationSelectionPreview,
    createModelSnapshotter,
    instrumentRelation,
    instrumentModelOperation,
    isRelationExpression,
    isModelObject,
    isSketch,
    sketchFrame,
    modelElementReference,
    modelObjectRuntimeInfo,
    modelTopologyReference,
    modelTopologyIds,
    relatedModelObjects,
  } = runtime;
  const diagnosticFromError = (error: unknown) =>
    describeError(error, 'evaluation', runtime.describeOpenCascadeException);
  const locateModelError = (error: unknown, source: SourceRef) =>
    locateError(
      error,
      source,
      'evaluation',
      runtime.describeOpenCascadeException,
    );
  const tracedObjects = new Set<RelationObject>();
  const sketches = new SketchTraceRegistry(runtime);
  const sourceValueTraces = new Map<string, SourceValueTrace>();
  const sourceConstraintTraces = new Map<string, SourceConstraintTrace>();
  const sourceTransformationTraces = new Map<
    string,
    SourceTransformationTrace
  >();
  const sourceElementTraces = new Map<string, SourceElementTrace>();
  let edgeSelectionSites: CompiledModelSource['edgeSelectionSites'] = new Map();
  let toolCallSites: CompiledModelSource['toolCallSites'] = new Map();
  let relationCallSites: CompiledModelSource['relationCallSites'] = new Map();
  let relationArraySites: CompiledModelSource['relationArraySites'] = [];
  const sourceExecutionTraces = new Map<string, SourceExecutionTrace>();
  const catalogTraces = new Map<string, CatalogTrace>();
  const parameterFrames: ParameterUsage[][] = [];
  const traceFrames: TraceFrame[] = [];
  const traceExecutionCounts = new Map<string, number>();
  const evaluationContexts = new Map<string, EvaluationContext>();
  const designContextFrames: EvaluationContext[] = [];
  let latestTracedObject: ModelObject | undefined;
  let evaluationOrder = 0;
  let sourceReachOrder = 0;
  const traceRuntime = Object.freeze({
    trace<T>(
      file: string,
      start: number,
      end: number,
      callStart: number,
      callEnd: number,
      id: string,
      label: string,
      run: () => T,
    ): T {
      const execution = nextTraceExecution(id);
      const location = sourceRef(file, start, end);
      const callLocation = sourceRef(file, callStart, callEnd);
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
        relationSelf: currentRelationSelf(),
      };
      if (executionTrace.relationSelf)
        tracedObjects.add(executionTrace.relationSelf);
      sourceExecutionTraces.set(
        traceExecutionKey(id, execution),
        executionTrace,
      );
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
          sketches.constraintErrorSource(error, location) ?? callLocation,
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
      sketches.call(
        result,
        traceExecutionKey(id, execution),
        location,
        executionTrace.arguments.get(0),
        executionTrace.arguments.get(1),
        executionTrace.receiver,
      );
      if (isRelationExpression(result)) {
        instrumentRelation(result, location, parameters);
        recordSourceConstraint(id, location, result, context.id, runtime);
      } else if (
        isModelObject(result) ||
        (Array.isArray(result) &&
          result.length > 0 &&
          result.every(isModelObject))
      ) {
        const order = ++evaluationOrder;
        for (const [outputIndex, object] of (isModelObject(result)
          ? [result]
          : (result as ModelObject[])
        ).entries())
          instrumentModelOperation(object, {
            siteId: id,
            execution,
            outputIndex,
            order,
            sourceRef: location,
            parameters,
          });
        recordSourceValue(
          id,
          'operation-output',
          callLocation,
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
      if (isSketch(result))
        instrumentModelOperation(sketchFrame(result), {
          siteId: id,
          execution,
          order,
          sourceRef: location,
          parameters,
        });
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
      sketches.bind(result, location);
      if (isRelationExpression(result)) {
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

    parameterValue(
      file: string,
      start: number,
      end: number,
      scopeStart: number,
      scopeEnd: number,
      id: string,
      value: unknown,
    ): void {
      const location = sourceRef(file, start, end);
      const context =
        currentEvaluationContext() ??
        callEvaluationContext(
          id,
          nextTraceExecution(id),
          'parameter',
          location,
        );
      recordSourceValue(
        id,
        'value',
        location,
        value,
        context.id,
        completedRuntimeReach(),
        sourceRef(file, scopeStart, scopeEnd),
      );
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
      id: string,
      value: T,
    ): T {
      const executionTrace = traceFrames.at(-1)?.trace;
      if (executionTrace?.siteId !== siteId) {
        return value;
      }
      if (isSketch(value)) {
        recordSourceValue(
          id,
          'value',
          sourceRef(file, start, end),
          value,
          executionTrace.contextId,
          completedRuntimeReach(),
        );
        return value;
      }
      if (isRelationExpression(value)) {
        recordSourceConstraint(
          id,
          sourceRef(file, start, end),
          value,
          executionTrace.contextId,
          completedRuntimeReach(),
        );
        return value;
      }
      const objects = modelObjectsIn(value).filter(
        object =>
          !executionTrace.inputs.some(
            input =>
              input.sourceRef.file === normalizeProjectPath(file) &&
              start <= input.sourceRef.start &&
              input.sourceRef.end <= end &&
              input.objects.includes(object),
          ),
      );
      if (objects.length > 0) {
        objects.forEach(object => tracedObjects.add(object));
        executionTrace.inputs.push({
          id,
          siteId,
          execution: executionTrace.execution,
          sourceRef: sourceRef(file, start, end),
          isCollection: !isModelObject(value) && !modelElementReference(value),
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

    receiver<T>(
      file: string,
      start: number,
      end: number,
      siteId: string,
      id: string,
      value: T,
    ): T {
      const executionTrace = traceFrames.at(-1)?.trace;
      if (executionTrace?.siteId === siteId) {
        executionTrace.receiver = value;
        const reference = modelTopologyReference(value);
        const model = isModelObject(value)
          ? value
          : isRelationExpression(value)
            ? relationTraceReference(value).self
            : reference?.model;
        if (model) tracedObjects.add(model);
      }
      return traceRuntime.input(file, start, end, siteId, id, value);
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
        topology: topologyValueReference(value),
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
    scopeRef?: SourceRef,
  ): void {
    if (isRelationExpression(value)) {
      recordSourceConstraint(id, sourceRef, value, contextId, runtime);
      return;
    }
    const topologyReferences: TopologyValueReference[] = [];
    const anchorReferences: AnchorValueReference[] = [];
    const objects = modelObjectsIn(
      value,
      new Set(),
      topologyReferences,
      anchorReferences,
    );
    const sketchValues = runtimeSketchValues(value);
    if (objects.length === 0 && sketchValues.length === 0) {
      return;
    }
    const key = `${kind}:${id}:${sourceRef.file}:${sourceRef.start}:${sourceRef.end}`;
    const sourceTrace = sourceValueTraces.get(key) ?? {
      id,
      kind,
      sourceRef,
      scopeRef,
      evaluations: [],
    };
    sourceTrace.evaluations.push({
      objects,
      sketches: sketchValues,
      isCollection:
        !isModelObject(value) &&
        sketchValues.length === 0 &&
        !modelElementReference(value),
      topologyReferences,
      anchorReferences,
      contextId,
      runtime,
    });
    objects.forEach(object => {
      tracedObjects.add(object);
      if (
        isModelObject(object) &&
        evaluationContexts.get(contextId)?.kind === 'call'
      ) {
        latestTracedObject = object;
      }
    });
    sourceValueTraces.set(key, sourceTrace);
  }

  function runtimeSketchValues(value: unknown): Sketch[] {
    if (runtime.isSketch(value)) {
      sketches.identity(value);
      return [value];
    }
    return [];
  }

  function recordSourceConstraint(
    id: string,
    location: SourceRef,
    constraint: RelationExpression,
    contextId: string,
    runtime: RuntimeReach,
  ): void {
    const reference = relationTraceReference(constraint);
    if (reference.kind === 'transformation') {
      if (!reference.self) return;
      const key = `${id}:${location.file}:${location.start}:${location.end}`;
      const trace = sourceTransformationTraces.get(key) ?? {
        id,
        sourceRef: location,
        evaluations: [],
      };
      trace.evaluations.push({
        transformationId: reference.transformationId,
        self: reference.self,
        expression: constraint,
        contextId,
        runtime,
      });
      sourceTransformationTraces.set(key, trace);
      tracedObjects.add(reference.self);
      return;
    }
    const key = `${id}:${location.file}:${location.start}:${location.end}`;
    const trace = sourceConstraintTraces.get(key) ?? {
      id,
      sourceRef: location,
      evaluations: [],
    };
    trace.evaluations.push({
      ...reference,
      expression: constraint,
      contextId,
      runtime,
    });
    sourceConstraintTraces.set(key, trace);
    tracedObjects.add(reference.source);
    tracedObjects.add(reference.target);
  }

  function precedingRelations(
    site: Pick<ToolCallSite, 'relationPredecessors'> | undefined,
    self: RelationObject | undefined,
    order: number,
    contextId?: string,
  ): RelationExpression[] {
    if (!self) return [];
    const traces = [
      ...sourceConstraintTraces.values(),
      ...sourceTransformationTraces.values(),
    ];
    return (site?.relationPredecessors ?? []).flatMap(reference => {
      const previous = traces
        .filter(
          trace =>
            trace.sourceRef.file === reference.file &&
            trace.sourceRef.start >= reference.start &&
            trace.sourceRef.end === reference.end,
        )
        .flatMap(trace =>
          trace.evaluations.map(value => ({
            expression: value.expression,
            self: value.self,
            order: value.runtime.order,
            contextId: value.contextId,
          })),
        )
        .filter(
          value =>
            value.self === self &&
            (contextId === undefined
              ? value.order < order
              : value.contextId === contextId),
        )
        .sort((a, b) => b.order - a.order)[0];
      return previous ? [previous.expression] : [];
    });
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
      objects: new Set<RelationObject>(),
      runs: [],
    };
    objects.forEach(object => trace.objects.add(object));
    trace.runs.push({order, objects});
    catalogTraces.set(metadata.id, trace);
  }

  function topologyValueReference(
    value: unknown,
  ): TopologyValueReference | undefined {
    const reference = modelTopologyReference(value);
    if (!reference) return undefined;
    tracedObjects.add(reference.geometry);
    const common = {
      nodeId: modelObjectNodeId(reference.model),
      name: modelElementReference(value)!.name,
      geometryNodeId: modelObjectNodeId(reference.geometry),
      transform: reference.transform,
    };
    return reference.kind === 'solid'
      ? {...common, kind: 'solid'}
      : {...common, kind: reference.kind, id: reference.id};
  }

  function modelObjectsIn(
    value: unknown,
    seen = new Set<unknown>(),
    topologyReferences?: TopologyValueReference[],
    anchorReferences?: AnchorValueReference[],
  ): RelationObject[] {
    if (isModelObject(value)) {
      return [value];
    }
    if (isRelationExpression(value)) {
      const self = relationTraceReference(value).self;
      return self ? [self] : [];
    }
    const topology = modelTopologyReference(value);
    if (topology) {
      const nodeId = modelObjectNodeId(topology.model);
      const ownerRecorded =
        topologyReferences?.some(reference => reference.nodeId === nodeId) ||
        anchorReferences?.some(reference => reference.nodeId === nodeId);
      topologyReferences?.push(topologyValueReference(value)!);
      tracedObjects.add(topology.geometry);
      return ownerRecorded ? [] : [topology.model];
    }
    const anchor = modelElementReference(value);
    if (anchor) {
      const nodeId = modelObjectNodeId(anchor.model);
      const ownerRecorded =
        anchorReferences?.some(reference => reference.nodeId === nodeId) ||
        topologyReferences?.some(reference => reference.nodeId === nodeId);
      anchorReferences?.push({
        nodeId,
        name: anchor.name,
        kind: anchor.kind,
        transform: anchor.transform,
        bound: anchor.bound,
        facing: anchor.facing,
        direction: anchor.direction,
      });
      return ownerRecorded ? [] : [anchor.model];
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) {
      return [];
    }
    seen.add(value);
    if (value instanceof Map) {
      return [...Map.prototype.values.call(value)].flatMap(item =>
        modelObjectsIn(item, seen, topologyReferences, anchorReferences),
      );
    }
    if (value instanceof Set) {
      return [...Set.prototype.values.call(value)].flatMap(item =>
        modelObjectsIn(item, seen, topologyReferences, anchorReferences),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (
      Array.isArray(value) ||
      prototype === Object.prototype ||
      prototype === null
    ) {
      // Observing a value must not invoke author-defined accessors.
      return Object.values(Object.getOwnPropertyDescriptors(value)).flatMap(
        property =>
          property.enumerable && 'value' in property
            ? modelObjectsIn(
                property.value,
                seen,
                topologyReferences,
                anchorReferences,
              )
            : [],
      );
    }
    return [];
  }

  async function execute(
    artifact: CompiledModelSource,
    runtimeModules: ReadonlyMap<string, ModuleExports>,
    importModule: (path: string) => Promise<ModuleExports>,
    assetUrl: (path: string) => string,
    onProgress?: CompilationProgress,
    captureGeometry?: (objects: readonly RelationObject[]) => void,
    checkCancelled: () => void = () => {},
    prepareSnapshots?: (objects: readonly RelationObject[]) => Promise<void>,
  ): Promise<ModelModule> {
    const {rootPath, files, designArguments, activeDesignContext} = artifact;
    tracedObjects.clear();
    sourceValueTraces.clear();
    sourceConstraintTraces.clear();
    sourceTransformationTraces.clear();
    sourceElementTraces.clear();
    edgeSelectionSites = artifact.edgeSelectionSites;
    toolCallSites = artifact.toolCallSites;
    relationCallSites = artifact.relationCallSites;
    relationArraySites = artifact.relationArraySites;
    sourceExecutionTraces.clear();
    catalogTraces.clear();
    parameterFrames.length = 0;
    traceFrames.length = 0;
    traceExecutionCounts.clear();
    evaluationContexts.clear();
    designContextFrames.length = 0;
    latestTracedObject = undefined;
    evaluationOrder = 0;
    sourceReachOrder = 0;
    sketches.begin(artifact.sketches);
    let finishEvaluation: (() => void) | undefined;
    try {
      let modules = new Map<string, Record<string, unknown>>();
      let diagnostic: ModelDiagnostic | undefined;
      try {
        onProgress?.('evaluating-model');
        checkCancelled();
        finishEvaluation = beginModelEvaluation(checkCancelled);
        const result = await evaluator.evaluate(artifact.source, {
          __code3d: traceRuntime,
          __code3dAssetUrl: assetUrl,
          __code3dCachedFunction: runtime.identifyCachedFunction,
          __code3dModules: runtimeModules,
          __code3dImport: importModule,
          __code3dImportDependencies: async (paths: string[]) => {
            for (const path of paths) await importModule(path);
          },
          __code3dRecordModule: (path: string, namespace: ModuleExports) =>
            modules.set(path, namespace),
        });
        for (const [path, namespace] of result.modules)
          modules.set(path, namespace);
      } catch (error) {
        checkCancelled();
        diagnostic = diagnosticFromError(error);
      }

      checkCancelled();
      const modelExports = new Map<string, RelationObject>();
      const exportNamesByObject = new Map<RelationObject, Set<string>>();
      for (const [modulePath, module] of modules) {
        for (const [name, value] of Object.entries(module)) {
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
      if (diagnostic) {
        diagnostic = relateDiagnostic(diagnostic, fallbackObject);
      }

      onProgress?.('preparing-preview');
      const graphObjects = collectObjectGraph([
        ...tracedObjects,
        ...sketches.frames(),
      ]);
      graphObjects.forEach(object => tracedObjects.add(object));
      await prepareSnapshots?.(
        fallbackObject && !graphObjects.includes(fallbackObject)
          ? [fallbackObject, ...graphObjects]
          : graphObjects,
      );
      checkCancelled();
      const snapshotModel = createModelSnapshotter();
      const snapshots = new Map<RelationObject, ModelSnapshotObject>();
      const snapshotOf = (object: RelationObject): ModelSnapshotObject => {
        checkCancelled();
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
      captureGeometry?.(graphObjects);
      const sketchSnapshots = sketches.snapshots();
      return {
        sketches: sketchSnapshots,
        warnings: sketchSourceDiagnostics(sketchSnapshots, artifact.sketches),
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
        sourceTargets: buildSourceTargets(
          operations,
          objectSnapshots,
          [
            ...designArguments,
            ...(activeDesignContext ? [activeDesignContext] : []),
          ],
          files,
        ),
        evaluationContexts: [...evaluationContexts.values()],
        designArguments: designArguments.map(
          ({
            binding: _binding,
            argumentsSource: _argumentsSource,
            ...context
          }) => context,
        ),
        activeDesignContextId: activeDesignContext?.id,
      };
    } finally {
      // Installed modules may retain model values (including private memoized
      // values). Drop this evaluation's references; Replicad's native wrappers
      // release shapes when their actual owners become unreachable.
      finishEvaluation?.();
      tracedObjects.clear();
      sourceValueTraces.clear();
      sketches.clear();
      sourceConstraintTraces.clear();
      sourceTransformationTraces.clear();
      sourceElementTraces.clear();
      edgeSelectionSites = new Map();
      toolCallSites = new Map();
      relationCallSites = new Map();
      relationArraySites = [];
      sourceExecutionTraces.clear();
      catalogTraces.clear();
      parameterFrames.length = 0;
      traceFrames.length = 0;
      traceExecutionCounts.clear();
      evaluationContexts.clear();
      designContextFrames.length = 0;
      latestTracedObject = undefined;
      evaluationOrder = 0;
      sourceReachOrder = 0;
    }
  }

  function collectObjectGraph(
    roots: Iterable<RelationObject>,
  ): RelationObject[] {
    const found = new Set<RelationObject>();
    const visit = (object: RelationObject): void => {
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

  function modelObjectNodeId(object: RelationObject): string {
    return modelObjectRuntimeInfo(object).nodeId;
  }

  function modelObjectName(object: RelationObject): string {
    return modelObjectRuntimeInfo(object).name;
  }

  function modelObjectSourceRefs(object: RelationObject): readonly SourceRef[] {
    return modelObjectRuntimeInfo(object).sourceRefs;
  }

  function relateDiagnostic(
    diagnostic: ModelDiagnostic,
    fallback: RelationObject | undefined,
  ): ModelDiagnostic {
    if (diagnostic.kind !== 'evaluation') return diagnostic;
    const failures = [...sourceExecutionTraces.values()].filter(
      execution => execution.failure === diagnostic,
    );
    const failedEvaluationIds = failures.map(execution =>
      traceExecutionKey(execution.siteId, execution.execution),
    );
    const failureInputs = failures.flatMap(execution => [
      ...execution.inputs.flatMap(input => input.objects),
      ...modelObjectsIn(execution.receiver),
    ]);
    const fallbackNodeIds = new Set(
      collectObjectGraph(fallback ? [fallback] : []).map(modelObjectNodeId),
    );
    const relatedModelNodeIds = [
      ...new Set(
        collectObjectGraph(failureInputs)
          .map(modelObjectNodeId)
          .filter(nodeId => fallbackNodeIds.has(nodeId)),
      ),
    ];
    return {
      ...diagnostic,
      ...(failedEvaluationIds.length ? {failedEvaluationIds} : {}),
      ...(relatedModelNodeIds.length ? {relatedModelNodeIds} : {}),
    };
  }

  function buildSourceTargets(
    operations: ReadonlyMap<string, ModelOperationSnapshot>,
    objects: ReadonlyMap<string, ModelSnapshotObject>,
    designArguments: readonly Pick<
      DesignArgumentContext,
      'functionId' | 'functionRef'
    >[],
    files: ReadonlyMap<string, string>,
  ): SourceTarget[] {
    const operationsByCall = new Map<string, ModelOperationSnapshot[]>();
    for (const operation of operations.values()) {
      if (operation.siteId === undefined || operation.execution === undefined)
        continue;
      const key = traceExecutionKey(operation.siteId, operation.execution);
      const siblings = operationsByCall.get(key) ?? [];
      siblings.push(operation);
      operationsByCall.set(key, siblings);
    }
    const operationsByOutputNodeId = new Map(
      [...operations.values()].map(operation => [
        operation.outputNodeId,
        operation,
      ]),
    );
    const sourceInputTraces = [...sourceExecutionTraces.values()].flatMap(
      execution => execution.inputs,
    );
    const parameterScopes = new Map<string, SourceRef>(
      [...sourceValueTraces.values()].flatMap(trace =>
        trace.scopeRef
          ? [[`source:${trace.kind}:${trace.id}`, trace.scopeRef] as const]
          : [],
      ),
    );
    const valueTargets = [...sourceValueTraces.values()].map(trace => {
      const toolSite = toolCallSites.get(trace.id);
      const evaluations = trace.evaluations.map(
        ({
          objects,
          isCollection,
          sketches: sketchValues,
          topologyReferences,
          anchorReferences,
          contextId,
          runtime,
        }) => {
          const nodeIds = objects.map(modelObjectNodeId);
          const operationId = [...operations.values()].find(
            operation =>
              operation.siteId === trace.id &&
              nodeIds.includes(operation.outputNodeId),
          )?.id;
          return {
            isCollection,
            runtime,
            nodeIds,
            sketchIds: sketchValues.map(value => sketches.identity(value)),
            topologyReferences,
            anchorReferences,
            focusNodeIds:
              topologyReferences.length + anchorReferences.length > 0
                ? nodeIds
                : undefined,
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
    const failedInputCollections = new Map(
      [...sourceExecutionTraces.values()].flatMap(execution => {
        if (execution.outcome !== 'failed') return [];
        const inputs = [
          ...new Set(execution.inputs.flatMap(input => input.objects)),
        ];
        return inputs.length > 1
          ? [
              [
                traceExecutionKey(execution.siteId, execution.execution),
                inputs,
              ] as const,
            ]
          : [];
      }),
    );
    for (const trace of sourceInputTraces) {
      const callId = traceExecutionKey(trace.siteId, trace.execution);
      const callOperations = operationsByCall.get(callId) ?? [];
      const nodeIds = trace.objects.map(modelObjectNodeId);
      const matchingOperations = callOperations.filter(operation =>
        operation.inputs.some(input => nodeIds.includes(input.nodeId)),
      );
      const operation = matchingOperations[0];
      const inputs = matchingOperations.flatMap(operation =>
        operation.inputs.filter(input => nodeIds.includes(input.nodeId)),
      );
      const key = trace.id;
      const target: MutableSourceInputTarget = inputTargets.get(key) ?? {
        id: `source:operation-input:${key}`,
        sourceRef: trace.sourceRef,
        evaluations: [],
      };
      // Roles belong to the runtime operation, independent of the callee's spelling.
      const roles = new Set(inputs.map(input => input.role));
      const role =
        inputs.length === 0
          ? undefined
          : roles.size === 1
            ? inputs[0].role
            : 'collection';
      if (operation && role) target.operation = {kind: operation.kind, role};
      if (
        (isCompositionInputRole(role) || failedInputCollections.has(callId)) &&
        !valueTargets.some(
          value =>
            value.tool &&
            value.sourceRef.file === trace.sourceRef.file &&
            value.sourceRef.start === trace.sourceRef.start &&
            value.sourceRef.end === trace.sourceRef.end,
        )
      )
        target.tool = sourceTool(toolCallSites.get(trace.siteId));
      target.evaluations.push({
        callId,
        collection: failedInputCollections.get(callId),
        parameters: sourceExecutionTraces.get(callId)?.parameters,
        toolExecutionOrder: sourceExecutionTraces.get(callId)?.order,
        operationId: role ? operation?.id : undefined,
        role,
        objects: role
          ? trace.objects.filter(object =>
              inputs.some(input => input.nodeId === modelObjectNodeId(object)),
            )
          : trace.objects,
        isCollection: role ? undefined : trace.isCollection,
        contextId: trace.contextId,
        runtime: trace.runtime,
      });
      inputTargets.set(key, target);
    }

    const operationInputTargets = [...inputTargets.values()];

    function compositionConsumers(
      nodeIds: readonly string[],
      inlineSource?: SourceRef,
    ) {
      return operationInputTargets
        .filter(
          target =>
            !inlineSource ||
            (target.sourceRef.file === inlineSource.file &&
              target.sourceRef.start <= inlineSource.start &&
              target.sourceRef.end >= inlineSource.end),
        )
        .flatMap(target =>
          target.evaluations.flatMap(input => {
            if (
              !(input.role && isCompositionInputRole(input.role)) &&
              !(inlineSource && input.collection)
            )
              return [];
            const consumedNodeIds = input.objects
              .map(modelObjectNodeId)
              .filter(nodeId =>
                nodeIds.some(sourceNodeId =>
                  inlineSource
                    ? nodeId === sourceNodeId
                    : sourceLineageContains(
                        operationsByOutputNodeId,
                        nodeId,
                        sourceNodeId,
                      ),
                ),
              );
            return consumedNodeIds.length > 0
              ? [
                  {
                    runtime: input.runtime,
                    collectionNodeIds: input.collection?.map(modelObjectNodeId),
                    operationInput: input.role
                      ? {
                          operationId: input.operationId!,
                          role: input.role,
                          nodeIds: consumedNodeIds,
                        }
                      : undefined,
                  },
                ]
              : [];
          }),
        );
    }

    function compositionContextTargets(
      evaluations: readonly SourceTargetEvaluation[],
    ) {
      const operationIds = new Set(
        evaluations.flatMap(evaluation => {
          if (!evaluation.operationInput) return [];
          const operation = operations.get(
            evaluation.operationInput.operationId,
          )!;
          return operation.siteId !== undefined &&
            operation.execution !== undefined
            ? (
                operationsByCall.get(
                  traceExecutionKey(operation.siteId, operation.execution),
                ) ?? []
              ).map(operation => operation.id)
            : [operation.id];
        }),
      );
      return operationInputTargets
        .filter(target =>
          target.evaluations.some(
            evaluation =>
              evaluation.operationId !== undefined &&
              operationIds.has(evaluation.operationId),
          ),
        )
        .map(target => target.id);
    }

    function withOperationContext(target: SourceTarget): SourceTarget {
      if (
        target.kind !== 'operation-output' &&
        target.kind !== 'topology-selection'
      )
        return target;
      const evaluations = target.evaluations.flatMap(evaluation => {
        if (evaluation.constraintId || !evaluation.operationId)
          return [evaluation];
        const operation = operations.get(evaluation.operationId)!;
        const spatial =
          operation.spatial ||
          operation.kind === 'scaled' ||
          operation.kind === 'relate';
        // Inline constructors keep their numeric tools while inheriting the
        // surrounding call's composition. Separate definitions stay standalone.
        const consumers = compositionConsumers(
          evaluation.nodeIds,
          spatial ? undefined : target.sourceRef,
        );
        if (operation.kind === 'relate') {
          const owner = objects.get(operation.outputNodeId)!;
          const source = operation.inputs.find(
            input => input.role === 'source',
          );
          const inheritedIds = new Set(
            objects.get(source?.nodeId ?? '')?.constraints.map(c => c.id),
          );
          const referenceNodeIds = [
            ...new Set(
              operation.inputs
                .filter(input => input.role === 'reference')
                .map(input => input.nodeId),
            ),
          ].filter(nodeId => !evaluation.nodeIds.includes(nodeId));
          evaluation = {
            ...evaluation,
            focusNodeIds: evaluation.nodeIds,
            nodeIds: [...evaluation.nodeIds, ...referenceNodeIds],
            relationOwnerNodeId: owner.nodeId,
            relationContext: {
              constraintIds: owner.constraints
                .filter(constraint => !inheritedIds.has(constraint.id))
                .map(constraint => constraint.id),
              referenceNodeIds,
            },
          };
        }
        return consumers.length > 0
          ? consumers.map(consumer => ({
              ...evaluation,
              runtime: consumer.runtime,
              toolExecutionOrder:
                evaluation.toolExecutionOrder ?? evaluation.runtime.order,
              operationInput: consumer.operationInput,
              nodeIds: consumer.collectionNodeIds ?? evaluation.nodeIds,
              isCollection: consumer.collectionNodeIds
                ? true
                : evaluation.isCollection,
              focusNodeIds: evaluation.focusNodeIds ?? evaluation.nodeIds,
            }))
          : [evaluation];
      });
      return {
        ...target,
        evaluations,
        contextTargetIds: [
          ...new Set([
            ...target.contextTargetIds,
            ...compositionContextTargets(evaluations),
          ]),
        ],
      };
    }
    const operationSelectionTargets = [...edgeSelectionSites.values()].flatMap(
      site => {
        const evaluations = [
          ...sourceExecutionTraces.values(),
        ].flatMap<SourceTargetEvaluation>(execution => {
          if (execution.siteId !== site.siteId) {
            return [];
          }
          const sourceObject = execution.receiver;
          if (!isModelObject(sourceObject)) return [];
          const operation = operationsByCall.get(
            traceExecutionKey(execution.siteId, execution.execution),
          )?.[0];
          const selection = operation?.selections.find(
            candidate =>
              candidate.kind === 'edge' &&
              candidate.inputNodeId === modelObjectNodeId(sourceObject),
          );
          if (operation && selection) {
            return [
              {
                runtime: sourceExecutionRuntime(execution),
                nodeIds: [operation.outputNodeId],
                parameters: execution.parameters,
                operationId: operation.id,
                contextId: execution.contextId,
                selection: {
                  kind: 'edges',
                  inputNodeId: selection.inputNodeId,
                  ids: selection.ids,
                  scope: {
                    geometryNodeId: selection.inputNodeId,
                    transform: selection.transform,
                    availableIds: modelTopologyIds(sourceObject, 'edge')!,
                  },
                },
              },
            ];
          }
          const input = sourceObject;
          const inputSnapshot = input
            ? objects.get(modelObjectNodeId(input))
            : undefined;
          if (
            execution.outcome !== 'failed' ||
            inputSnapshot?.kind !== 'solid'
          ) {
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
    const topologySelectionTargets = [...toolCallSites.values()].flatMap(
      site => {
        if (edgeSelectionSites.has(site.siteId)) return [];
        const parameter = site.signature.parameters.find(
          (candidate): candidate is ToolSelectionParameterSchema =>
            isToolSelectionParameter(candidate),
        );
        if (!parameter) return [];
        const evaluations = [...sourceExecutionTraces.values()].flatMap(
          execution => {
            if (execution.siteId !== site.siteId) return [];
            const returned = [...sourceTransformationTraces.values()]
              .filter(trace => trace.id === execution.siteId)
              .flatMap(trace => trace.evaluations)
              .find(
                value =>
                  value.contextId === execution.contextId &&
                  value.runtime.order === execution.order,
              )?.expression;
            const receiver = [
              execution.receiver,
              returned,
              execution.relationSelf,
            ].find(
              value =>
                isModelObject(value) ||
                isRelationExpression(value) ||
                modelTopologyReference(value),
            );
            const reference = modelTopologyReference(receiver);
            const owner = isModelObject(receiver)
              ? receiver
              : isRelationExpression(receiver)
                ? relationTraceReference(receiver).self
                : reference?.model;
            if (!owner) return [];
            const availableIds = modelTopologyIds(receiver, parameter.kind);
            if (!availableIds) return [];
            const operation = operationsByCall.get(
              traceExecutionKey(execution.siteId, execution.execution),
            )?.[0];
            const attemptedIds = attemptedTopologyIds(
              execution.arguments.get(parameter.index),
              parameter.multiple,
            );
            const operationSelection = operation?.selections.find(
              selection => selection.kind === parameter.kind,
            );
            const returnedReferences = valueTargets
              .find(target => target.tool?.callId === site.siteId)
              ?.evaluations.find(
                evaluation => evaluation.runtime.order === execution.order,
              )?.topologyReferences;
            let preview: RelationPreview | undefined;
            let previewDiagnostic: ModelDiagnostic | undefined;
            if (execution.outcome === 'failed' && execution.relationSelf) {
              const preceding = precedingRelations(
                site,
                execution.relationSelf,
                execution.order,
              );
              try {
                preview = isRelationExpression(execution.receiver)
                  ? relationPreview(execution.receiver, preceding)
                  : relationSelectionPreview(execution.relationSelf, preceding);
              } catch (error) {
                previewDiagnostic = {
                  ...diagnosticFromError(error),
                  sourceRef: site.sourceRef,
                };
              }
            }
            const referenceNodeIds = preview
              ? [
                  ...new Set(
                    preview.object.constraints.flatMap(constraint => [
                      constraint.source.nodeId,
                      constraint.target.nodeId,
                    ]),
                  ),
                ].filter(id => id !== modelObjectNodeId(owner))
              : [];
            return [
              {
                runtime: sourceExecutionRuntime(execution),
                nodeIds: [
                  operation?.outputNodeId ?? modelObjectNodeId(owner),
                  ...referenceNodeIds,
                ],
                relationOwnerNodeId: preview
                  ? modelObjectNodeId(owner)
                  : undefined,
                relationPreview: preview?.object,
                relationPreviewDiagnostic: previewDiagnostic,
                relationContext: preview
                  ? {
                      constraintIds: preview.object.constraints.map(
                        value => value.id,
                      ),
                      referenceNodeIds,
                    }
                  : undefined,
                operationId: operation?.id,
                focusNodeIds: operation
                  ? undefined
                  : [modelObjectNodeId(owner)],
                parameters: execution.parameters,
                contextId: execution.contextId,
                selection: {
                  kind: parameter.kind,
                  inputNodeId: modelObjectNodeId(owner),
                  ids: operationSelection
                    ? operationSelection.ids
                    : returnedReferences?.length
                      ? returnedReferences.flatMap(reference =>
                          reference.kind !== 'solid' &&
                          reference.kind === parameter.kind
                            ? [reference.id]
                            : [],
                        )
                      : attemptedIds.filter(id =>
                          availableIds.some(available =>
                            sameTopologyId(available, id),
                          ),
                        ),
                  scope: operationSelection
                    ? {
                        geometryNodeId: operationSelection.inputNodeId,
                        transform: operationSelection.transform,
                        availableIds,
                      }
                    : reference
                      ? {
                          geometryNodeId: modelObjectNodeId(reference.geometry),
                          transform: reference.transform,
                          availableIds,
                        }
                      : undefined,
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
      },
    );
    const constraintTargets = [...sourceConstraintTraces.values()].flatMap(
      trace => {
        const toolSite = toolCallSites.get(trace.id);
        const relationSite = relationCallSites.get(trace.id);
        const evaluations = trace.evaluations.flatMap<SourceTargetEvaluation>(
          evaluation => {
            const execution = sourceExecutionFor(
              trace.id,
              evaluation.contextId,
              evaluation.runtime,
            );
            let preview: RelationPreview | undefined;
            let previewDiagnostic: ModelDiagnostic | undefined;
            try {
              preview = relationPreview(
                evaluation.expression,
                precedingRelations(
                  toolSite,
                  evaluation.self,
                  evaluation.runtime.order,
                ),
              );
            } catch (error) {
              const diagnostic = diagnosticFromError(error);
              previewDiagnostic = {
                ...diagnostic,
                summary: 'Cannot preview this constraint stage',
                details: [diagnostic.summary, diagnostic.details]
                  .filter(Boolean)
                  .join('\n'),
                sourceRef: trace.sourceRef,
              };
            }
            const consumers = compositionConsumers([
              modelObjectNodeId(evaluation.self ?? evaluation.source),
            ]);
            return consumers.length > 0
              ? consumers.map(consumer => ({
                  runtime: consumer.runtime,
                  toolExecutionOrder: evaluation.runtime.order,
                  parameters: execution?.parameters,
                  nodeIds: uniqueNodeIds(evaluation.source, evaluation.target),
                  operationInput: consumer.operationInput,
                  focusNodeIds: [
                    modelObjectNodeId(evaluation.self ?? evaluation.source),
                  ],
                  constraintId: evaluation.constraintId,
                  constraintFocus: 'self',
                  relationOwnerNodeId: modelObjectNodeId(
                    evaluation.self ?? evaluation.source,
                  ),
                  relationSpatial: preview?.spatial,
                  relationPreview: preview?.object,
                  relationPreviewDiagnostic: previewDiagnostic,
                  contextId: evaluation.contextId,
                }))
              : [
                  {
                    runtime: evaluation.runtime,
                    toolExecutionOrder: evaluation.runtime.order,
                    parameters: execution?.parameters,
                    nodeIds: uniqueNodeIds(
                      evaluation.source,
                      evaluation.target,
                    ),
                    focusNodeIds: [
                      modelObjectNodeId(evaluation.self ?? evaluation.source),
                    ],
                    constraintId: evaluation.constraintId,
                    constraintFocus: 'self',
                    relationOwnerNodeId: modelObjectNodeId(
                      evaluation.self ?? evaluation.source,
                    ),
                    relationSpatial: preview?.spatial,
                    relationPreview: preview?.object,
                    relationPreviewDiagnostic: previewDiagnostic,
                    contextId: evaluation.contextId,
                  },
                ];
          },
        );
        const target: SourceTarget = {
          id: `source:constraint:${trace.id}`,
          kind: 'constraint',
          callRef: trace.sourceRef,
          transformationInsertion:
            toolSite?.transformationInsertion ??
            relationSite?.transformationInsertion,
          sourceRef: toolSite?.sourceRef ?? trace.sourceRef,
          receiverRef: relationSite?.receiverRef,
          functionId: designFunctionAt(trace.sourceRef, designArguments),
          evaluations,
          tool: sourceTool(toolSite),
          contextTargetIds: compositionContextTargets(evaluations),
        };
        if (!relationSite) return [target];
        return [
          target,
          {
            ...target,
            id: `${target.id}:argument`,
            sourceRef: relationSite.targetRef,
            evaluations: evaluations.map(evaluation => {
              const constraint = evaluatedConstraint(objects, evaluation);
              return {
                ...evaluation,
                constraintFocus: 'target' as const,
                focusNodeIds: constraint
                  ? [constraint.target.nodeId]
                  : evaluation.focusNodeIds,
              };
            }),
          },
        ];
      },
    );

    const transformationTargets: SourceTarget[] = [
      ...sourceTransformationTraces.values(),
    ].map(trace => {
      const toolSite = toolCallSites.get(trace.id);
      const evaluations = trace.evaluations.flatMap<SourceTargetEvaluation>(
        value => {
          const execution = sourceExecutionFor(
            trace.id,
            value.contextId,
            value.runtime,
          );
          let preview: RelationPreview | undefined;
          let diagnostic: ModelDiagnostic | undefined;
          try {
            preview = relationPreview(
              value.expression,
              precedingRelations(toolSite, value.self, value.runtime.order),
            );
          } catch (error) {
            diagnostic = {
              ...diagnosticFromError(error),
              sourceRef: trace.sourceRef,
            };
          }
          const self = modelObjectNodeId(value.self);
          const constraints = preview?.object.constraints ?? [];
          const referenceNodeIds = [
            ...new Set(
              constraints.flatMap(value => [
                value.source.nodeId,
                value.target.nodeId,
              ]),
            ),
          ].filter(id => id !== self);
          const evaluation: SourceTargetEvaluation = {
            runtime: value.runtime,
            toolExecutionOrder: value.runtime.order,
            contextId: value.contextId,
            parameters: execution?.parameters,
            nodeIds: [self, ...referenceNodeIds],
            focusNodeIds: [self],
            relationOwnerNodeId: self,
            transformationId: value.transformationId,
            relationPreview: preview?.object,
            relationSpatial: preview?.spatial,
            relationPreviewDiagnostic: diagnostic,
            relationContext: {
              constraintIds: constraints.map(value => value.id),
              referenceNodeIds,
            },
          };
          const consumers = compositionConsumers([self]);
          return consumers.length
            ? consumers.map(consumer => ({
                ...evaluation,
                runtime: consumer.runtime,
                operationInput: consumer.operationInput,
              }))
            : [evaluation];
        },
      );
      return {
        id: `source:transformation:${trace.id}`,
        kind: 'transformation',
        callRef: trace.sourceRef,
        transformationInsertion: toolSite?.transformationInsertion,
        sourceRef: toolSite?.sourceRef ?? trace.sourceRef,
        functionId: designFunctionAt(trace.sourceRef, designArguments),
        evaluations,
        tool: sourceTool(toolSite),
        contextTargetIds: compositionContextTargets(evaluations),
      };
    });

    const elementTargets = [...sourceElementTraces.values()].map(
      trace =>
        ({
          id: `source:element:${trace.id}`,
          kind: 'element',
          sourceRef: trace.sourceRef,
          receiverRef: trace.receiverRef,
          functionId: designFunctionAt(trace.sourceRef, designArguments),
          evaluations: trace.evaluations.map(element => ({
            runtime: element.runtime,
            nodeIds: [modelObjectNodeId(element.model)],
            focusNodeIds: [modelObjectNodeId(element.model)],
            contextId: element.contextId,
            topologyReferences: element.topology
              ? [element.topology]
              : undefined,
            element: {
              nodeId: modelObjectNodeId(element.model),
              name: element.name,
              kind: element.kind,
              transform: element.transform,
              bound: element.bound,
              facing: element.facing,
              direction: element.direction,
            },
          })),
          contextTargetIds: [],
        }) satisfies SourceTarget,
    );

    function withConstraintContext(target: SourceTarget): SourceTarget {
      if (target.kind === 'constraint' || target.kind === 'transformation')
        return target;
      const scopeRef = parameterScopes.get(target.id);
      const containing = [
        ...constraintTargets,
        ...transformationTargets,
      ].filter(
        constraint =>
          constraint.sourceRef.file === target.sourceRef.file &&
          (scopeRef
            ? constraint.evaluations[0]?.constraintFocus !== 'target' &&
              scopeRef.start <= constraint.sourceRef.start &&
              constraint.sourceRef.end <= scopeRef.end
            : constraint.sourceRef.start <= target.sourceRef.start &&
              target.sourceRef.end <= constraint.sourceRef.end),
      );
      const contextTargetIds = new Set(target.contextTargetIds);
      const evaluations = target.evaluations.flatMap(evaluation => {
        const focusNodeIds = evaluation.focusNodeIds ?? evaluation.nodeIds;
        if (focusNodeIds.length === 0) return [evaluation];
        const matches = containing.flatMap(constraint =>
          constraint.evaluations
            .filter(
              candidate =>
                candidate.contextId === evaluation.contextId &&
                (candidate.toolExecutionOrder ?? candidate.runtime.order) >=
                  evaluation.runtime.order &&
                (!scopeRef ||
                  focusNodeIds.every(nodeId =>
                    candidate.nodeIds.includes(nodeId),
                  )),
            )
            .map(candidate => ({constraint, candidate})),
        );
        const narrowestSpan = scopeRef
          ? Infinity
          : Math.min(
              ...matches.map(({constraint}) =>
                sourceSpan(constraint.sourceRef),
              ),
            );
        const nearest = matches.filter(
          ({constraint}) => sourceSpan(constraint.sourceRef) <= narrowestSpan,
        );
        // Several calls can share one runtime context and reference model.
        // The first matching constraint to finish owns this value occurrence.
        const enclosingOrder = Math.min(
          ...nearest.map(
            ({candidate}) =>
              candidate.toolExecutionOrder ?? candidate.runtime.order,
          ),
        );
        return nearest.length > 0
          ? nearest
              .filter(
                ({candidate}) =>
                  (candidate.toolExecutionOrder ?? candidate.runtime.order) ===
                  enclosingOrder,
              )
              .map(entry => {
                if (
                  target.kind !== 'value' ||
                  !focusNodeIds.includes(
                    entry.candidate.relationOwnerNodeId ?? '',
                  )
                )
                  return entry;
                // Selecting self shows its complete chain. Tool activation then
                // navigates to a call or insertion prefix in this same context.
                const latest = constraintTargets
                  .flatMap(constraint =>
                    constraint.evaluations.map(candidate => ({
                      constraint,
                      candidate,
                    })),
                  )
                  .filter(
                    ({candidate}) =>
                      candidate.contextId === entry.candidate.contextId &&
                      candidate.constraintId === entry.candidate.constraintId &&
                      candidate.relationOwnerNodeId ===
                        entry.candidate.relationOwnerNodeId,
                  )
                  .reduce(
                    (latest, next) =>
                      (next.candidate.toolExecutionOrder ??
                        next.candidate.runtime.order) >
                      (latest.candidate.toolExecutionOrder ??
                        latest.candidate.runtime.order)
                        ? next
                        : latest,
                    entry,
                  );
                const owner = objects.get(
                  latest.candidate.relationOwnerNodeId ?? '',
                );
                const stage = owner?.relationStages?.find(
                  stage =>
                    stage.constraintIds.includes(
                      latest.candidate.constraintId ?? '',
                    ) ||
                    stage.transformationIds.includes(
                      latest.candidate.transformationId ?? '',
                    ),
                );
                const preview =
                  owner && stage
                    ? {
                        nodeId: owner.nodeId,
                        compositionTransform: stage.compositionTransform,
                        constraints: owner.constraints.filter(value =>
                          stage.constraintIds.includes(value.id),
                        ),
                        transformations: owner.transformations?.filter(value =>
                          stage.transformationIds.includes(value.id),
                        ),
                        relationStages: [stage],
                      }
                    : latest.candidate.relationPreview;
                return {
                  ...latest,
                  candidate: {
                    ...latest.candidate,
                    constraintFocus: entry.candidate.constraintFocus,
                    relationPreview: preview,
                  },
                };
              })
              .map(({constraint, candidate}) => {
                constraint.contextTargetIds.forEach(id =>
                  contextTargetIds.add(id),
                );
                const constraintFocus = scopeRef
                  ? 'self'
                  : candidate.constraintFocus === 'target'
                    ? 'target'
                    : constraint.receiverRef &&
                        constraint.receiverRef.start <=
                          target.sourceRef.start &&
                        target.sourceRef.end <= constraint.receiverRef.end
                      ? 'source'
                      : 'self';
                const context = {
                  ...evaluation,
                  valueNodeIds: evaluation.nodeIds,
                  runtime: candidate.runtime,
                  toolExecutionOrder:
                    evaluation.toolExecutionOrder ?? evaluation.runtime.order,
                  nodeIds: candidate.nodeIds,
                  operationInput: candidate.operationInput,
                  constraintId: candidate.constraintId,
                  transformationId: candidate.transformationId,
                  relationContext: candidate.relationContext,
                  relationOwnerNodeId: candidate.relationOwnerNodeId,
                  constraintFocus,
                  relationSpatial: candidate.relationSpatial,
                  relationPreview: candidate.relationPreview,
                  relationPreviewDiagnostic:
                    candidate.relationPreviewDiagnostic,
                } satisfies SourceTargetEvaluation;
                const relation = evaluatedConstraint(objects, context);
                return {
                  ...context,
                  // An auxiliary reference (e.g. aroundLine(axis)) remains available
                  // while the relation's self stays the primary model.
                  nodeIds: [
                    ...new Set([...candidate.nodeIds, ...evaluation.nodeIds]),
                  ],
                  focusNodeIds: relation
                    ? [
                        relation[focusedConstraintSide(context, relation)]
                          .nodeId,
                      ]
                    : candidate.focusNodeIds,
                };
              })
          : [evaluation];
      });
      return {...target, evaluations, contextTargetIds: [...contextTargetIds]};
    }

    const targets: SourceTarget[] = [
      ...elementTargets,
      ...constraintTargets,
      ...transformationTargets,
      ...operationSelectionTargets,
      ...topologySelectionTargets,
      ...valueTargets,
      ...operationInputTargets.map(
        target =>
          ({
            id: target.id,
            kind: target.operation ? 'operation-input' : 'value',
            sourceRef: target.sourceRef,
            functionId: designFunctionAt(target.sourceRef, designArguments),
            tool: target.tool,
            evaluations: target.evaluations.map(evaluation => ({
              runtime: evaluation.runtime,
              toolExecutionOrder: evaluation.toolExecutionOrder,
              parameters: evaluation.parameters,
              nodeIds: (evaluation.collection ?? evaluation.objects).map(
                modelObjectNodeId,
              ),
              focusNodeIds: evaluation.collection
                ? evaluation.objects.map(modelObjectNodeId)
                : undefined,
              operationId: evaluation.operationId,
              operationInput: evaluation.role
                ? {
                    operationId: evaluation.operationId!,
                    role: evaluation.role,
                    nodeIds: evaluation.objects.map(modelObjectNodeId),
                  }
                : undefined,
              isCollection: evaluation.collection
                ? true
                : evaluation.isCollection,
              contextId: evaluation.contextId,
            })),
            contextTargetIds: operationInputTargets
              .filter(
                candidate =>
                  candidate !== target && sharesOperation(candidate, target),
              )
              .map(candidate => candidate.id),
            operation: target.operation,
          }) satisfies SourceTarget,
      ),
    ]
      .map(withConstraintContext)
      .map(withOperationContext);
    // Array gaps own their insertion prefix, not the final stage of a nearby call.
    for (const site of relationArraySites) {
      const self = valueTargets.find(
        target => target.id === `source:value:${site.parameterId}`,
      );
      if (!self) continue;
      const trace = [...sourceValueTraces.values()].find(
        trace => trace.id === site.parameterId,
      )!;
      const relations = [...constraintTargets, ...transformationTargets]
        .filter(
          target =>
            target.sourceRef.file === site.sourceRef.file &&
            target.sourceRef.start >= site.sourceRef.start &&
            target.sourceRef.end <= site.sourceRef.end,
        )
        .sort((a, b) => a.sourceRef.end - b.sourceRef.end);
      for (const [index, gap] of site.gaps.entries()) {
        const preceding = site.elements.slice(0, index);
        const predecessor = preceding.at(-1);
        const nearest =
          relations
            .filter(target => target.sourceRef.end <= gap.start)
            .at(-1) ?? relations[0];
        const id = `${self.id}:array:${site.sourceRef.start}:${index}`;
        parameterScopes.set(id, nearest?.sourceRef ?? site.sourceRef);
        const target = withConstraintContext({
          ...self,
          id,
          sourceRef: gap,
          relationArray: site.sourceRef,
          transformationInsertion: predecessor
            ? Object.fromEntries(
                Object.entries(site.insertion).map(([name, insertion]) => [
                  name,
                  {
                    ...insertion,
                    sourceRef: predecessor,
                    container: 'array' as const,
                  },
                ]),
              )
            : site.insertion,
        });
        targets.push({
          ...target,
          evaluations: target.evaluations.map(evaluation => ({
            ...evaluation,
            constraintId: undefined,
            transformationId: undefined,
            relationSpatial: undefined,
            ...relationPreviewContext(
              gap,
              trace.evaluations.find(
                value =>
                  value.contextId === evaluation.contextId &&
                  value.objects.some(
                    object =>
                      modelObjectNodeId(object) ===
                      (evaluation.relationOwnerNodeId ?? evaluation.nodeIds[0]),
                  ),
              )!.objects[0],
              self =>
                relationSelectionPreview(
                  self,
                  precedingRelations(
                    {relationPredecessors: preceding},
                    self,
                    Infinity,
                    evaluation.contextId,
                  ),
                  precedingRelations(
                    {relationPredecessors: site.elements},
                    self,
                    Infinity,
                    evaluation.contextId,
                  )[0],
                ),
            ),
          })),
        });
      }
    }
    function rotationSelectionContext(
      site: ToolCallSite,
      execution: SourceExecutionTrace,
    ): Partial<SourceTargetEvaluation> {
      if (!site.rotationSelection || !execution.relationSelf) return {};
      return relationPreviewContext(
        site.sourceRef,
        execution.relationSelf,
        self => {
          const preceding = precedingRelations(site, self, execution.order);
          return isRelationExpression(execution.receiver)
            ? relationPreview(execution.receiver, preceding)
            : relationSelectionPreview(self, preceding);
        },
      );
    }

    function relationPreviewContext(
      sourceRef: SourceRef,
      receiver: RelationObject,
      evaluate: (self: RelationObject) => RelationPreview | undefined,
    ): Partial<SourceTargetEvaluation> {
      const self = modelObjectNodeId(receiver);
      try {
        const preview = evaluate(receiver);
        if (!preview)
          return {
            nodeIds: [self],
            focusNodeIds: [self],
            relationOwnerNodeId: self,
          };
        const referenceNodeIds = [
          ...new Set(
            preview.object.constraints.flatMap(value => [
              value.source.nodeId,
              value.target.nodeId,
            ]),
          ),
        ].filter(id => id !== self);
        return {
          nodeIds: [self, ...referenceNodeIds],
          focusNodeIds: [self],
          relationOwnerNodeId: self,
          relationPreview: preview.object,
          relationPreviewDiagnostic: undefined,
          relationContext: {
            constraintIds: preview.object.constraints.map(value => value.id),
            referenceNodeIds,
          },
        };
      } catch (error) {
        return {
          nodeIds: [self],
          focusNodeIds: [self],
          relationOwnerNodeId: self,
          relationPreviewDiagnostic: {
            ...diagnosticFromError(error),
            sourceRef,
          },
        };
      }
    }
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
          ...rotationSelectionContext(site, execution),
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
    const completedTargets = [
      ...fallbackToolTargets.map(withConstraintContext),
      ...targets,
    ].map(target => ({
      ...target,
      evaluations: target.evaluations
        .map(evaluation => {
          const execution = target.tool
            ? sourceExecutionFor(target.tool.callId, evaluation.contextId, {
                ...evaluation.runtime,
                order:
                  evaluation.toolExecutionOrder ?? evaluation.runtime.order,
              })
            : undefined;
          const toolArguments = execution
            ? numericToolArguments(execution.arguments, target.tool!.signature)
            : undefined;
          return toolArguments ? {...evaluation, toolArguments} : evaluation;
        })
        .sort((left, right) => right.runtime.order - left.runtime.order),
    }));
    const rotations = new Map<string, string>();
    const selectors = new Map<string, string[]>();
    for (const target of completedTargets) {
      if (
        target.tool?.signature.name !== 'rotate' ||
        !target.evaluations.some(e => e.relationSpatial?.kind === 'rotate')
      )
        continue;
      const refs =
        toolCallSites.get(target.tool.callId)?.rotationReceivers ?? [];
      const ids: string[] = [];
      for (const ref of refs) {
        const candidates = completedTargets.filter(candidate => {
          // Tool spans start at the selector, excluding a namespace/receiver.
          const selector =
            toolCallSites.get(candidate.tool?.callId ?? '')?.sourceRef ??
            candidate.sourceRef;
          return (
            selector.file === ref.file &&
            selector.start === ref.selectorStart &&
            selector.end === ref.end &&
            candidate.evaluations.some(e =>
              [
                'pivot',
                'pivotVertex',
                'pivotPoint',
                'aroundEdge',
                'pivotOffset',
                'aroundLine',
                'axisOffset',
              ].includes(e.relationSpatial?.kind ?? ''),
            )
          );
        });
        if (!candidates.length) break;
        // Reference values inside a selector share the rotation tool too; a nested
        // call with its own numeric tool still remains independently editable.
        for (const nested of completedTargets) {
          if (
            !nested.tool &&
            nested.sourceRef.file === ref.file &&
            nested.sourceRef.start >= ref.selectorStart &&
            nested.sourceRef.end <= ref.end
          )
            rotations.set(nested.id, target.id);
        }
        for (const candidate of candidates) {
          rotations.set(candidate.id, target.id);
          if (
            candidate.tool &&
            !ids.some(
              id =>
                completedTargets.find(t => t.id === id)?.tool?.callId ===
                candidate.tool!.callId,
            )
          )
            ids.unshift(candidate.id);
        }
      }
      if (refs.length) selectors.set(target.id, ids);
    }
    return completedTargets.map(target => ({
      ...target,
      relationSelfTargetId: target.evaluations.flatMap(evaluation => {
        const operation = operations.get(evaluation.operationId ?? '');
        if (
          operation?.kind !== 'relate' ||
          operation.outputNodeId !== evaluation.relationOwnerNodeId ||
          !operation.sourceRef
        )
          return [];
        const ref = operation.sourceRef;
        const self = completedTargets.find(
          candidate =>
            candidate.kind === 'value' &&
            (parameterScopes.has(candidate.id) || candidate.relationArray) &&
            candidate.sourceRef.file === ref.file &&
            candidate.sourceRef.start >= ref.start &&
            candidate.sourceRef.end <= ref.end &&
            candidate.evaluations.some(
              value =>
                value.contextId === evaluation.contextId &&
                value.relationOwnerNodeId === operation.outputNodeId,
            ),
        );
        return self ? [self.id] : [];
      })[0],
      argumentListRef: toolCallSites.get(target.tool?.callId ?? '')
        ?.argumentListRef,
      rotationSelection:
        !rotations.has(target.id) &&
        !target.evaluations.some(
          value => value.relationSpatial?.kind === 'rotate',
        ) &&
        target.evaluations.some(value => value.relationOwnerNodeId)
          ? toolCallSites.get(target.tool?.callId ?? '')?.rotationSelection
          : undefined,
      rotationToolId: rotations.get(target.id),
      rotationSelectorIds: selectors.get(target.id),
    }));
  }

  function numericToolArguments(
    arguments_: ReadonlyMap<number, unknown>,
    signature: ToolSignatureSchema,
  ): Readonly<Record<number, number>> | undefined {
    const values: Record<number, number> = {};
    for (const parameter of signature.parameters) {
      const [index, ...components] = parameter.path ?? [parameter.index];
      let value = arguments_.get(index);
      for (const component of components)
        value = Array.isArray(value) ? value[component] : undefined;
      if (typeof value === 'number') values[parameter.index] = value;
    }
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
    return attemptedTopologyIds(value, true);
  }

  function attemptedTopologyIds(
    value: unknown,
    multiple: boolean,
  ): TopologyId[] {
    const values = multiple ? (Array.isArray(value) ? value : []) : [value];
    return [...new TopologyIdSet(values.filter(isTopologyId))];
  }

  function validAttemptedEdgeIds(
    input: ModelSnapshotObject,
    attempted: readonly EdgeId[] | undefined,
  ): EdgeId[] {
    if (input.kind !== 'solid' || !input.mesh || !attempted) return [];
    const available = new TopologyIdSet(
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
      for (const input of operation.inputs.filter(
        input => input.role === role,
      )) {
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

  function uniqueNodeIds(...models: readonly RelationObject[]): string[] {
    return [...new Set(models.map(modelObjectNodeId))];
  }

  function sourceSpan(sourceRef: SourceRef): number {
    return sourceRef.end - sourceRef.start;
  }

  type MutableSourceInputTarget = {
    id: string;
    sourceRef: SourceRef;
    tool?: SourceTarget['tool'];
    evaluations: Array<
      Readonly<{
        operationId?: string;
        callId: string;
        parameters?: readonly ParameterUsage[];
        toolExecutionOrder?: number;
        role?: ModelOperationInputRole;
        isCollection?: boolean;
        objects: readonly RelationObject[];
        collection?: readonly RelationObject[];
        contextId: string;
        runtime: RuntimeReach;
      }>
    >;
    operation?: SourceTarget['operation'];
  };

  function designFunctionAt(
    sourceRef: SourceRef,
    designArguments: readonly Pick<
      DesignArgumentContext,
      'functionId' | 'functionRef'
    >[],
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
      right.evaluations.map(evaluation => evaluation.callId),
    );
    return left.evaluations.some(
      evaluation =>
        evaluation.operationId !== undefined && rightIds.has(evaluation.callId),
    );
  }

  return {execute};
}
