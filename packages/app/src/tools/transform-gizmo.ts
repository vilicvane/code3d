import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import type {
  ParameterKind,
  ParameterTarget,
  Transform,
} from '@code3d/core/tooling';
import {spatialAxisColors} from '../spatial-axis-colors';
import {snapNumericValue} from './parameter-policy';
import type {SourceAnchor} from './tool-system';
import type {ModelSpatialBinding} from './model-spatial-tool';

export type TransformAxis = 'x' | 'y' | 'z';

type TransformBindingBase = Readonly<{
  axis: TransformAxis;
  mode: 'translate' | 'rotate';
  anchor: 'bounds' | 'frame';
  label: string;
  value: number;
  sensitivity: number;
  parameterKind?: ParameterKind;
  step?: number;
  frame: Transform;
}>;

export type TransformGizmoBinding = TransformBindingBase &
  (
    | Readonly<{kind: 'parameter'; target: ParameterTarget}>
    | Readonly<{
        kind: 'expression';
        receiver: SourceAnchor;
        occurrenceKeys: readonly string[];
      }>
    | Readonly<{
        kind: 'spatial';
        spatial: ModelSpatialBinding;
        placement: Transform;
      }>
  );

export type TransformGizmoEvent =
  | Readonly<{kind: 'begin'; binding: TransformGizmoBinding}>
  | Readonly<{kind: 'cancel'; binding: TransformGizmoBinding}>
  | Readonly<{
      kind: 'preview' | 'commit';
      binding: TransformGizmoBinding;
      value: number;
    }>;

type AxisControl = {
  controls: TransformControls;
  proxy: THREE.Object3D;
  binding?: TransformGizmoBinding;
  angle: number;
};

type ActiveDrag = {
  control: AxisControl;
  binding: TransformGizmoBinding;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  value: number;
};

/** One control per axis also represents the non-orthogonal axes of Euler editing. */
export class TransformGizmo {
  private readonly axes: AxisControl[];
  private attachedObject?: THREE.Object3D;
  private active?: ActiveDrag;
  private cancelling = false;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    domElement: HTMLElement,
    private readonly setNavigationEnabled: (enabled: boolean) => void,
    private readonly onEvent: (event: TransformGizmoEvent) => void,
  ) {
    this.axes = (['x', 'y', 'z'] as const).map(axis => {
      const proxy = new THREE.Object3D();
      scene.add(proxy);
      const controls = new TransformControls(camera, domElement);
      controls.setSpace('local');
      controls.setSize(0.72);
      controls.setColors(
        spatialAxisColors.x,
        spatialAxisColors.y,
        spatialAxisColors.z,
        '#d8ff3e',
      );
      controls.showX = axis === 'x';
      controls.showY = axis === 'y';
      controls.showZ = axis === 'z';
      controls.showXY = false;
      controls.showYZ = false;
      controls.showXZ = false;
      controls.showXYZE = false;
      scene.add(controls.getHelper());
      const control: AxisControl = {controls, proxy, angle: 0};
      controls.addEventListener('rotationAngle-changed', event => {
        control.angle = Number(event.value);
      });
      controls.addEventListener('mouseDown', () => this.beginDrag(control));
      controls.addEventListener('objectChange', () => this.updateDrag(control));
      controls.addEventListener('mouseUp', () => this.finishDrag(control));
      return control;
    });
  }

  attach(
    object: THREE.Object3D,
    bindings: readonly TransformGizmoBinding[],
  ): void {
    this.detach();
    this.attachedObject = object;
    for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
      const control = this.axes[index];
      const binding = bindings.find(binding => binding.axis === axis);
      control.binding = binding;
      if (!binding) continue;
      control.controls.setMode(binding.mode);
      control.controls.setSize(binding.mode === 'rotate' ? 0.95 : 0.72);
      control.controls.attach(control.proxy);
    }
    this.updateAnchor();
  }

  detach(): void {
    if (this.active) this.cancel();
    for (const control of this.axes) {
      control.controls.detach();
      control.binding = undefined;
    }
    this.attachedObject = undefined;
  }

  updateAnchor(): void {
    const object = this.attachedObject;
    if (!object || this.active) return;
    object.updateWorldMatrix(true, false);
    for (const {binding, proxy} of this.axes) {
      if (!binding) continue;
      if (binding.anchor === 'bounds') {
        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.isEmpty()) object.getWorldPosition(proxy.position);
        else bounds.getCenter(proxy.position);
        object.parent?.getWorldQuaternion(proxy.quaternion);
      } else {
        const basis =
          binding.kind === 'spatial'
            ? new THREE.Matrix4().compose(
                new THREE.Vector3(...binding.placement.position),
                new THREE.Quaternion(...binding.placement.quaternion),
                new THREE.Vector3(...binding.placement.scale),
              )
            : object.matrix.clone();
        if (object.parent) basis.premultiply(object.parent.matrixWorld);
        proxy.position.set(...binding.frame.position).applyMatrix4(basis);
        basis.decompose(
          new THREE.Vector3(),
          proxy.quaternion,
          new THREE.Vector3(),
        );
      }
      proxy.quaternion.multiply(
        new THREE.Quaternion(...binding.frame.quaternion),
      );
      proxy.updateMatrixWorld(true);
    }
  }

  isPointerActive(): boolean {
    return (
      this.active !== undefined ||
      this.axes.some(({controls}) => controls.axis !== null)
    );
  }

  framing(): Readonly<{bounds: THREE.Box3; paddingPixels: number}> | undefined {
    const controls = this.axes.filter(
      control => control.binding?.anchor === 'frame',
    );
    if (controls.length === 0) return undefined;
    return {
      bounds: new THREE.Box3().setFromPoints(
        controls.map(control => control.proxy.position),
      ),
      paddingPixels: 120,
    };
  }

  commitParameterValue(targetId: string, value: number): void {
    for (const control of this.axes) {
      if (
        control.binding?.kind === 'parameter' &&
        control.binding.target.id === targetId
      ) {
        control.binding = {...control.binding, value};
      }
    }
  }

  cancel(): boolean {
    const active = this.active;
    if (!active) return false;
    this.cancelling = true;
    active.control.controls.reset();
    active.control.proxy.position.copy(active.position);
    active.control.proxy.quaternion.copy(active.quaternion);
    active.control.proxy.updateMatrixWorld(true);
    this.cancelling = false;
    this.active = undefined;
    this.enableNavigation();
    this.onEvent({kind: 'cancel', binding: active.binding});
    return true;
  }

  private beginDrag(control: AxisControl): void {
    if (this.active || !control.binding) return;
    this.active = {
      control,
      binding: control.binding,
      position: control.proxy.position.clone(),
      quaternion: control.proxy.quaternion.clone(),
      value: control.binding.value,
    };
    this.axes.forEach(other => {
      other.controls.enabled = other === control;
    });
    this.setNavigationEnabled(false);
    this.onEvent({kind: 'begin', binding: control.binding});
  }

  private updateDrag(control: AxisControl): void {
    const active = this.active;
    if (!active || active.control !== control || this.cancelling) return;
    const {binding, position, quaternion} = active;
    const direction = new THREE.Vector3(
      binding.axis === 'x' ? 1 : 0,
      binding.axis === 'y' ? 1 : 0,
      binding.axis === 'z' ? 1 : 0,
    );
    const delta =
      binding.mode === 'rotate'
        ? (control.angle * 180) / Math.PI
        : control.proxy.position
            .clone()
            .sub(position)
            .dot(direction.clone().applyQuaternion(quaternion));
    const value = snapNumericValue(
      {value: binding.value, kind: binding.parameterKind, step: binding.step},
      binding.value + delta / binding.sensitivity,
    );
    const displacement = (value - binding.value) * binding.sensitivity;
    if (binding.mode === 'rotate') {
      control.proxy.quaternion
        .copy(quaternion)
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            direction,
            (displacement * Math.PI) / 180,
          ),
        );
    } else {
      control.proxy.position
        .copy(position)
        .addScaledVector(direction.applyQuaternion(quaternion), displacement);
    }
    active.value = value;
    this.onEvent({kind: 'preview', binding, value});
  }

  private finishDrag(control: AxisControl): void {
    const active = this.active;
    if (!active || active.control !== control) return;
    this.active = undefined;
    this.enableNavigation();
    this.onEvent({
      kind: 'commit',
      binding: active.binding,
      value: active.value,
    });
  }

  private enableNavigation(): void {
    this.axes.forEach(({controls}) => {
      controls.enabled = true;
    });
    this.setNavigationEnabled(true);
  }
}
