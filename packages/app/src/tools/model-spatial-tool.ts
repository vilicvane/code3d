import {
  composeTransforms,
  identityRigidTransform,
  invertTransform,
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
import type {TransformGizmoBinding, TransformAxis} from './transform-gizmo';
import type {ToolIntent} from './tool-system';
import type {SpatialObjectPreview} from './spatial-edit';

type SpatialToolOccurrence = Readonly<{
  key: string;
  node: ModelSnapshotObject;
  placement: 'standalone' | 'composition';
}>;

export type SpatialBindingSource =
  | Readonly<{kind: 'parameter'; target: ParameterTarget}>
  | Readonly<{kind: 'argument' | 'origin-offset'; sourceRef: SourceRef}>;

export type SpatialBindingObject = Readonly<{
  key: string;
  nodeId: string;
  spatial: ModelSpatialOperation;
  sensitivity: number;
}>;

export type ModelSpatialBinding = Readonly<{
  operation:
    'origin' | 'originOffset' | 'originVertex' | 'originCenter' | 'rotate';
  source: SpatialBindingSource;
  objects: readonly SpatialBindingObject[];
}>;

export function spatialBindings(
  module: ModelModule,
  scope: Readonly<{target: SourceTarget; evaluation: SourceTargetEvaluation}>,
  occurrence: SpatialToolOccurrence,
  occurrences: readonly SpatialToolOccurrence[],
  committed: ReadonlyMap<string, SpatialObjectPreview>,
  parameterValues: ReadonlyMap<string, number>,
): TransformGizmoBinding[] {
  const {target, evaluation} = scope;
  const operation = evaluation.operationId
    ? module.operations.get(evaluation.operationId)
    : undefined;
  const spatial = committed.get(occurrence.key)?.spatial ?? operation?.spatial;
  if (
    !operation ||
    !spatial ||
    !isSpatialOperation(operation.kind) ||
    operation.outputNodeId !== occurrence.node.nodeId
  )
    return [];
  const kind = operation.kind;
  const offsetOrigin = kind === 'originVertex' || kind === 'originCenter';
  const mode = kind === 'rotate' ? 'rotate' : 'translate';
  const usages = editableParameterUsages(evaluation.parameters ?? []);
  const matching = occurrences.filter(
    candidate =>
      candidate.node.operation.siteId === operation.siteId &&
      candidate.node.operation.spatial,
  );
  return (['x', 'y', 'z'] as const).flatMap((axis, index) => {
    const argument = target.tool?.arguments.find(
      argument => argument.index === index,
    )?.target;
    const parameterName = kind === 'originOffset' ? `d${axis}` : axis;
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
      source = {kind: 'argument', sourceRef: argument.sourceRef};
    else return [];
    const frame: Transform = {
      position: spatial.origin,
      quaternion:
        kind === 'rotate'
          ? rotationAxisFrame(spatial.vector, axis)
          : identityRigidTransform.quaternion,
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
        label: `${kind === 'rotate' ? 'Rotate' : 'Origin'} ${axis.toUpperCase()}`,
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
        spatial: {
          operation: kind,
          source,
          objects: matching.map(candidate => ({
            key: candidate.key,
            nodeId: candidate.node.nodeId,
            spatial:
              committed.get(candidate.key)?.spatial ??
              candidate.node.operation.spatial!,
            sensitivity:
              source.kind === 'parameter'
                ? candidate.node.parameters
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

export function spatialIntent(
  binding: Extract<TransformGizmoBinding, {kind: 'spatial'}>,
  value: number,
): ToolIntent {
  const delta = value - binding.value;
  const index = axisIndex(binding.axis);
  const source = binding.spatial.source;
  const vector: [number, number, number] = [0, 0, 0];
  vector[index] = delta;
  const change =
    source.kind === 'parameter'
      ? {kind: 'parameter' as const, target: source.target, value}
      : source.kind === 'argument'
        ? {kind: 'argument' as const, sourceRef: source.sourceRef, delta}
        : {
            kind: 'origin-offset' as const,
            sourceRef: source.sourceRef,
            delta: vector,
          };
  return {
    kind: 'model.spatial',
    operation: binding.spatial.operation,
    change,
    preview: {
      kind: 'model-spatial',
      parameter:
        source.kind === 'parameter' ? {id: source.target.id, value} : undefined,
      objects: binding.spatial.objects.map(object => {
        const offset = delta * object.sensitivity;
        const spatial = object.spatial;
        if (binding.spatial.operation !== 'rotate') {
          const origin: [number, number, number] = [...spatial.origin];
          origin[index] += offset;
          const vector: [number, number, number] = [...spatial.vector];
          vector[index] += offset;
          return {
            key: object.key,
            nodeId: object.nodeId,
            transform: identityRigidTransform,
            spatial: {origin, vector},
          };
        }
        const angles: [number, number, number] = [...spatial.vector];
        angles[index] += offset;
        return {
          key: object.key,
          nodeId: object.nodeId,
          spatial: {...spatial, vector: angles},
          transform: composeTransforms(
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
): kind is ModelSpatialBinding['operation'] {
  return (
    kind === 'origin' ||
    kind === 'originOffset' ||
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
