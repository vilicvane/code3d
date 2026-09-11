import {
  offsetExpression,
  offsetCallSource,
  formatSourceNumber,
  argumentInsertionSource,
  setCallArgumentsSource,
  type NumericArgumentValue,
} from './source-expression';
import type {ToolArgumentEditTarget} from '../model/tool-schema';
import {identityRigidTransform} from '@code3d/core/tooling';
import type {
  ModelSpatialOperation,
  ParameterTarget,
  RigidTransform,
  SourceRef,
  Vec3,
} from '@code3d/core/tooling';
import type {
  ToolIntent,
  ToolResolution,
  ResolveContext,
  ToolIntentResolver,
} from './tool-system';

export type SpatialSourceChange =
  | Readonly<{kind: 'parameter'; target: ParameterTarget; value: number}>
  | Readonly<{
      kind: 'omitted-argument';
      target: Extract<ToolArgumentEditTarget, {kind: 'omitted'}>;
      value: number;
      initialValue: number;
    }>
  | Readonly<{
      kind: 'call-argument';
      sourceRef: SourceRef;
      values: readonly NumericArgumentValue[];
      value: number;
      initialValue: number;
    }>
  | Readonly<{
      kind: 'argument';
      sourceRef: SourceRef;
      delta: number;
      value: number;
      mode: 'offset' | 'replace';
    }>
  | Readonly<{
      kind: 'origin-offset' | 'rotation-call';
      sourceRef: SourceRef;
      delta: Vec3;
    }>;

export type SpatialObjectPreview = Readonly<{
  key: string;
  nodeId: string;
  transform: RigidTransform;
  spatial: ModelSpatialOperation;
  /** Origin drag stays in the gesture's input frame until commit. */
  originDelta?: Vec3;
}>;

/** Switch from the frozen drag frame to the resulting model coordinates. */
export function committedSpatialObject(
  preview: SpatialObjectPreview,
): SpatialObjectPreview {
  if (!preview.originDelta) return preview;
  const {originDelta, ...result} = preview;
  return {
    ...result,
    transform: {
      ...identityRigidTransform,
      position: [-originDelta[0], -originDelta[1], -originDelta[2]],
    },
    spatial: {...preview.spatial, origin: [0, 0, 0]},
  };
}

export type SpatialPreview = Readonly<{
  kind: 'model-spatial';
  objects: readonly SpatialObjectPreview[];
  parameter?: Readonly<{id: string; value: number}>;
}>;

export class SpatialTransformResolver implements ToolIntentResolver {
  readonly kind = 'model.spatial' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) throw new Error('Expected a spatial edit.');
    const change = intent.change;
    const sourceRef = context.resolveSourceRef(
      change.kind === 'parameter' || change.kind === 'omitted-argument'
        ? change.target.sourceRef
        : change.sourceRef,
    );
    if (!sourceRef)
      return {
        status: 'conflict',
        reason: 'The spatial argument no longer maps to the source.',
      };
    const expectedText = context.readSource(sourceRef);
    const text =
      change.kind === 'parameter'
        ? formatSourceNumber(change.value)
        : change.kind === 'argument'
          ? change.mode === 'replace'
            ? formatSourceNumber(change.value)
            : offsetExpression(expectedText, change.delta)
          : change.kind === 'omitted-argument'
            ? argumentInsertionSource(
                formatSourceNumber(change.value),
                change.target,
              )
            : change.kind === 'call-argument'
              ? setCallArgumentsSource(expectedText, change.values)
              : change.kind === 'rotation-call'
                ? change.delta.every(value => value === 0)
                  ? expectedText
                  : `${expectedText}.rotate(${change.delta.map(formatSourceNumber).join(', ')})`
                : offsetCallSource(expectedText, 'originOffset', change.delta);
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary:
          intent.operation === 'rotate' ? 'Rotate model' : 'Move model origin',
        intent,
        edits:
          ((change.kind === 'omitted-argument' ||
            change.kind === 'call-argument') &&
            change.value === change.initialValue) ||
          (change.kind === 'argument' && change.delta === 0)
            ? []
            : [{sourceRef, expectedText, text}],
        preview: intent.preview,
      },
    };
  }
}
