import {Matrix4, Vector4} from 'three';
import type {RenderMesh} from '@code3d/core/tooling';

export const topologyPickRadius = 6;

/** Pick displayed topology in CSS pixels, independently of model scale and zoom. */
export function pickScreenTopology(
  mesh: RenderMesh,
  kind: 'vertex' | 'edge',
  localToClip: Matrix4,
  pointer: Readonly<{x: number; y: number}>,
  viewport: Readonly<{width: number; height: number}>,
): number | undefined {
  let nearestId: number | undefined;
  let nearestDistance = topologyPickRadius ** 2;
  let nearestDepth = Infinity;
  const start = new Vector4();
  const end = new Vector4();
  const project = (point: Vector4): void => {
    point.set(
      ((point.x / point.w + 1) * viewport.width) / 2,
      ((1 - point.y / point.w) * viewport.height) / 2,
      point.z / point.w,
      1,
    );
  };
  const consider = (id: number, x: number, y: number, depth: number): void => {
    const distance = (x - pointer.x) ** 2 + (y - pointer.y) ** 2;
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && depth < nearestDepth)
    ) {
      nearestId = id;
      nearestDistance = distance;
      nearestDepth = depth;
    }
  };

  if (kind === 'vertex') {
    mesh.vertexIds.forEach((id, index) => {
      start
        .set(
          mesh.topologyVertices[index * 3],
          mesh.topologyVertices[index * 3 + 1],
          mesh.topologyVertices[index * 3 + 2],
          1,
        )
        .applyMatrix4(localToClip);
      if (start.w <= 0 || start.z < -start.w || start.z > start.w) return;
      project(start);
      consider(id, start.x, start.y, start.z);
    });
  } else {
    for (const group of mesh.edgeGroups) {
      for (
        let offset = group.start * 3;
        offset < (group.start + group.count) * 3;
        offset += 6
      ) {
        start
          .set(
            mesh.edges[offset],
            mesh.edges[offset + 1],
            mesh.edges[offset + 2],
            1,
          )
          .applyMatrix4(localToClip);
        end
          .set(
            mesh.edges[offset + 3],
            mesh.edges[offset + 4],
            mesh.edges[offset + 5],
            1,
          )
          .applyMatrix4(localToClip);
        if (!clipSegmentDepth(start, end)) continue;
        project(start);
        project(end);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((pointer.x - start.x) * dx + (pointer.y - start.y) * dy) /
                    lengthSquared,
                ),
              );
        consider(
          group.edgeId,
          start.x + t * dx,
          start.y + t * dy,
          start.z + t * (end.z - start.z),
        );
      }
    }
  }
  return nearestId;
}

function clipSegmentDepth(start: Vector4, end: Vector4): boolean {
  // Clip before dividing by w so segments crossing the camera cannot hit behind it.
  for (const sign of [1, -1]) {
    const startDistance = start.w + sign * start.z;
    const endDistance = end.w + sign * end.z;
    if (startDistance < 0 && endDistance < 0) return false;
    if (startDistance < 0)
      start.lerp(end, startDistance / (startDistance - endDistance));
    else if (endDistance < 0)
      end.lerp(start, endDistance / (endDistance - startDistance));
  }
  return start.w > 0 && end.w > 0;
}
