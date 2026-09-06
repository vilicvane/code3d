import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

export const cornerLineStyle = {fraction: 0.18, maxPixels: 32} as const;

/** Box and face corners update before the renderer uploads their geometry. */
export class ScreenSpaceCornerLines extends LineSegments2 {
  private readonly positions: Float32Array;
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly projection = new THREE.Matrix4();
  private readonly start = new THREE.Vector4();
  private readonly end = new THREE.Vector4();

  constructor(
    private readonly edges: Float32Array,
    color: string,
    width: number,
    opacity = 1,
    depthTest = true,
    renderOrder = 0,
  ) {
    const positions = new Float32Array(edges.length * 2);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    super(geometry, screenSpaceLineMaterial(color, width, opacity, depthTest));
    this.positions = positions;
    this.buffer = (
      geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    ).data;
    this.renderOrder = renderOrder;
    this.frustumCulled = false;
    this.raycast = () => undefined;
  }

  update(
    camera: THREE.Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    this.updateWorldMatrix(true, false);
    const {projection: matrix, start, end, edges, positions, buffer} = this;
    matrix
      .copy(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse)
      .multiply(this.matrixWorld);
    for (let i = 0; i < edges.length; i += 6) {
      start.set(edges[i], edges[i + 1], edges[i + 2], 1).applyMatrix4(matrix);
      end.set(edges[i + 3], edges[i + 4], edges[i + 5], 1).applyMatrix4(matrix);
      const length = Math.hypot(
        ((end.x / end.w - start.x / start.w) * viewportWidth) / 2,
        ((end.y / end.w - start.y / start.w) * viewportHeight) / 2,
      );
      const fraction = Math.min(1, cornerLineStyle.maxPixels / length);
      // Perspective interpolation differs at the two ends of a receding edge.
      const atStart =
        start.w > 0 && end.w > 0
          ? (fraction * start.w) / (end.w * (1 - fraction) + start.w * fraction)
          : cornerLineStyle.fraction;
      const atEnd =
        start.w > 0 && end.w > 0
          ? (fraction * end.w) / (start.w * (1 - fraction) + end.w * fraction)
          : cornerLineStyle.fraction;
      for (let axis = 0; axis < 3; axis++) {
        const a = edges[i + axis],
          b = edges[i + 3 + axis];
        positions[i * 2 + axis] = a;
        positions[i * 2 + 3 + axis] =
          a + (b - a) * Math.min(cornerLineStyle.fraction, atStart);
        positions[i * 2 + 6 + axis] = b;
        positions[i * 2 + 9 + axis] =
          b + (a - b) * Math.min(cornerLineStyle.fraction, atEnd);
      }
    }
    buffer.needsUpdate = true;
  }
}

export function createScreenSpaceEdgeLines(
  positions: Float32Array,
  color: string,
  width: number,
  opacity = 1,
  depthTest = true,
  renderOrder = 0,
): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = screenSpaceLineMaterial(color, width, opacity, depthTest);
  const lines = new LineSegments2(geometry, material);
  lines.raycast = () => undefined;
  lines.renderOrder = renderOrder;
  return lines;
}

function screenSpaceLineMaterial(
  color: string,
  width: number,
  opacity: number,
  depthTest: boolean,
): LineMaterial {
  const material = new LineMaterial({
    color,
    transparent: true,
    opacity,
    depthTest,
    depthWrite: false,
    worldUnits: false,
  });
  Object.assign(material, {linewidth: width});
  material.toneMapped = false;
  return material;
}
