import * as THREE from 'three';
import {gridStep} from '../grid-scale';
import {spatialAxisColors} from '../spatial-axis-colors';
import {cameraAspect, cameraViewHeight, type ViewCamera} from './view-camera';

export type GridPlane = 'XY' | 'XZ' | 'YZ';

const planeRotations: Record<GridPlane, THREE.Quaternion> = {
  XY: new THREE.Quaternion(),
  XZ: new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
  ),
  YZ: new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  ),
};

/** One unbounded work plane. Rays start at the focus plane to keep dolly zooms
 * and very small models numerically stable, rather than unprojecting a far plane. */
export class AdaptiveGrid extends THREE.Mesh<
  THREE.PlaneGeometry,
  THREE.ShaderMaterial
> {
  readonly focus = new THREE.Vector3();
  target?: THREE.Object3D;
  plane: GridPlane = 'XZ';
  step = 1;
  private readonly origin = new THREE.Vector3();
  private readonly frame = new THREE.Quaternion();
  private readonly inverseFrame = new THREE.Quaternion();
  private readonly direction = new THREE.Vector3();

  constructor(background: THREE.Color) {
    const color = background.clone().convertLinearToSRGB();
    color.setRGB(1 - color.r, 1 - color.g, 1 - color.b, THREE.SRGBColorSpace);
    super(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          color: {value: color},
          axisUColor: {value: new THREE.Color()},
          axisVColor: {value: new THREE.Color()},
          focusPoint: {value: new THREE.Vector3()},
          gridOffset: {value: new THREE.Vector2()},
          axisOffset: {value: new THREE.Vector2()},
          right: {value: new THREE.Vector3()},
          up: {value: new THREE.Vector3()},
          forward: {value: new THREE.Vector3()},
          perspective: {value: 1},
          viewHeight: {value: 1},
          viewDistance: {value: 1},
          gridSpacing: {value: 1},
          pixelRatio: {value: 1},
          depthProjection: {value: new THREE.Vector4()},
        },
        vertexShader: `
          varying vec2 screen;
          void main() {
            screen = position.xy;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 color, axisUColor, axisVColor, focusPoint, right, up, forward;
          uniform float perspective, viewHeight, viewDistance, gridSpacing, pixelRatio;
          uniform vec2 gridOffset, axisOffset;
          uniform vec4 depthProjection;
          varying vec2 screen;

          float lines(vec2 point, vec2 footprint, float spacing) {
            vec2 distance = abs(fract(point / spacing - 0.5) - 0.5) * spacing;
            vec2 pixels = distance / footprint;
            vec2 coverage = 1.0 - smoothstep(vec2(0.0), vec2(1.0), pixels);
            // Foreshortened lines disappear before they can form a moiré pattern.
            coverage *= smoothstep(vec2(2.0), vec2(6.0), spacing / footprint);
            return max(coverage.x, coverage.y);
          }
          float grid(vec2 point, vec2 footprint, float spacing) {
            return max(0.08 * lines(point, footprint, spacing),
                       0.14 * lines(point, footprint, spacing * 5.0));
          }
          void main() {
            vec3 offset = right * screen.x + up * screen.y;
            vec3 ray = forward + offset * perspective;
            if (abs(ray.z) < 0.000001) discard;
            vec3 start = focusPoint + offset;
            float travel = -start.z / ray.z;
            vec2 point = (start + travel * ray).xy;
            float depth = viewDistance + travel * viewHeight;
            vec4 p = depthProjection;
            float clipW = -depth * p.z + p.w;
            float ndcDepth = (-depth * p.x + p.y) / clipW;
            if (clipW <= 0.0 || ndcDepth < -1.0 || ndcDepth > 1.0) discard;
            gl_FragDepth = ndcDepth * 0.5 + 0.5;
            vec2 footprint = max(fwidth(point) * pixelRatio, vec2(0.0000001));
            float opacity = grid(point + gridOffset, footprint, gridSpacing);
            vec2 axes = 1.0 - smoothstep(vec2(0.0), footprint, abs(point + axisOffset));
            float axisOpacity = 0.6 * max(axes.x, axes.y);
            opacity = max(opacity, axisOpacity);
            // u = 0 runs along v, and v = 0 runs along u.
            vec3 axisColor = (axisUColor * axes.y + axisVColor * axes.x)
              / max(axes.x + axes.y, 0.000001);
            vec3 lineColor = mix(color, axisColor, axisOpacity / max(opacity, 0.000001));
            // Perspective has a soft horizon; an aligned orthographic grid fills the view.
            float fade = perspective == 0.0 ? 1.0 :
              1.0 - smoothstep(2.0, 5.0, length(point));
            gl_FragColor = vec4(lineColor, opacity * fade);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.name = 'work-plane-grid';
    this.frustumCulled = false;
    this.renderOrder = -1000;
    this.raycast = () => undefined;
  }

  update(
    camera: ViewCamera,
    height: number,
    pixelRatio: number,
    focus = this.focus,
  ): void {
    if (this.target) {
      this.target.updateWorldMatrix(true, false);
      this.target.getWorldPosition(this.origin);
      this.target.getWorldQuaternion(this.frame);
    } else {
      this.origin.set(0, 0, 0);
      this.frame.identity();
    }
    this.inverseFrame.copy(this.frame).invert();
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.direction).applyQuaternion(this.inverseFrame);
    this.plane =
      camera instanceof THREE.OrthographicCamera
        ? Math.abs(this.direction.x) > Math.abs(this.direction.y) &&
          Math.abs(this.direction.x) > Math.abs(this.direction.z)
          ? 'YZ'
          : Math.abs(this.direction.z) > Math.abs(this.direction.y)
            ? 'XY'
            : 'XZ'
        : 'XZ';
    // Map grid XY into the chosen plane in the reference frame (no instance scale).
    this.inverseFrame
      .copy(this.frame)
      .multiply(planeRotations[this.plane])
      .invert();
    const distance = camera.position.distanceTo(focus);
    const span = cameraViewHeight(camera, distance);
    this.step = gridStep(height / span);
    const uniforms = this.material.uniforms;
    // YZ's rotated grid basis is (-Z, +Y); color follows the physical axis.
    uniforms.axisUColor.value.set(
      this.plane === 'YZ' ? spatialAxisColors.z : spatialAxisColors.x,
    );
    uniforms.axisVColor.value.set(
      this.plane === 'XZ' ? spatialAxisColors.z : spatialAxisColors.y,
    );
    uniforms.focusPoint.value
      .copy(focus)
      .sub(this.origin)
      .applyQuaternion(this.inverseFrame)
      .divideScalar(span);
    // Reduce the periodic coordinates on the CPU before uploading floats. Large
    // pans must not lose sub-cell precision or move the grid's actual origin.
    const localFocus = uniforms.focusPoint.value as THREE.Vector3;
    uniforms.axisOffset.value.set(localFocus.x, localFocus.y);
    const period = this.step * 5;
    uniforms.gridOffset.value.set(
      ((localFocus.x * span) % period) / span,
      ((localFocus.y * span) % period) / span,
    );
    localFocus.x = localFocus.y = 0;
    uniforms.right.value
      .set(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .applyQuaternion(this.inverseFrame)
      .multiplyScalar(cameraAspect(camera) / 2);
    uniforms.up.value
      .set(0, 1, 0)
      .applyQuaternion(camera.quaternion)
      .applyQuaternion(this.inverseFrame)
      .multiplyScalar(0.5);
    uniforms.forward.value
      .set(0, 0, -1)
      .applyQuaternion(camera.quaternion)
      .applyQuaternion(this.inverseFrame);
    uniforms.viewHeight.value = span;
    uniforms.viewDistance.value = distance;
    uniforms.perspective.value =
      camera instanceof THREE.PerspectiveCamera ? span / distance : 0;
    uniforms.gridSpacing.value = this.step / span;
    uniforms.pixelRatio.value = pixelRatio;
    const p = camera.projectionMatrix.elements;
    uniforms.depthProjection.value.set(p[10], p[14], p[11], p[15]);
  }
}
