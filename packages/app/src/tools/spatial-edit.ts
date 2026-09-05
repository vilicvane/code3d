import {
  offsetExpression,
  offsetCallSource,
  formatSourceNumber,
} from './source-expression';
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
  | Readonly<{kind: 'argument'; sourceRef: SourceRef; delta: number}>
  | Readonly<{kind: 'origin-offset'; sourceRef: SourceRef; delta: Vec3}>;

export type SpatialObjectPreview = Readonly<{
  key: string;
  nodeId: string;
  transform: RigidTransform;
  spatial: ModelSpatialOperation;
}>;

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
      change.kind === 'parameter' ? change.target.sourceRef : change.sourceRef,
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
          ? offsetExpression(expectedText, change.delta)
          : offsetCallSource(expectedText, 'originOffset', change.delta);
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary:
          intent.operation === 'rotate' ? 'Rotate model' : 'Move model origin',
        intent,
        edits: [{sourceRef, expectedText, text}],
        preview: intent.preview,
      },
    };
  }
}
