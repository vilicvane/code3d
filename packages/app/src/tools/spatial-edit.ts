import {insertTransformationSource} from './source-expression';
import type {TransformGizmoBinding} from './transform-gizmo';
import {
  offsetExpression,
  callIdentifierOffset,
  offsetCallSource,
  formatSourceNumber,
  argumentInsertionSource,
  setCallArgumentsSource,
  completeRotationSource,
  type NumericArgumentValue,
  transformationImportSource,
  referenceOffsetSource,
  rotationReferenceSource,
  type RotationReferenceEdit,
  type TransformationInsertion,
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
  | Readonly<{
      kind: 'rotation-complete';
      sourceRef: SourceRef;
      axisOnly: boolean;
      index: number;
      value: number;
    }>
  | (Readonly<{kind: 'rotation-reference'; sourceRef: SourceRef}> &
      RotationReferenceEdit)
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
    }>
  | Readonly<{
      kind: 'reference-offset';
      sourceRef: SourceRef;
      method: 'pivot' | 'pivotOffset' | 'axisOffset';
      explicit: boolean;
      append?: 'chain' | TransformationInsertion['container'];
      values: Vec3;
      delta: Vec3;
      constructor?: TransformationInsertion;
    }>
  | (Readonly<{kind: 'transformation-insert'; delta: Vec3}> &
      TransformationInsertion);

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
  continuation?: Readonly<{
    binding: Extract<TransformGizmoBinding, {kind: 'spatial'}>;
    value: number;
  }>;
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
    const referenceEdit =
      change.kind === 'rotation-reference'
        ? rotationReferenceSource(expectedText, change)
        : change.kind === 'reference-offset'
          ? referenceOffsetSource(
              expectedText,
              change.method,
              change.values,
              change.delta,
              change.explicit,
              change.constructor?.name,
              change.append,
            )
          : undefined;
    const text =
      change.kind === 'rotation-complete'
        ? completeRotationSource(
            expectedText,
            change.axisOnly,
            change.index,
            change.value,
          )
        : change.kind === 'rotation-reference'
          ? referenceEdit!.text
          : change.kind === 'parameter'
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
                  : change.kind === 'reference-offset'
                    ? referenceEdit!.text
                    : change.kind === 'transformation-insert'
                      ? change.delta.every(value => value === 0)
                        ? expectedText
                        : insertTransformationSource(
                            expectedText,
                            `${change.name}(${change.delta.map(formatSourceNumber).join(', ')})`,
                            change.container,
                          )
                      : change.kind === 'rotation-call'
                        ? change.delta.every(value => value === 0)
                          ? expectedText
                          : `${expectedText}.rotate(${change.delta.map(formatSourceNumber).join(', ')})`
                        : offsetCallSource(
                            expectedText,
                            'originOffset',
                            change.delta,
                          );
    const importEdits = [];
    const addition =
      change.kind === 'rotation-reference' && referenceEdit?.usesConstructor
        ? change.factory?.importAddition
        : change.kind === 'transformation-insert'
          ? change.importAddition
          : change.kind === 'reference-offset' && referenceEdit?.usesConstructor
            ? change.constructor?.importAddition
            : undefined;
    if (text !== expectedText && addition) {
      const reference = context.resolveSourceRef(addition.sourceRef);
      if (!reference)
        return {
          status: 'conflict',
          reason: 'The Core import no longer maps to the source.',
        };
      const previous = context.readSource(reference);
      importEdits.push({
        sourceRef: reference,
        expectedText: previous,
        text: transformationImportSource(
          previous,
          addition.specifier,
          addition.statement,
        ),
      });
    }
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary:
          change.kind === 'rotation-reference'
            ? 'Change rotation reference'
            : change.kind === 'reference-offset'
              ? change.method !== 'axisOffset'
                ? 'Move rotation pivot'
                : 'Move rotation axis'
              : intent.operation === 'rotate'
                ? 'Rotate model'
                : intent.operation === 'offset'
                  ? 'Move related model'
                  : 'Move model origin',
        intent,
        edits:
          ((change.kind === 'omitted-argument' ||
            change.kind === 'call-argument') &&
            change.value === change.initialValue) ||
          (change.kind === 'argument' && change.delta === 0)
            ? []
            : [
                ...importEdits,
                {
                  sourceRef,
                  expectedText,
                  text,
                  focusOffset: callIdentifierOffset(
                    text,
                    change.kind === 'rotation-reference'
                      ? referenceEdit?.usesConstructor && change.factory
                        ? change.factory.name
                        : change.selector
                      : change.kind === 'transformation-insert'
                        ? change.name
                        : change.kind === 'reference-offset'
                          ? referenceEdit?.usesConstructor &&
                            change.method === 'pivot'
                            ? (change.constructor?.name ?? change.method)
                            : change.method
                          : intent.operation,
                  ),
                },
              ],
        preview: intent.preview,
      },
    };
  }
}
