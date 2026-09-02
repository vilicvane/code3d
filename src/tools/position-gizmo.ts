import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import type {ParameterKind, ParameterTarget} from '../model/runtime';
import {snapNumericValue} from './parameter-policy';
import type {SourceAnchor} from './tool-system';

export type PositionAxis = 'x' | 'y' | 'z';

type PositionGizmoBindingBase = Readonly<{
  axis: PositionAxis;
  label: string;
  value: number;
  sensitivity: number;
  parameterKind?: ParameterKind;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}>;

export type PositionGizmoBinding =
  | (PositionGizmoBindingBase &
      Readonly<{
        kind: 'parameter';
        target: ParameterTarget;
      }>)
  | (PositionGizmoBindingBase &
      Readonly<{
        kind: 'expression';
        receiver: SourceAnchor;
        occurrenceKeys: readonly string[];
      }>);

export type PositionGizmoEvent =
  | Readonly<{kind: 'begin'; binding: PositionGizmoBinding}>
  | Readonly<{
      kind: 'preview' | 'commit';
      binding: PositionGizmoBinding;
      value: number;
    }>
  | Readonly<{kind: 'cancel'; binding: PositionGizmoBinding}>;

type ActiveDrag = {
  binding: PositionGizmoBinding;
  startPosition: THREE.Vector3;
  value: number;
};

// @types/three 0.185.4 spells the runtime `minX` property as `minx`.
type BoundedTransformControls = TransformControls & {minX: number};

export class PositionGizmo {
  private readonly controls: BoundedTransformControls;
  private readonly proxy = new THREE.Object3D();
  private readonly bindings = new Map<PositionAxis, PositionGizmoBinding>();
  private attachedObject?: THREE.Object3D;
  private active?: ActiveDrag;
  private cancelling = false;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    domElement: HTMLElement,
    private readonly setNavigationEnabled: (enabled: boolean) => void,
    private readonly onEvent: (event: PositionGizmoEvent) => void,
  ) {
    scene.add(this.proxy);
    this.controls = new TransformControls(
      camera,
      domElement,
    ) as BoundedTransformControls;
    this.controls.setMode('translate');
    this.controls.setSpace('world');
    this.controls.setSize(0.72);
    this.controls.setColors('#ff665c', '#70d98d', '#6c8cff', '#d8ff3e');
    this.controls.showXY = false;
    this.controls.showYZ = false;
    this.controls.showXZ = false;
    const helper = this.controls.getHelper();
    removeUnsupportedHandles(helper);
    scene.add(helper);

    this.controls.addEventListener('mouseDown', () => this.beginDrag());
    this.controls.addEventListener('objectChange', () => this.updateDrag());
    this.controls.addEventListener('mouseUp', () => this.finishDrag());
  }

  attach(
    object: THREE.Object3D,
    bindings: readonly PositionGizmoBinding[],
  ): void {
    this.detach();
    if (bindings.length === 0) {
      return;
    }
    this.attachedObject = object;
    bindings.forEach(binding => this.bindings.set(binding.axis, binding));
    this.controls.showX = this.bindings.has('x');
    this.controls.showY = this.bindings.has('y');
    this.controls.showZ = this.bindings.has('z');
    this.updateAnchor();
    this.updateLimits();
    this.controls.attach(this.proxy);
  }

  detach(): void {
    if (this.active) {
      this.cancel();
    }
    this.controls.detach();
    this.bindings.clear();
    this.attachedObject = undefined;
  }

  updateAnchor(): void {
    if (!this.attachedObject || this.active) {
      return;
    }
    const bounds = new THREE.Box3().setFromObject(this.attachedObject);
    if (!bounds.isEmpty()) {
      bounds.getCenter(this.proxy.position);
      this.proxy.updateMatrixWorld(true);
    }
  }

  isPointerActive(): boolean {
    return this.controls.axis !== null || this.active !== undefined;
  }

  cancel(): boolean {
    const active = this.active;
    if (!active) {
      return false;
    }
    this.cancelling = true;
    this.controls.reset();
    this.proxy.position.copy(active.startPosition);
    this.proxy.updateMatrixWorld(true);
    this.cancelling = false;
    this.active = undefined;
    this.setNavigationEnabled(true);
    this.onEvent({kind: 'cancel', binding: active.binding});
    return true;
  }

  private beginDrag(): void {
    const axis = controlAxis(this.controls.axis);
    const binding = axis ? this.bindings.get(axis) : undefined;
    if (!binding) {
      return;
    }
    this.active = {
      binding,
      startPosition: this.proxy.position.clone(),
      value: binding.value,
    };
    this.setNavigationEnabled(false);
    this.onEvent({kind: 'begin', binding});
  }

  private updateDrag(): void {
    if (!this.active || this.cancelling) {
      return;
    }
    const {binding, startPosition} = this.active;
    const delta =
      this.proxy.position[binding.axis] - startPosition[binding.axis];
    const rawValue = binding.value + delta / binding.sensitivity;
    const value = snapNumericValue(
      {
        value: binding.value,
        kind: binding.parameterKind,
        min: binding.min,
        max: binding.max,
        step: binding.step,
      },
      rawValue,
    );
    this.proxy.position[binding.axis] =
      startPosition[binding.axis] +
      (value - binding.value) * binding.sensitivity;
    this.active.value = value;
    this.onEvent({kind: 'preview', binding, value});
  }

  private finishDrag(): void {
    const active = this.active;
    this.setNavigationEnabled(true);
    if (!active) {
      return;
    }
    this.active = undefined;
    this.onEvent({
      kind: 'commit',
      binding: active.binding,
      value: active.value,
    });
  }

  private updateLimits(): void {
    this.controls.minX = Number.NEGATIVE_INFINITY;
    this.controls.maxX = Number.POSITIVE_INFINITY;
    this.controls.minY = Number.NEGATIVE_INFINITY;
    this.controls.maxY = Number.POSITIVE_INFINITY;
    this.controls.minZ = Number.NEGATIVE_INFINITY;
    this.controls.maxZ = Number.POSITIVE_INFINITY;

    for (const binding of this.bindings.values()) {
      const {sensitivity, axis} = binding;
      const anchor = this.proxy.position[axis];
      const first =
        anchor +
        ((binding.min ?? Number.NEGATIVE_INFINITY) - binding.value) *
          sensitivity;
      const second =
        anchor +
        ((binding.max ?? Number.POSITIVE_INFINITY) - binding.value) *
          sensitivity;
      const min = Math.min(first, second);
      const max = Math.max(first, second);
      if (axis === 'x') {
        this.controls.minX = min;
        this.controls.maxX = max;
      } else if (axis === 'y') {
        this.controls.minY = min;
        this.controls.maxY = max;
      } else {
        this.controls.minZ = min;
        this.controls.maxZ = max;
      }
    }
  }
}

function controlAxis(
  axis: TransformControls['axis'],
): PositionAxis | undefined {
  if (axis === 'X') return 'x';
  if (axis === 'Y') return 'y';
  if (axis === 'Z') return 'z';
  return undefined;
}

function removeUnsupportedHandles(helper: THREE.Object3D): void {
  const unsupported = new Set(['XYZ', 'XY', 'YZ', 'XZ', 'E', 'XYZE']);
  const handles: THREE.Object3D[] = [];
  helper.traverse(object => {
    if (unsupported.has(object.name)) {
      handles.push(object);
    }
  });
  handles.forEach(handle => handle.removeFromParent());
}
