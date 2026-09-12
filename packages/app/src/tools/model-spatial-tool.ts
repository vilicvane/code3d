import {
  composeTransforms,
  identityRigidTransform,
  invertTransform,
  rotateVector,
  rotationAround,
  xyzRotation,
  type ModelOperationSnapshot,
  type ModelSnapshotObject,
  type ModelSpatialOperation,
  type ParameterTarget,
  type ParameterUsage,
  type Quaternion,
  type SourceRef,
  type Transform,
  type Vec3,
} from '@code3d/core/tooling';
import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from '../model/compiler';
import {editableParameterUsages} from '../model/parameter-provenance';
import {isToolSelectionParameter} from '../model/tool-parameter-config';
import {type ToolArgumentEditTarget} from '../model/tool-schema';
import {
  replaceNumericArgument,
  type NumericArgumentValue,
  type TransformationInsertion,
} from './source-expression';
import type {SpatialObjectPreview} from './spatial-edit';
import type {ToolIntent} from './tool-system';
import {
  bindingTool,
  type SpatialTool,
  type TransformAxis,
  type TransformGizmoBinding,
} from './transform-gizmo';

type SpatialToolOccurrence = Readonly<{
  key: string;
  node: ModelSnapshotObject;
  placement: 'standalone' | 'composition';
}>;

export type SpatialBindingSource =
  | Readonly<{kind: 'parameter'; target: ParameterTarget}>
  | Readonly<{
      kind: 'omitted-argument';
      target: Extract<ToolArgumentEditTarget, {kind: 'omitted'}>;
    }>
  | Readonly<{
      kind: 'call-argument';
      sourceRef: SourceRef;
      path: readonly number[];
      values: readonly NumericArgumentValue[];
    }>
  | Readonly<{
      kind: 'argument';
      sourceRef: SourceRef;
      mode: 'offset' | 'replace';
    }>
  | Readonly<{
      kind: 'origin-offset';
      sourceRef: SourceRef;
    }>
  | Readonly<{
      kind: 'reference-offset';
      sourceRef: SourceRef;
      method: 'pivot' | 'pivotOffset' | 'axisOffset';
      append?: TransformationInsertion['container'];
      constructor?: TransformationInsertion;
    }>
  | (Readonly<{kind: 'transformation-insert'}> & TransformationInsertion);

export type SpatialBindingObject = Readonly<{
  key: string;
  nodeId: string;
  spatial: ModelSpatialOperation;
  sensitivity: number;
}>;

export type ModelSpatialBinding = Readonly<{
  operation:
    | 'originOffset'
    | 'originPoint'
    | 'originVertex'
    | 'originCenter'
    | 'rotate'
    | 'offset'
    | 'pivot'
    | 'pivotOffset'
    | 'axisOffset';
  source: SpatialBindingSource;
  operationRef?: SourceRef;
  ownerNodeId?: string;
  constructors?: SourceTarget['transformationInsertion'];
  objects: readonly SpatialBindingObject[];
}>;

export function spatialBindings(
  module: ModelModule,
  scope: Readonly<{target: SourceTarget; evaluation: SourceTargetEvaluation}>,
  occurrence: SpatialToolOccurrence,
  occurrences: readonly SpatialToolOccurrence[],
  committed: ReadonlyMap<string, SpatialObjectPreview>,
  parameterValues: ReadonlyMap<string, number>,
): Extract<TransformGizmoBinding, {kind: 'spatial'}>[] {
  const {target, evaluation} = scope;
  const relation = evaluation.relationSpatial;
  if (
    relation &&
    relation.kind !== 'rotate' &&
    relation.kind !== 'pivot' &&
    relation.kind !== 'pivotOffset' &&
    relation.kind !== 'axisOffset' &&
    relation.kind !== 'offset'
  )
    return [];
  const modelOperation = evaluation.operationId
    ? module.operations.get(evaluation.operationId)
    : undefined;
  const operation = relation
    ? {
        kind: relation.kind as
          'rotate' | 'pivot' | 'pivotOffset' | 'axisOffset' | 'offset',
        outputNodeId: relation.nodeId,
        spatial: relation.spatial,
        siteId: undefined,
      }
    : modelOperation;
  const spatial = operation?.spatial;
  if (
    !operation ||
    !spatial ||
    !(
      operation.kind === 'pivot' ||
      operation.kind === 'pivotOffset' ||
      operation.kind === 'axisOffset' ||
      operation.kind === 'offset' ||
      isSpatialOperation(operation.kind)
    ) ||
    operation.outputNodeId !== occurrence.node.nodeId
  )
    return [];
  const kind = operation.kind;
  const offsetOrigin =
    kind === 'originPoint' ||
    kind === 'originVertex' ||
    kind === 'originCenter';
  const mode = kind === 'rotate' ? 'rotate' : 'translate';
  const usages = editableParameterUsages(evaluation.parameters ?? []);
  const matching = occurrences.flatMap(candidate => {
    const candidateEvaluation = relation
      ? target.evaluations.find(
          evaluation =>
            evaluation.relationSpatial?.nodeId === candidate.node.nodeId,
        )
      : undefined;
    const candidateSpatial = relation
      ? candidateEvaluation?.relationSpatial?.spatial
      : candidate.node.operation.siteId === operation.siteId
        ? candidate.node.operation.spatial
        : undefined;
    return candidateSpatial
      ? [
          {
            ...candidate,
            spatial: candidateSpatial,
            parameters:
              candidateEvaluation?.parameters ?? candidate.node.parameters,
          },
        ]
      : [];
  });
  const axes =
    spatial.axisOnly && kind === 'rotate'
      ? (['y'] as const)
      : (['x', 'y', 'z'] as const);
  return axes.flatMap(axis => {
    const index = axisIndex(axis);
    const argumentIndex = spatial.axisOnly && kind === 'rotate' ? 0 : index;
    const argumentSource = target.tool?.arguments.find(
      argument => argument.index === argumentIndex,
    );
    const argument = argumentSource?.target;
    const schema = target.tool?.signature.parameters.find(
      parameter => parameter.index === argumentIndex,
    );
    const parameterName =
      spatial.axisOnly && kind === 'rotate'
        ? 'angle'
        : kind === 'originOffset'
          ? `d${axis}`
          : axis;
    const candidates = usages.filter(
      usage =>
        usage.argument === parameterName && Math.abs(usage.sensitivity) > 1e-9,
    );
    const parameter =
      candidates.length === 1 &&
      safeSpatialParameter(module, candidates[0], target.sourceRef)
        ? candidates[0]
        : undefined;
    let source: SpatialBindingSource;
    if (offsetOrigin)
      source = {kind: 'origin-offset', sourceRef: target.sourceRef};
    else if (parameter) source = {kind: 'parameter', target: parameter.target};
    else if (argument?.kind === 'present')
      source = {
        kind: 'argument',
        sourceRef: argument.sourceRef,
        mode:
          evaluation.toolArguments?.[argumentIndex] === undefined
            ? 'replace'
            : 'offset',
      };
    else if (
      argument?.kind === 'omitted' &&
      schema &&
      !isToolSelectionParameter(schema) &&
      schema.default !== undefined
    )
      source = {kind: 'omitted-argument', target: argument};
    else
      source = {
        kind: 'call-argument',
        sourceRef: target.sourceRef,
        path: schema?.path ?? (kind === 'pivot' ? [0, index] : [argumentIndex]),
        values:
          kind === 'pivot'
            ? [spatial.vector]
            : spatial.axisOnly && kind === 'rotate'
              ? [spatial.vector[index]]
              : spatial.vector,
      };
    const frame: Transform = {
      position: spatial.origin,
      quaternion:
        kind === 'rotate'
          ? composeTransforms(spatial.frame ?? identityRigidTransform, {
              position: [0, 0, 0],
              quaternion: rotationAxisFrame(spatial.vector, axis),
            }).quaternion
          : (spatial.frame?.quaternion ?? identityRigidTransform.quaternion),
      scale: [1, 1, 1],
    };
    return [
      {
        kind: 'spatial' as const,
        placement:
          occurrence.placement === 'composition'
            ? occurrence.node.compositionTransform
            : occurrence.node.transform,
        mode,
        axis,
        label:
          (!offsetOrigin && schema?.label) ||
          `${kind === 'rotate' ? 'Rotate' : kind === 'pivot' ? 'Pivot' : kind === 'offset' ? 'Move' : 'Origin'} ${axis.toUpperCase()}`,
        value: parameter
          ? (parameterValues.get(parameter.target.id) ?? parameter.target.value)
          : offsetOrigin
            ? 0
            : spatial.vector[index],
        sensitivity: parameter?.sensitivity ?? 1,
        parameterKind:
          kind === 'rotate' ? ('angle' as const) : ('length' as const),
        frame,
        anchor: 'frame' as const,
        completeArguments: offsetOrigin
          ? undefined
          : {
              sourceRef: target.sourceRef,
              values:
                kind === 'pivot'
                  ? [spatial.vector]
                  : spatial.axisOnly && kind === 'rotate'
                    ? [spatial.vector[index]]
                    : spatial.vector,
            },
        spatial: {
          operation: kind,
          source,
          operationRef: target.callRef ?? target.sourceRef,
          ownerNodeId: occurrence.node.nodeId,
          constructors: target.transformationInsertion,
          objects: matching.map(candidate => ({
            key: candidate.key,
            nodeId: candidate.node.nodeId,
            spatial: candidate.spatial,
            sensitivity:
              source.kind === 'parameter'
                ? candidate.parameters
                    .filter(
                      usage =>
                        usage.target.id === source.target.id &&
                        usage.argument === parameterName &&
                        sameSource(usage.operationRef, parameter!.operationRef),
                    )
                    .reduce((sum, usage) => sum + usage.sensitivity, 0)
                : 1,
          })),
        },
      },
    ];
  });
}

/** Derive reference movement from the same authored rotation and instance frames. */
export function rotationReferenceBindings(
  bindings: readonly TransformGizmoBinding[],
): TransformGizmoBinding[] {
  const rotations = new Map<
    SpatialTool,
    Extract<TransformGizmoBinding, {kind: 'spatial'}>
  >();
  for (const binding of bindings) {
    if (binding.kind !== 'spatial' || binding.mode !== 'rotate') continue;
    const tool = bindingTool(binding);
    if (!rotations.has(tool)) rotations.set(tool, binding);
  }
  return [...rotations.values()].flatMap(rotationReferenceFor);
}

function rotationReferenceFor(
  rotation: Extract<TransformGizmoBinding, {kind: 'spatial'}>,
): TransformGizmoBinding[] {
  const first = rotation.spatial.objects.find(
    object => object.nodeId === rotation.spatial.ownerNodeId,
  );
  const reference = first?.spatial.reference;
  if (!reference) return [];
  const operation =
    reference.kind === 'aroundLine' || reference.kind === 'aroundEdge'
      ? 'axisOffset'
      : reference.kind === 'pivot' && !reference.offsetExplicit
        ? 'pivot'
        : 'pivotOffset';
  const source = rotation.spatial.source;
  const append =
    source.kind === 'transformation-insert' ? source.container : undefined;
  const operationRef =
    rotation.spatial.operationRef ??
    ('sourceRef' in source ? source.sourceRef : undefined);
  if (!operationRef) return [];
  const objects = rotation.spatial.objects.map(object => ({
    ...object,
    sensitivity: 1,
    spatial: {
      ...object.spatial,
      origin: object.spatial.reference!.frame.position,
      vector:
        operation === 'pivot' && object.spatial.reference!.kind === 'pivot'
          ? object.spatial.reference!.point
          : object.spatial.reference!.offset,
      frame: object.spatial.reference!.frame,
      rotation: object.spatial.reference!.rotation,
    },
  }));
  return (['x', 'y', 'z'] as const).map((axis, index) => ({
    ...rotation,
    axis,
    mode: 'translate',
    label: `${reference.kind === 'aroundLine' || reference.kind === 'aroundEdge' ? 'Axis' : 'Pivot'} ${operation === 'pivot' ? '' : 'Δ'}${axis.toUpperCase()}`,
    value:
      operation === 'pivot' && reference.kind === 'pivot'
        ? reference.point[index]
        : reference.offset[index],
    sensitivity: 1,
    parameterKind: 'length',
    step: undefined,
    completeArguments: undefined,
    frame: {...reference.frame, scale: [1, 1, 1]},
    spatial: {
      operation,
      operationRef,
      ownerNodeId: rotation.spatial.ownerNodeId,
      constructors: rotation.spatial.constructors,
      source: {
        kind: 'reference-offset',
        sourceRef: operationRef,
        method: operation,
        append,
        constructor: rotation.spatial.constructors?.pivot,
      },
      objects,
    },
  }));
}

/** Bind the selected independent step or insertion at the joint solution. */
export function transformationBindings(
  module: ModelModule,
  occurrence: SpatialToolOccurrence,
  occurrences: readonly SpatialToolOccurrence[],
  committed: ReadonlyMap<string, SpatialObjectPreview>,
  parameterValues: ReadonlyMap<string, number>,
  scope?: Readonly<{target: SourceTarget; evaluation: SourceTargetEvaluation}>,
): TransformGizmoBinding[] {
  const evaluation = scope?.evaluation;
  const emptyArrayStage =
    scope?.target.relationArray && !occurrence.node.relationStages?.length
      ? {
          constraintIds: [] as string[],
          transformationIds: [] as string[],
          compositionTransform: occurrence.node.compositionTransform,
          offsetFrame: identityRigidTransform,
        }
      : undefined;
  const insertionScope = !!scope?.target.relationArray;
  const storedStage = insertionScope
    ? occurrence.node.relationStages?.at(-1)
    : occurrence.node.relationStages?.find(stage =>
        evaluation?.transformationId
          ? stage.transformationIds.includes(evaluation.transformationId)
          : evaluation?.constraintId
            ? stage.constraintIds.includes(evaluation.constraintId)
            : true,
      );
  const stage = storedStage ?? emptyArrayStage;
  if (!stage) return [];
  const selected = scope?.target.kind === 'transformation';
  const self =
    !scope ||
    scope.target.kind === 'value' ||
    scope.target.kind === 'constraint' ||
    !!evaluation?.relationContext;
  if (!selected && !self) return [];
  const current =
    selected &&
    (scope?.target.tool?.signature.name === 'offset' ||
      scope?.target.tool?.signature.name === 'rotate')
      ? scope.target
      : undefined;
  if (selected && !current) return [];
  const transformations = (occurrence.node.transformations ?? []).filter(
    value => stage.transformationIds.includes(value.id),
  );
  const finalRef =
    transformations.at(-1)?.sourceRefs.at(-1) ??
    occurrence.node.constraints
      .find(value => value.id === stage.constraintIds.at(-1))
      ?.sourceRefs.at(-1);
  const endTarget =
    finalRef &&
    module.sourceTargets.find(
      target =>
        (target.kind === 'constraint' || target.kind === 'transformation') &&
        target.sourceRef.file === finalRef.file &&
        target.sourceRef.end === finalRef.end &&
        target.transformationInsertion,
    );
  const memberStage = (candidate: SpatialToolOccurrence) =>
    insertionScope
      ? candidate.node.relationStages?.at(-1)
      : candidate.node.relationStages?.find(
          group =>
            group.constraintIds.some(id =>
              candidate.node.constraints
                .find(value => value.id === id)
                ?.sourceRefs.some(ref => finalRef && sameSource(ref, finalRef)),
            ) ||
            group.transformationIds.some(id =>
              candidate.node.transformations
                ?.find(value => value.id === id)
                ?.sourceRefs.some(ref => finalRef && sameSource(ref, finalRef)),
            ),
        );
  const members = occurrences.filter(
    candidate =>
      memberStage(candidate) ||
      (emptyArrayStage &&
        scope!.target.evaluations.some(
          e => e.relationOwnerNodeId === candidate.node.nodeId,
        )),
  );
  const tools = (
    ['translate', 'rotate-point', 'rotate-axis'] as const
  ).flatMap<TransformGizmoBinding>(tool => {
    const operation = tool === 'translate' ? 'offset' : 'rotate';
    const axisOnly = tool === 'rotate-axis';
    const authored =
      current &&
      current.tool?.signature.name === operation &&
      (operation === 'offset' ||
        !!evaluation?.relationSpatial?.spatial.axisOnly === axisOnly)
        ? current
        : undefined;
    if (authored) {
      const evaluations = members.flatMap<SourceTargetEvaluation>(candidate => {
        const source = authored.evaluations.find(value =>
          candidate.node.transformations?.some(
            transformation => transformation.id === value.transformationId,
          ),
        );
        const transformation = candidate.node.transformations?.find(
          value => value.id === source?.transformationId,
        );
        const ref = transformation?.sourceRefs.find(
          ref =>
            ref.end === authored.sourceRef.end &&
            ref.file === authored.sourceRef.file,
        );
        const action =
          operation === 'rotate'
            ? transformation?.rotations.find(value =>
                value.sourceRefs.some(value => ref && sameSource(value, ref)),
              )
            : transformation?.offsets.find(value =>
                value.sourceRefs.some(value => ref && sameSource(value, ref)),
              );
        if (!source || !action) return [];
        const spatial: ModelSpatialOperation =
          'spatial' in action
            ? action.spatial
            : {
                origin: [0, 0, 0],
                vector: action.value,
                frame: {
                  position: [0, 0, 0],
                  quaternion: composeTransforms(
                    invertTransform(candidate.node.compositionTransform),
                    action.frame,
                  ).quaternion,
                },
              };
        return [
          {
            ...source,
            relationOwnerNodeId: candidate.node.nodeId,
            relationSpatial: {
              nodeId: candidate.node.nodeId,
              kind: operation,
              spatial,
            },
          },
        ];
      });
      const own = evaluations.find(
        value => value.relationOwnerNodeId === occurrence.node.nodeId,
      );
      return own
        ? spatialBindings(
            module,
            {target: {...authored, evaluations}, evaluation: own},
            occurrence,
            members,
            committed,
            parameterValues,
          )
        : [];
    }
    // No axis exists until a reference is chosen. If another rotation variant
    // is authored, its binding supplies the insertion anchor for the new kind.
    if (
      operation === 'rotate' &&
      (axisOnly ||
        (!insertionScope && current?.tool?.signature.name === 'rotate'))
    )
      return [];
    const insertionTarget = insertionScope
      ? scope!.target
      : (current ?? endTarget ?? scope?.target);
    const insertion = insertionTarget?.transformationInsertion?.[operation];
    const source: SpatialBindingSource | undefined = insertion
      ? {kind: 'transformation-insert', ...insertion}
      : undefined;
    if (!source) return [];
    const objects = members.map(candidate => ({
      key: candidate.key,
      nodeId: candidate.node.nodeId,
      sensitivity: 1,
      spatial: {
        origin: [0, 0, 0] as Vec3,
        vector: [0, 0, 0] as Vec3,
        reference:
          operation === 'rotate' ? defaultRotationReference() : undefined,
        frame:
          operation === 'rotate'
            ? identityRigidTransform
            : {
                position: [0, 0, 0] as Vec3,
                quaternion: composeTransforms(
                  invertTransform(candidate.node.compositionTransform),
                  (memberStage(candidate) ?? emptyArrayStage)!.offsetFrame,
                ).quaternion,
              },
      },
    }));
    const own = objects.find(value => value.nodeId === occurrence.node.nodeId);
    if (!own) return [];
    return (['x', 'y', 'z'] as const).map(axis => ({
      kind: 'spatial' as const,
      placement:
        occurrence.placement === 'composition'
          ? occurrence.node.compositionTransform
          : occurrence.node.transform,
      mode:
        operation === 'rotate' ? ('rotate' as const) : ('translate' as const),
      axis,
      anchor: 'frame' as const,
      label: `${operation === 'rotate' ? 'Rotate' : 'Move'} ${axis.toUpperCase()}`,
      value: 0,
      sensitivity: 1,
      parameterKind:
        operation === 'rotate' ? ('angle' as const) : ('length' as const),
      frame: {...own.spatial.frame, scale: [1, 1, 1] as Vec3},
      spatial: {
        operation,
        source,
        objects,
        ownerNodeId: occurrence.node.nodeId,
        constructors: insertionTarget?.transformationInsertion,
      },
    }));
  });
  return current?.tool?.signature.name === 'rotate'
    ? [
        ...tools.filter(value => value.mode === 'rotate'),
        ...tools.filter(value => value.mode !== 'rotate'),
      ]
    : tools;
}

export function spatialIntent(
  binding: Extract<TransformGizmoBinding, {kind: 'spatial'}>,
  value: number,
): Extract<ToolIntent, {kind: 'model.spatial'}> {
  const delta = value - binding.value;
  const index = axisIndex(binding.axis);
  const source = binding.spatial.source;
  const vector: [number, number, number] = [0, 0, 0];
  vector[index] = delta;
  const callValues =
    source.kind === 'call-argument'
      ? replaceNumericArgument(source.values, source.path, value)
      : undefined;
  const change =
    source.kind === 'parameter'
      ? {kind: 'parameter' as const, target: source.target, value}
      : source.kind === 'argument'
        ? {
            kind: 'argument' as const,
            sourceRef: source.sourceRef,
            delta,
            value,
            mode: source.mode,
          }
        : source.kind === 'omitted-argument'
          ? {
              kind: 'omitted-argument' as const,
              target: source.target,
              value,
              initialValue: binding.value,
            }
          : source.kind === 'reference-offset'
            ? {
                ...source,
                values: (
                  binding.spatial.objects.find(
                    object => object.nodeId === binding.spatial.ownerNodeId,
                  ) ?? binding.spatial.objects[0]
                ).spatial.vector.map((v, i) =>
                  i === index ? value : v,
                ) as unknown as Vec3,
                delta: vector,
              }
            : source.kind === 'call-argument'
              ? {
                  kind: 'call-argument' as const,
                  sourceRef: source.sourceRef,
                  values: callValues!,
                  value,
                  initialValue: binding.value,
                }
              : {...source, delta: vector};
  return {
    kind: 'model.spatial',
    completeArguments: binding.completeArguments,
    operation: binding.spatial.operation,
    change,
    preview: {
      kind: 'model-spatial',
      continuation: {binding, value},
      parameter:
        source.kind === 'parameter' ? {id: source.target.id, value} : undefined,
      objects: binding.spatial.objects.map(object => {
        const spatial = object.spatial;
        const materialized =
          delta !== 0 &&
          callValues &&
          (binding.spatial.operation === 'pivot'
            ? (callValues[0] as Vec3)
            : spatial.axisOnly && binding.spatial.operation === 'rotate'
              ? ([0, callValues[0] as number, 0] as Vec3)
              : (callValues as Vec3));
        const changes = spatial.vector.map((current, axis) =>
          materialized
            ? materialized[axis] - current
            : axis === index
              ? delta * object.sensitivity
              : 0,
        ) as unknown as Vec3;
        if (
          binding.spatial.operation === 'pivot' ||
          binding.spatial.operation === 'pivotOffset' ||
          binding.spatial.operation === 'axisOffset'
        ) {
          const delta = changes;
          const rotated = rotateVector(
            delta,
            xyzRotation(spatial.rotation ?? [0, 0, 0]),
          );
          const frame = spatial.frame!;
          const movement = rotateVector(
            [
              delta[0] - rotated[0],
              delta[1] - rotated[1],
              delta[2] - rotated[2],
            ],
            frame.quaternion,
          );
          const pivotMovement = rotateVector(delta, frame.quaternion);
          const origin = spatial.origin.map(
            (value, i) => value + pivotMovement[i],
          ) as unknown as Vec3;
          const vector = spatial.vector.map(
            (value, i) => value + delta[i],
          ) as unknown as Vec3;
          return {
            key: object.key,
            nodeId: object.nodeId,
            transform: {...identityRigidTransform, position: movement},
            spatial: {
              ...spatial,
              origin,
              vector,
              frame: {...frame, position: origin},
              reference: spatial.reference && {
                ...spatial.reference,
                ...(binding.spatial.operation === 'pivot' &&
                spatial.reference.kind === 'pivot'
                  ? {point: vector}
                  : {offset: vector}),
                frame: {...frame, position: origin},
              },
            },
          };
        }
        if (binding.spatial.operation === 'offset') {
          const movement = rotateVector(
            changes,
            spatial.frame?.quaternion ?? identityRigidTransform.quaternion,
          );
          return {
            key: object.key,
            nodeId: object.nodeId,
            transform: {
              ...identityRigidTransform,
              position: rotateVector(
                changes,
                spatial.frame?.quaternion ?? identityRigidTransform.quaternion,
              ),
            },
            spatial: {
              ...spatial,
              origin: spatial.origin.map(
                (value, i) => value + movement[i],
              ) as unknown as Vec3,
              vector: spatial.vector.map(
                (value, i) => value + changes[i],
              ) as unknown as Vec3,
            },
          };
        }
        if (binding.spatial.operation !== 'rotate') {
          const origin = spatial.origin.map(
            (value, axis) => value + changes[axis],
          ) as unknown as Vec3;
          const vector = spatial.vector.map(
            (value, axis) => value + changes[axis],
          ) as unknown as Vec3;
          return {
            key: object.key,
            nodeId: object.nodeId,
            // Hold the gesture-start geometry fixed while showing its candidate origin.
            // Committing re-expresses it in the result frame through originDelta.
            transform: identityRigidTransform,
            originDelta: origin,
            spatial: {origin, vector},
          };
        }
        const angles = spatial.vector.map(
          (value, axis) => value + changes[axis],
        ) as unknown as Vec3;
        return {
          key: object.key,
          nodeId: object.nodeId,
          spatial: {...spatial, vector: angles},
          transform: spatial.frame
            ? composeTransforms(
                composeTransforms(
                  spatial.frame,
                  composeTransforms(
                    rotationAround([0, 0, 0], angles),
                    invertTransform(rotationAround([0, 0, 0], spatial.vector)),
                  ),
                ),
                invertTransform(spatial.frame),
              )
            : composeTransforms(
                rotationAround(spatial.origin, angles),
                invertTransform(rotationAround(spatial.origin, spatial.vector)),
              ),
        };
      }),
    },
  };
}

export function rotationAxisFrame(
  angles: Vec3,
  axis: TransformAxis,
): Quaternion {
  return xyzRotation([
    0,
    axis === 'x' ? angles[1] : 0,
    axis === 'z' ? 0 : angles[2],
  ]);
}

function safeSpatialParameter(
  module: ModelModule,
  candidate: ParameterUsage,
  scope: SourceRef,
): boolean {
  return (
    [...module.objects.values()].every(object =>
      object.parameters
        .filter(usage => usage.target.id === candidate.target.id)
        .every(
          usage =>
            usage.argument === candidate.argument &&
            sameSource(usage.operationRef, candidate.operationRef),
        ),
    ) && candidate.operationRef.file === scope.file
  );
}

export function isSpatialOperation(
  kind: ModelOperationSnapshot['kind'],
): kind is Exclude<
  ModelSpatialBinding['operation'],
  'pivot' | 'pivotOffset' | 'axisOffset' | 'offset'
> {
  return (
    kind === 'originOffset' ||
    kind === 'originPoint' ||
    kind === 'originVertex' ||
    kind === 'originCenter' ||
    kind === 'rotate'
  );
}

export function axisIndex(axis: TransformAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

function sameSource(left: SourceRef, right: SourceRef): boolean {
  return (
    left.file === right.file &&
    left.start === right.start &&
    left.end === right.end
  );
}

/** Continue an authored spatial edit against its committed numeric/frame baseline. */
export function continuedSpatialBindings(
  bindings: readonly TransformGizmoBinding[],
  edited: Extract<TransformGizmoBinding, {kind: 'spatial'}>,
  value: number,
  objects: readonly SpatialObjectPreview[],
): readonly TransformGizmoBinding[] {
  const source = edited.spatial.source;
  if (source.kind === 'reference-offset' && source.append) return [];
  if (!(
    source.kind === 'parameter' ||
    source.kind === 'reference-offset' ||
    (source.kind === 'argument' && source.mode === 'offset')
  ))
    return [];
  const own = objects.find(
    object => object.nodeId === edited.spatial.ownerNodeId,
  );
  if (!own) return [];
  return bindings.flatMap(binding => {
    if (
      binding.kind !== 'spatial' ||
      binding.spatial.operation !== edited.spatial.operation ||
      !binding.spatial.operationRef ||
      !edited.spatial.operationRef ||
      !sameSource(binding.spatial.operationRef, edited.spatial.operationRef)
    )
      return [];
    const axis = axisIndex(binding.axis);
    const parameter = binding.spatial.source.kind === 'parameter';
    const nextValue = parameter
      ? binding.spatial.source.kind === 'parameter' &&
        source.kind === 'parameter' &&
        binding.spatial.source.target.id === source.target.id
        ? value
        : binding.value
      : own.spatial.vector[axis];
    const quaternion =
      binding.mode === 'rotate'
        ? composeTransforms(own.spatial.frame ?? identityRigidTransform, {
            position: [0, 0, 0],
            quaternion: rotationAxisFrame(own.spatial.vector, binding.axis),
          }).quaternion
        : (own.spatial.frame?.quaternion ?? binding.frame.quaternion);
    return [
      {
        ...binding,
        value: nextValue,
        completeArguments: undefined,
        frame: {...binding.frame, position: own.spatial.origin, quaternion},
        spatial: {
          ...binding.spatial,
          objects: binding.spatial.objects.map(object => ({
            ...object,
            spatial:
              objects.find(next => next.key === object.key)?.spatial ??
              object.spatial,
          })),
        },
      },
    ];
  });
}

function defaultRotationReference(): NonNullable<
  ModelSpatialOperation['reference']
> {
  return {
    kind: 'pivot',
    point: [0, 0, 0],
    offset: [0, 0, 0],
    offsetExplicit: false,
    rotation: [0, 0, 0],
    explicit: false,
    frame: identityRigidTransform,
  };
}
