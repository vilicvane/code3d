import type {Face as ReplicadFace} from 'replicad';
import type {KernelKeyPart} from './kernel-cache.js';
import {
  evaluateModelGeometry,
  faceModel,
  type FaceModel,
  type ModelOperationKind,
} from './runtime.js';

type PlanarSketch = Readonly<{
  face(): ReplicadFace;
  delete(): void;
}>;

export function planarFaceModel(
  operation: Extract<
    ModelOperationKind,
    'circle' | 'ellipse' | 'rectangle' | 'regularPolygon'
  >,
  name: string,
  arguments_: readonly KernelKeyPart[],
  buildSketch: () => PlanarSketch,
  transform?: (face: ReplicadFace) => ReplicadFace,
): FaceModel {
  const geometry = evaluateModelGeometry(operation, arguments_, [], () => {
    const sketch = buildSketch();
    try {
      const face = sketch.face();
      // Replicad's XZ sketches face -Y. Core's planar profiles face +Y;
      // normalize the native face before normals, offsets and sweeps consume it.
      face.wrapped.Reverse();
      return {shape: transform?.(face) ?? face};
    } finally {
      sketch.delete();
    }
  });
  return faceModel(operation, name, geometry);
}
