import * as THREE from 'three';
import type {
  ViewportAnchorDecoration,
  ViewportDecoration,
} from '../viewport-decoration';
import {applyTransform} from './model-renderer';
import {worldUnitsPerPixel} from './screen-space';
import {ScreenSpaceArrowHead} from './screen-space-arrow-head';
import {createScreenSpaceEdgeLines} from './screen-space-lines';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';

// CSS pixels, independent of model extent, occurrence scale and camera zoom.
export const anchorPixels = {
  arrowLength: 28,
  ringRadius: 4,
  pointRadius: 3,
  crossRadius: 10,
  frameLength: 24,
} as const;

type Marker = Readonly<{object: THREE.Object3D; position: THREE.Vector3}>;

export class AnchorDecorationObject extends THREE.Group {
  private readonly markers: Marker[] = [];
  private readonly axisShaft?: Readonly<{
    buffer: THREE.InterleavedBuffer;
    negative?: THREE.Object3D;
    positive?: THREE.Object3D;
  }>;
  private readonly inverseWorld = new THREE.Matrix4();
  private readonly markerWorld = new THREE.Matrix4();
  private readonly positionWorld = new THREE.Vector3();
  private readonly rotationWorld = new THREE.Quaternion();
  private readonly scaleWorld = new THREE.Vector3();

  constructor(decoration: ViewportAnchorDecoration) {
    super();
    const {appearance} = decoration;
    this.name = decoration.id;
    this.userData.decoration = decoration;
    this.renderOrder = decoration.layer === 'foreground' ? 1 : 0;
    applyTransform(this, decoration.transform);
    const marker = (glyph: THREE.Object3D, y = 0) => {
      const object = new THREE.Group();
      object.add(glyph);
      object.matrixAutoUpdate = false;
      this.markers.push({object, position: new THREE.Vector3(0, y, 0)});
      this.add(object);
    };
    const arrow = (direction: 1 | -1) =>
      anchorArrow(
        new THREE.Vector3(0, direction, 0),
        anchorPixels.arrowLength,
        appearance,
      );

    if (decoration.elementKind === 'point') {
      const point = new THREE.Group();
      point.add(
        anchorDot(anchorPixels.pointRadius, appearance),
        anchorCross(anchorPixels.crossRadius, appearance),
      );
      marker(point);
    } else if (decoration.elementKind === 'line') {
      if (decoration.headOnly) {
        this.add(
          new ScreenSpaceArrowHead(
            new THREE.Vector3(0, decoration.direction ?? 1, 0),
            new THREE.Color(appearance.color),
          ),
        );
      } else {
        const {negative, positive} = decoration.span;
        const shaft = anchorLine(
          [0, -negative, 0],
          [0, positive, 0],
          appearance,
        );
        shaft.frustumCulled = false;
        this.add(shaft);
        const head = (direction: 1 | -1, position: number) => {
          const glyph = new ScreenSpaceArrowHead(
            new THREE.Vector3(0, direction, 0),
            new THREE.Color(appearance.color),
          );
          glyph.position.y = direction * anchorPixels.arrowLength;
          marker(glyph, position);
          return glyph;
        };
        const buffer = (
          shaft.geometry.getAttribute(
            'instanceStart',
          ) as THREE.InterleavedBufferAttribute
        ).data;
        if (decoration.directed) {
          const direction = decoration.direction ?? 1;
          this.axisShaft =
            direction === 1
              ? {buffer, positive: head(1, positive)}
              : {buffer, negative: head(-1, -negative)};
        } else {
          this.axisShaft = {
            buffer,
            positive: head(1, positive),
            negative: head(-1, -negative),
          };
          marker(anchorRing(anchorPixels.ringRadius, appearance));
        }
      }
    } else if (decoration.elementKind === 'face') {
      const face = new THREE.Group();
      face.add(
        anchorRing(anchorPixels.ringRadius, appearance),
        anchorOriginPoint(appearance),
        arrow(decoration.facing ?? 1),
      );
      marker(face);
    } else {
      const frame = new THREE.Group();
      frame.add(
        anchorLine([0, 0, 0], [anchorPixels.frameLength, 0, 0], appearance),
        anchorLine([0, 0, 0], [0, anchorPixels.frameLength, 0], appearance),
        anchorLine([0, 0, 0], [0, 0, anchorPixels.frameLength], appearance),
      );
      marker(frame);
    }
    this.traverse(object => {
      const material = 'material' in object ? object.material : undefined;
      for (const candidate of Array.isArray(material) ? material : [material]) {
        if (!(candidate instanceof THREE.Material)) continue;
        object.renderOrder = 24;
        candidate.depthTest = appearance.depthTest ?? false;
        candidate.depthWrite = false;
        candidate.transparent = true;
        candidate.opacity = appearance.opacity ?? 1;
        candidate.toneMapped = false;
      }
    });
  }

  update(camera: THREE.Camera, viewportHeight: number): void {
    camera.updateWorldMatrix(true, false);
    this.updateWorldMatrix(true, false);
    this.inverseWorld.copy(this.matrixWorld).invert();
    for (const {object, position} of this.markers) {
      this.markerWorld.makeTranslation(position).premultiply(this.matrixWorld);
      this.markerWorld.decompose(
        this.positionWorld,
        this.rotationWorld,
        this.scaleWorld,
      );
      const size = worldUnitsPerPixel(
        camera,
        this.positionWorld,
        viewportHeight,
      );
      this.scaleWorld.setScalar(size);
      object.matrix
        .copy(this.inverseWorld)
        .multiply(
          this.markerWorld.compose(
            this.positionWorld,
            this.rotationWorld,
            this.scaleWorld,
          ),
        );
      object.matrixWorldNeedsUpdate = true;
    }
    if (this.axisShaft) {
      for (const [offset, head] of [
        [0, this.axisShaft.negative],
        [3, this.axisShaft.positive],
      ] as const) {
        if (!head) continue;
        head
          .getWorldPosition(this.positionWorld)
          .applyMatrix4(this.inverseWorld);
        this.positionWorld.toArray(this.axisShaft.buffer.array, offset);
      }
      this.axisShaft.buffer.needsUpdate = true;
    }
  }
}

function anchorArrow(
  direction: THREE.Vector3,
  length: number,
  appearance: ViewportDecoration['appearance'],
): THREE.Object3D {
  const end = direction.clone().multiplyScalar(length);
  const arrow = new THREE.Group();
  const head = new ScreenSpaceArrowHead(
    direction,
    new THREE.Color(appearance.color),
  );
  head.position.copy(end);
  arrow.add(anchorLine([0, 0, 0], end.toArray(), appearance), head);
  return arrow;
}

function anchorCross(
  radius: number,
  appearance: ViewportDecoration['appearance'],
): LineSegments2 {
  return createScreenSpaceEdgeLines(
    new Float32Array([
      -radius,
      0,
      0,
      radius,
      0,
      0,
      0,
      -radius,
      0,
      0,
      radius,
      0,
      0,
      0,
      -radius,
      0,
      0,
      radius,
    ]),
    appearance.color,
    1,
    appearance.opacity,
    appearance.depthTest ?? false,
  );
}

function anchorDot(
  radius: number,
  appearance: ViewportDecoration['appearance'],
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 14),
    anchorSurfaceMaterial(appearance),
  );
}

function anchorRing(
  radius: number,
  appearance: ViewportDecoration['appearance'],
): LineSegments2 {
  const point = (index: number) => {
    const angle = (index / 32) * Math.PI * 2;
    return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
  };
  const positions = Array.from({length: 32}, (_, i) => [
    ...point(i),
    ...point(i + 1),
  ]).flat();
  return createScreenSpaceEdgeLines(
    new Float32Array(positions),
    appearance.color,
    1,
    appearance.opacity,
    appearance.depthTest ?? false,
  );
}

function anchorOriginPoint(
  appearance: ViewportDecoration['appearance'],
): THREE.Points {
  return new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
    new THREE.PointsMaterial({
      color: appearance.color,
      size: 3,
      sizeAttenuation: false,
      transparent: false,
      opacity: 1,
      depthTest: appearance.depthTest ?? false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
}

function anchorLine(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  appearance: ViewportDecoration['appearance'],
): LineSegments2 {
  return createScreenSpaceEdgeLines(
    new Float32Array([...from, ...to]),
    appearance.color,
    1,
    appearance.opacity,
    appearance.depthTest ?? false,
  );
}

function anchorSurfaceMaterial(
  appearance: ViewportDecoration['appearance'],
): THREE.MeshBasicMaterial {
  const opacity = appearance.opacity ?? 1;
  return new THREE.MeshBasicMaterial({
    color: appearance.color,
    transparent: opacity < 1,
    opacity,
    depthTest: appearance.depthTest ?? false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
