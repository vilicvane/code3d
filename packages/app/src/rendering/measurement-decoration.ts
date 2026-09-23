import type {DimensionSegment, Vec3} from '@code3d/core';
import * as THREE from 'three';
import {spatialAxisColors} from '../spatial-axis-colors';
import type {ViewportMeasurementDecoration} from '../viewport-decoration';
import type {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {
  createScreenSpaceEdgeLines,
  ScreenSpaceDashedLines,
} from './screen-space-lines';
import {worldUnitsPerPixel} from './screen-space';

const labelStyle = {
  font: '14px sans-serif',
  height: 24,
  padding: 7,
  offset: 19,
  rasterScale: 2,
  color: '#e2e2e2',
  background: '#252525',
} as const;

const lineStyle = {width: 1, tick: 12} as const;

/** Passive dimension: a measured segment or highlighted edge with a value label. */
export class MeasurementDecorationObject extends THREE.Group {
  private readonly start: THREE.Vector3;
  private readonly end: THREE.Vector3;
  private readonly midpoint: THREE.Vector3;
  private readonly ticks: LineSegments2;
  private readonly tickPositions = new Float32Array(12);
  private readonly label: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  >;
  private readonly texture: THREE.CanvasTexture;
  private readonly labelWidth: number;

  constructor(
    decoration: ViewportMeasurementDecoration &
      (DimensionSegment | Readonly<{at: Vec3}>),
  ) {
    super();
    this.name = decoration.id;
    this.userData.decoration = decoration;
    this.start = new THREE.Vector3(
      ...('at' in decoration ? decoration.at : decoration.start),
    );
    this.end = new THREE.Vector3(
      ...('at' in decoration ? decoration.at : decoration.end),
    );
    this.midpoint = this.start.clone().add(this.end).multiplyScalar(0.5);
    const {color, opacity} = decoration.appearance;
    if (this.start.distanceToSquared(this.end) > 0) {
      const createLine =
        decoration.style === 'edge'
          ? createScreenSpaceEdgeLines
          : (...args: ConstructorParameters<typeof ScreenSpaceDashedLines>) =>
              new ScreenSpaceDashedLines(...args);
      const line = createLine(
        new Float32Array([...this.start.toArray(), ...this.end.toArray()]),
        color,
        lineStyle.width,
        opacity,
        false,
        30,
      );
      line.name = 'distance-line';
      this.add(line);
    }
    this.ticks = createScreenSpaceEdgeLines(
      this.tickPositions,
      color,
      lineStyle.width,
      opacity,
      false,
      31,
    );
    this.ticks.name = 'distance-ticks';
    this.ticks.frustumCulled = false;
    this.ticks.geometry.instanceCount =
      'at' in decoration || decoration.style === 'edge'
        ? 0
        : this.start.equals(this.end)
          ? 1
          : 2;
    this.add(this.ticks);
    const prefix = `${Number(decoration.value.toPrecision(8))}${decoration.axisLabel ? ' · ' : ''}`;
    const text = prefix + (decoration.axisLabel ?? '');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = labelStyle.font;
    this.labelWidth =
      Math.ceil(context.measureText(text).width) + labelStyle.padding * 2;
    canvas.width = this.labelWidth * labelStyle.rasterScale;
    canvas.height = labelStyle.height * labelStyle.rasterScale;
    context.scale(labelStyle.rasterScale, labelStyle.rasterScale);
    context.fillStyle = labelStyle.background;
    context.beginPath();
    context.roundRect(0, 0, this.labelWidth, labelStyle.height, 4);
    context.fill();
    context.font = labelStyle.font;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = labelStyle.color;
    context.fillText(prefix, labelStyle.padding, labelStyle.height / 2);
    if (decoration.axisLabel) {
      const axis = decoration.axisLabel.toLowerCase();
      context.fillStyle =
        axis === 'x' || axis === 'y' || axis === 'z'
          ? spatialAxisColors[axis]
          : labelStyle.color;
      context.fillText(
        decoration.axisLabel,
        labelStyle.padding + context.measureText(prefix).width,
        labelStyle.height / 2,
      );
    }
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.label.name = 'distance-label';
    this.label.userData.text = text;
    this.label.matrixAutoUpdate = false;
    this.label.frustumCulled = false;
    this.label.raycast = () => undefined;
    this.label.renderOrder = 32;
    this.add(this.label);
  }

  update(camera: THREE.Camera, viewportHeight: number): void {
    if (viewportHeight <= 0) return;
    this.updateWorldMatrix(true, false);
    const start = this.start.clone().applyMatrix4(this.matrixWorld);
    const end = this.end.clone().applyMatrix4(this.matrixWorld);
    const from = start.clone().project(camera),
      to = end.clone().project(camera);
    const aspect =
      camera.projectionMatrix.elements[5] / camera.projectionMatrix.elements[0];
    const perpendicular = new THREE.Vector3(
      -(to.y - from.y),
      (to.x - from.x) * aspect,
      0,
    );
    if (perpendicular.lengthSq() === 0) perpendicular.set(0, 1, 0);
    perpendicular
      .normalize()
      .applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const inverse = this.matrixWorld.clone().invert();
    for (const [index, point] of [start, end].entries()) {
      const half =
        (worldUnitsPerPixel(camera, point, viewportHeight) * lineStyle.tick) /
        2;
      point
        .clone()
        .addScaledVector(perpendicular, -half)
        .applyMatrix4(inverse)
        .toArray(this.tickPositions, index * 6);
      point
        .clone()
        .addScaledVector(perpendicular, half)
        .applyMatrix4(inverse)
        .toArray(this.tickPositions, index * 6 + 3);
    }
    (
      this.ticks.geometry.getAttribute(
        'instanceStart',
      ) as THREE.InterleavedBufferAttribute
    ).data.needsUpdate = true;
    const position = this.midpoint.clone().applyMatrix4(this.matrixWorld);
    const pixel = worldUnitsPerPixel(camera, position, viewportHeight);
    const quaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    position.add(
      new THREE.Vector3(0, labelStyle.offset * pixel, 0).applyQuaternion(
        quaternion,
      ),
    );
    this.label.matrix
      .copy(this.matrixWorld)
      .invert()
      .multiply(
        new THREE.Matrix4().compose(
          position,
          quaternion,
          new THREE.Vector3(
            this.labelWidth * pixel,
            labelStyle.height * pixel,
            1,
          ),
        ),
      );
    this.label.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    // Geometry/material disposal belongs to the viewport decoration layer.
    this.texture.dispose();
  }
}
