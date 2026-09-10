import type * as CoreTooling from '@code3d/core/tooling';
import {
  isTopologyId,
  sameTopologyId,
  TopologyIdSet,
  type ConstraintExpression,
  type ConstraintPreview,
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
      expression: ConstraintExpression;
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
  inputs: SourceInputTrace[];
  failure?: ModelDiagnostic;
};

export function createModelExecutor(
  runtime: typeof CoreTooling,
  evaluator = new ModuleEvaluator(),
) {
  const {
    beginModelEvaluation,
    constraintTraceReference,
    constraintPreview,
    createModelSnapshotter,
    instrumentConstraint,
    instrumentModelOperation,
    isConstraintExpression,
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
  const sourceElementTraces = new Map<string, SourceElementTrace>();
  let edgeSelectionSites: CompiledModelSource['edgeSelectionSites'] = new Map();
  let toolCallSites: CompiledModelSource['toolCallSites'] = new Map();
  let relationCallSites: CompiledModelSource['relationCallSites'] = new Map();
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
      };
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
      if (isConstraintExpression(result)) {
        instrumentConstraint(result, location, parameters);
        recordSourceConstraint(id, location, result, context.id, runtime);
      } else if (
        isModelObject(result) ||
        (Array.isArray(result) &&
          result.length > 0 &&
          result.every(isModelObject))
      ) {
        const order = ++evaluationOrder;
        for (const object of isModelObject(result)
          ? [result]
          : (result as ModelObject[]))
          instrumentModelOperation(object, {
            siteId: id,
            execution,
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
      if (isConstraintExpression(result)) {
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
      if (isConstraintExpression(value)) {
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
          : isConstraintExpression(value)
            ? constraintTraceReference(value).self
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
    if (isConstraintExpression(value)) {
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
    constraint: ConstraintExpression,
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
    if (isConstraintExpression(value)) {
      const self = constraintTraceReference(value).self;
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
    onEvaluate?: () => void,
    captureGeometry?: (objects: readonly RelationObject[]) => void,
    checkCancelled: () => void = () => {},
    prepareSnapshots?: (objects: readonly RelationObject[]) => Promise<void>,
  ): Promise<ModelModule> {
    const {rootPath, files, designArguments, activeDesignContext} = artifact;
    tracedObjects.clear();
    sourceValueTraces.clear();
    sourceConstraintTraces.clear();
    sourceElementTraces.clear();
    edgeSelectionSites = artifact.edgeSelectionSites;
    toolCallSites = artifact.toolCallSites;
    relationCallSites = artifact.relationCallSites;
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
        onEvaluate?.();
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
        sourceTargets: buildSourceTargets(operations, objectSnapshots, [
          ...designArguments,
          ...(activeDesignContext ? [activeDesignContext] : []),
        ]),
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
      sourceElementTraces.clear();
      edgeSelectionSites = new Map();
      toolCallSites = new Map();
      relationCallSites = new Map();
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
    for (const trace of sourceInputTraces) {
      const operationId = traceExecutionKey(trace.siteId, trace.execution);
      const operation = operations.get(operationId);
      const nodeIds = trace.objects.map(modelObjectNodeId);
      const inputs =
        operation?.inputs.filter(input => nodeIds.includes(input.nodeId)) ?? [];
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
      target.evaluations.push({
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

    function compositionConsumers(nodeIds: readonly string[]) {
      return operationInputTargets.flatMap(target =>
        target.evaluations.flatMap(input => {
          if (!input.role || !isCompositionInputRole(input.role)) return [];
          const consumedNodeIds = input.objects
            .map(modelObjectNodeId)
            .filter(nodeId =>
              nodeIds.some(sourceNodeId =>
                sourceLineageContains(
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
                  operationInput: {
                    operationId: input.operationId!,
                    role: input.role,
                    nodeIds: consumedNodeIds,
                  },
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
        evaluations.flatMap(evaluation =>
          evaluation.operationInput
            ? [evaluation.operationInput.operationId]
            : [],
        ),
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
        if (
          !operation.spatial &&
          operation.kind !== 'scaled' &&
          operation.kind !== 'relate'
        )
          return [evaluation];
        const consumers = compositionConsumers(evaluation.nodeIds);
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
            constraintOwnerNodeId: owner.nodeId,
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
          const operation = operations.get(
            traceExecutionKey(execution.siteId, execution.execution),
          );
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
            const receiver = execution.receiver;
            const reference = modelTopologyReference(receiver);
            const owner = isModelObject(receiver)
              ? receiver
              : isConstraintExpression(receiver)
                ? constraintTraceReference(receiver).self
                : reference?.model;
            if (!owner) return [];
            const availableIds = modelTopologyIds(receiver, parameter.kind);
            if (!availableIds) return [];
            const operation = operations.get(
              traceExecutionKey(execution.siteId, execution.execution),
            );
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
            return [
              {
                runtime: sourceExecutionRuntime(execution),
                nodeIds: [operation?.outputNodeId ?? modelObjectNodeId(owner)],
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
            let preview: ConstraintPreview | undefined;
            let previewDiagnostic: ModelDiagnostic | undefined;
            try {
              preview = constraintPreview(evaluation.expression);
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
                  constraintOwnerNodeId: modelObjectNodeId(
                    evaluation.self ?? evaluation.source,
                  ),
                  constraintSpatial: preview?.spatial,
                  constraintPreview: preview?.object,
                  constraintPreviewDiagnostic: previewDiagnostic,
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
                    constraintOwnerNodeId: modelObjectNodeId(
                      evaluation.self ?? evaluation.source,
                    ),
                    constraintSpatial: preview?.spatial,
                    constraintPreview: preview?.object,
                    constraintPreviewDiagnostic: previewDiagnostic,
                    contextId: evaluation.contextId,
                  },
                ];
          },
        );
        const target: SourceTarget = {
          id: `source:constraint:${trace.id}`,
          kind: 'constraint',
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
      if (target.kind === 'constraint') return target;
      const scopeRef = parameterScopes.get(target.id);
      const containing = constraintTargets.filter(
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
                  constraintOwnerNodeId: candidate.constraintOwnerNodeId,
                  constraintFocus,
                  constraintSpatial: candidate.constraintSpatial,
                  constraintPreview: candidate.constraintPreview,
                  constraintPreviewDiagnostic:
                    candidate.constraintPreviewDiagnostic,
                } satisfies SourceTargetEvaluation;
                const relation = evaluatedConstraint(objects, context);
                return {
                  ...context,
                  // An auxiliary reference (e.g. around(axis)) remains available
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
            evaluations: target.evaluations.map(evaluation => ({
              runtime: evaluation.runtime,
              nodeIds: evaluation.objects.map(modelObjectNodeId),
              operationId: evaluation.operationId,
              operationInput: evaluation.role
                ? {
                    operationId: evaluation.operationId!,
                    role: evaluation.role,
                    nodeIds: evaluation.objects.map(modelObjectNodeId),
                  }
                : undefined,
              isCollection: evaluation.isCollection,
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
    return [...fallbackToolTargets.map(withConstraintContext), ...targets].map(
      target => ({
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
              ? numericToolArguments(
                  execution.arguments,
                  target.tool!.signature,
                )
              : undefined;
            return toolArguments ? {...evaluation, toolArguments} : evaluation;
          })
          .sort((left, right) => right.runtime.order - left.runtime.order),
      }),
    );
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
    evaluations: Array<
      Readonly<{
        operationId?: string;
        role?: ModelOperationInputRole;
        isCollection?: boolean;
        objects: readonly RelationObject[];
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
      right.evaluations.map(evaluation => evaluation.operationId),
    );
    return left.evaluations.some(
      evaluation =>
        evaluation.operationId !== undefined &&
        rightIds.has(evaluation.operationId),
    );
  }

  return {execute};
}
