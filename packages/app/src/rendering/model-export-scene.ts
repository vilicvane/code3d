import {Color, Quaternion, Vector3} from 'three';
import type {Occurrence} from '../viewport';
import type {ModelExportInstance} from '../model/model-export';
import type {ModelModule} from '../model/compiler';
import type {SourceRef} from '@code3d/core/tooling';

/** Only foreground model occurrences: no contextual ghosts or helper geometry. */
export function collectExportInstances(
  occurrences: Iterable<Occurrence>,
): ModelExportInstance[] {
  return [...occurrences]
    .filter(({node}) => node.kind !== 'group')
    .map(({node, object}) => {
      object.updateWorldMatrix(true, false);
      const position = new Vector3();
      const quaternion = new Quaternion();
      const scale = new Vector3();
      object.matrixWorld.decompose(position, quaternion, scale);
      return {
        nodeId: node.nodeId,
        name: node.name,
        kind: node.kind,
        color: node.color
          ? `#${new Color(node.color).getHexString()}`
          : undefined,
        transform: {
          position: position.toArray(),
          quaternion: quaternion.toArray(),
        },
      };
    });
}

export function renderedModelName(
  module: ModelModule,
  rootNodeIds: readonly string[],
  sourceRef?: SourceRef,
): string {
  const roots = new Set(rootNodeIds);
  const bindings = module.catalog.filter(entry => {
    if (entry.category !== 'binding' || !roots.size) return false;
    const executions = new Map<number, Set<string>>();
    for (const occurrence of entry.occurrences) {
      const nodes = executions.get(occurrence.execution) ?? new Set<string>();
      nodes.add(occurrence.nodeId);
      executions.set(occurrence.execution, nodes);
    }
    return [...executions.values()].some(
      nodes =>
        nodes.size === roots.size && [...roots].every(id => nodes.has(id)),
    );
  });
  const sourceSpan = (ref: SourceRef) =>
    sourceRef !== undefined &&
    ref.file === sourceRef.file &&
    ref.start <= sourceRef.start &&
    ref.end >= sourceRef.end
      ? ref.end - ref.start
      : Infinity;
  bindings.sort((left, right) => {
    const leftSpan = sourceSpan(left.sourceRef);
    const rightSpan = sourceSpan(right.sourceRef);
    if (leftSpan !== rightSpan) return leftSpan - rightSpan;
    return (
      Number(right.scope === 'module') - Number(left.scope === 'module') ||
      left.firstOrder - right.firstOrder
    );
  });
  return bindings[0]?.label ?? 'code3d-model';
}
