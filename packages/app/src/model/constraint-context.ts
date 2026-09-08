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

export function evaluatedConstraints(
  objects: ReadonlyMap<string, ModelSnapshotObject>,
  evaluation: SourceTargetEvaluation,
): readonly ConstraintSnapshot[] {
  if (evaluation.relationContext) {
    const ids = new Set(evaluation.relationContext.constraintIds);
    return (
      objects
        .get(evaluation.constraintOwnerNodeId ?? '')
        ?.constraints.filter(constraint => ids.has(constraint.id)) ?? []
    );
  }
  const constraint = evaluatedConstraint(objects, evaluation);
  return constraint ? [constraint] : [];
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
