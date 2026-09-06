import type {
  ConstraintSnapshot,
  ModelSnapshotObject,
} from '@code3d/core/tooling';
import type {SourceTargetEvaluation} from './compiler';

export function evaluatedConstraint(
  objects: ReadonlyMap<string, ModelSnapshotObject>,
  evaluation: SourceTargetEvaluation,
): ConstraintSnapshot | undefined {
  const owner =
    evaluation.constraintPreview ??
    objects.get(evaluation.constraintOwnerNodeId ?? '');
  return owner?.constraints.find(
    constraint => constraint.id === evaluation.constraintId,
  );
}

export function focusedConstraintSide(
  evaluation: SourceTargetEvaluation,
  constraint: ConstraintSnapshot,
): 'source' | 'target' {
  const focus = evaluation.constraintFocus ?? 'self';
  return focus === 'self'
    ? constraint.source.nodeId === evaluation.constraintOwnerNodeId
      ? 'source'
      : 'target'
    : focus;
}
