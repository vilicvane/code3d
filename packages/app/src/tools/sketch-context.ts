import {
  type ModelSnapshotObject,
  type SketchPosition,
  type Transform,
  type Vec3,
} from '@code3d/core/tooling';
import {Matrix4, Quaternion, Vector3} from 'three';
import type {CompiledSketch} from '../model/sketch-trace';

export type SketchContextOutline = Readonly<{
  nodeId: string;
  segments: readonly (readonly [SketchPosition, SketchPosition])[];
}>;

/** Display-only orthographic context. It never introduces sketch entities or snapping targets. */
export function sketchContextOutlines(
  sketch: CompiledSketch,
  objects: ReadonlyMap<string, ModelSnapshotObject>,
): readonly SketchContextOutline[] {
  const result: SketchContextOutline[] = [];
  const matrix = (transform: Transform): Matrix4 =>
    new Matrix4().compose(
      new Vector3(...transform.position),
      new Quaternion(...transform.quaternion),
      new Vector3(...transform.scale),
    );
  const visit = (node: ModelSnapshotObject, transform: Matrix4): void => {
    const project = (point: Vec3): SketchPosition => {
      const local = new Vector3(...point).applyMatrix4(transform);
      return [local.x, -local.z];
    };
    if (node.mesh) {
      const edges = node.mesh.edges;
      const segments: (readonly [SketchPosition, SketchPosition])[] = [];
      for (let i = 0; i < edges.length; i += 6)
        segments.push([
          project([edges[i], edges[i + 1], edges[i + 2]]),
          project([edges[i + 3], edges[i + 4], edges[i + 5]]),
        ]);
      result.push({nodeId: node.nodeId, segments});
    }
    for (const child of node.children)
      visit(child, transform.clone().multiply(matrix(child.transform)));
  };
  for (const reference of sketch.context) {
    const node = objects.get(reference.nodeId);
    if (node) visit(node, matrix(reference.transform));
  }
  return result;
}
