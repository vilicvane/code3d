import * as THREE from 'three';
import {
  TransformControls,
  TransformControlsGizmo,
} from 'three/addons/controls/TransformControls.js';
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
  gizmo: TransformControlsGizmo;
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
  private readonly pointerListeners = new AbortController();
  private readonly previousTouchAction: string;
  private attachedObject?: THREE.Object3D;
  private active?: ActiveDrag;
  private hovered?: AxisControl;
  private pointerId?: number;
  private cancelling = false;

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly domElement: HTMLElement,
    private readonly setNavigationEnabled: (enabled: boolean) => void,
    private readonly onEvent: (event: TransformGizmoEvent) => void,
  ) {
    this.previousTouchAction = domElement.style.touchAction;
    this.axes = (['x', 'y', 'z'] as const).map(axis => {
      const proxy = new THREE.Object3D();
      scene.add(proxy);
      const controls = new TransformControls(camera, domElement);
      // Axis helpers share one pointer owner instead of competing DOM listeners.
      controls.disconnect();
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
      const helper = controls.getHelper();
      scene.add(helper);
      const gizmo = helper.children.find(
        (child): child is TransformControlsGizmo =>
          child instanceof TransformControlsGizmo,
      )!;
      const control: AxisControl = {controls, gizmo, proxy, angle: 0};
      controls.addEventListener('rotationAngle-changed', event => {
        control.angle = Number(event.value);
      });
      controls.addEventListener('mouseDown', () => this.beginDrag(control));
      controls.addEventListener('objectChange', () => this.updateDrag(control));
      controls.addEventListener('mouseUp', () => this.finishDrag(control));
      return control;
    });
    domElement.style.touchAction = 'none';
    const options = {signal: this.pointerListeners.signal};
    domElement.addEventListener('pointerdown', this.onPointerDown, options);
    domElement.addEventListener('pointermove', this.onPointerMove, options);
    domElement.addEventListener('pointerup', this.onPointerUp, options);
    domElement.addEventListener('pointerleave', this.onPointerLeave, options);
    domElement.addEventListener('pointercancel', this.onPointerCancel, options);
    domElement.addEventListener(
      'lostpointercapture',
      this.onPointerCancel,
      options,
    );
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
    this.setHovered(undefined);
    for (const control of this.axes) {
      control.controls.detach();
      control.binding = undefined;
    }
    this.attachedObject = undefined;
  }

  dispose(): void {
    this.detach();
    this.pointerListeners.abort();
    for (const {controls, proxy} of this.axes) {
      controls.getHelper().removeFromParent();
      proxy.removeFromParent();
      controls.dispose();
    }
    this.domElement.style.touchAction = this.previousTouchAction;
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
    return this.active !== undefined || this.hovered !== undefined;
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
    active.control.proxy.quaternion.copy(active.quaternion);
    this.moveOrigin(active.position);
    this.cancelling = false;
    active.control.controls.dragging = false;
    this.active = undefined;
    this.setHovered(undefined);
    this.releasePointer();
    this.setNavigationEnabled(true);
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
    this.setHovered(control);
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
      this.moveOrigin(control.proxy.position);
    }
    active.value = value;
    this.onEvent({kind: 'preview', binding, value});
  }

  private moveOrigin(position: THREE.Vector3): void {
    for (const {binding, proxy} of this.axes) {
      if (!binding) continue;
      proxy.position.copy(position);
      proxy.updateMatrixWorld(true);
    }
  }

  private finishDrag(control: AxisControl): void {
    const active = this.active;
    if (!active || active.control !== control) return;
    this.active = undefined;
    this.setHovered(undefined);
    this.releasePointer();
    this.setNavigationEnabled(true);
    this.onEvent({
      kind: 'commit',
      binding: active.binding,
      value: active.value,
    });
  }

  private setHovered(control: AxisControl | undefined): void {
    this.hovered = control;
    for (const candidate of this.axes) {
      candidate.controls.axis =
        candidate === control
          ? (candidate.binding!.axis.toUpperCase() as 'X' | 'Y' | 'Z')
          : null;
    }
  }

  private prepareRay(event: PointerEvent): THREE.Raycaster {
    const rect = this.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    const raycaster = this.axes[0].controls.getRaycaster();
    raycaster.setFromCamera(pointer, this.camera);
    return raycaster;
  }

  private pickAxis(event: PointerEvent): AxisControl | undefined {
    const raycaster = this.prepareRay(event);
    let nearest: {control: AxisControl; distance: number} | undefined;
    for (const control of this.axes) {
      if (!control.binding) continue;
      control.controls.getHelper().updateMatrixWorld(true);
      const hit = raycaster
        .intersectObject(control.gizmo.picker[control.controls.mode], true)
        .find(
          hit =>
            hit.object.visible &&
            hit.object.name === control.binding!.axis.toUpperCase(),
        );
      if (hit && (!nearest || hit.distance < nearest.distance)) {
        nearest = {control, distance: hit.distance};
      }
    }
    return nearest?.control;
  }

  private releasePointer(): void {
    const pointerId = this.pointerId;
    this.pointerId = undefined;
    if (
      pointerId !== undefined &&
      this.domElement.hasPointerCapture(pointerId)
    ) {
      this.domElement.releasePointerCapture(pointerId);
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.active || event.button !== 0) return;
    const control = this.pickAxis(event);
    this.setHovered(control);
    if (!control) return;
    this.pointerId = event.pointerId;
    this.domElement.setPointerCapture(event.pointerId);
    control.controls.getHelper().updateMatrixWorld(true);
    control.controls.pointerDown(null);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.active) {
      if (event.pointerId !== this.pointerId) return;
      this.prepareRay(event);
      this.active.control.controls.pointerMove(null);
    } else if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      this.setHovered(this.pickAxis(event));
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || event.button !== 0) return;
    this.active?.control.controls.pointerUp(null);
  };

  private onPointerLeave = (): void => {
    if (!this.active) this.setHovered(undefined);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.cancel();
  };
}
