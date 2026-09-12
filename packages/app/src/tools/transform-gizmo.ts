import type {ToolDragPreview} from '../ui/tool-drag-preview';
import {
  action,
  autorun,
  computed,
  makeObservable,
  observableRef,
  reaction,
} from 'mobx';
import * as THREE from 'three';
import {
  TransformControls,
  TransformControlsGizmo,
} from 'three/addons/controls/TransformControls.js';
import type {
  ParameterKind,
  ParameterTarget,
  Transform,
  Vec3,
} from '@code3d/core/tooling';
import {spatialAxisColors} from '../spatial-axis-colors';
import {majorGridCells} from '../grid-scale';
import {snapNumericValue} from './parameter-policy';
import type {ModelSpatialBinding} from './model-spatial-tool';
import type {CallArgumentDefaults} from './source-expression';
import {worldUnitsPerPixel} from '../rendering/screen-space';

const handleLengthPixels = 100;
const coarseRotationStep = 15;

export type TransformAxis = 'x' | 'y' | 'z';
export type SpatialTool = 'translate' | 'rotate-point' | 'rotate-axis';

/** A drag owns a fixed grid interval; numeric input policies remain independent. */
export type TranslationGrid = {
  lock(): number;
  unlock(): void;
};

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
  completeArguments?: CallArgumentDefaults;
}>;

export type TransformGizmoBinding = TransformBindingBase &
  (
    | Readonly<{kind: 'parameter'; target: ParameterTarget}>
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
  delta: number;
  gridStep?: number;
};

/** One control per axis also represents the non-orthogonal axes of Euler editing. */
export class TransformGizmo {
  private readonly axes: AxisControl[];
  private readonly createAxis: (axis: TransformAxis) => AxisControl;
  private readonly pointerListeners = new AbortController();
  private readonly previousTouchAction: string;
  private attachedObject?: THREE.Object3D;
  private active?: ActiveDrag;
  private hovered?: AxisControl;
  private pointerId?: number;
  private cancelling = false;
  private altHeld = false;
  private shiftHeld = false;
  private selectedTool?: Readonly<{
    context: string | undefined;
    tool: SpatialTool;
  }>;
  private sourceTool?: SpatialTool;
  private bindings: readonly TransformGizmoBinding[] = [];
  private readonly disposeMode: () => void;
  private readonly disposeContext: () => void;

  get dragPreview(): ToolDragPreview | undefined {
    if (!this.active) return undefined;
    const {binding, value} = this.active;
    return {
      label:
        binding.mode === 'rotate'
          ? 'Rotate'
          : binding.kind === 'spatial'
            ? ['pivot', 'pivotOffset'].includes(binding.spatial.operation)
              ? 'Pivot'
              : binding.spatial.operation === 'axisOffset'
                ? 'Axis'
                : binding.spatial.operation === 'offset'
                  ? 'Move'
                  : 'Origin'
            : 'Offset',
      values: [
        {
          label: binding.label,
          value,
          start: binding.value,
          unit:
            binding.parameterKind === 'angle'
              ? '°'
              : binding.parameterKind === 'length'
                ? 'unit'
                : '',
        },
      ],
    };
  }

  get currentBindings(): readonly TransformGizmoBinding[] {
    return this.bindings;
  }

  get availableTools(): readonly SpatialTool[] {
    const tools = new Set(this.bindings.map(bindingTool));
    if (this.sourceTool) tools.add(this.sourceTool);
    if (
      this.bindings.some(
        binding =>
          binding.kind === 'spatial' &&
          binding.mode === 'rotate' &&
          binding.spatial.objects.some(object => object.spatial.reference),
      )
    ) {
      tools.add('rotate-point');
      tools.add('rotate-axis');
    }
    return [...tools];
  }

  get tool(): SpatialTool | undefined {
    return this.selectedTool?.context === this.context() &&
      this.selectedTool &&
      this.availableTools.includes(this.selectedTool.tool)
      ? this.selectedTool.tool
      : this.sourceTool;
  }

  /** The authored operation represented by the active tool, excluding Alt handles. */
  get toolBinding(): TransformGizmoBinding | undefined {
    return this.bindings.find(
      binding =>
        bindingTool(binding) === this.tool && !referenceBinding(binding),
    );
  }

  selectTool(tool: SpatialTool): void {
    this.cancel();
    this.selectedTool = {context: this.context(), tool};
  }

  get rotationBinding():
    Extract<TransformGizmoBinding, {kind: 'spatial'}> | undefined {
    const rotations = this.bindings.filter(
      (binding): binding is Extract<TransformGizmoBinding, {kind: 'spatial'}> =>
        binding.kind === 'spatial' && binding.mode === 'rotate',
    );
    // A missing variant uses the existing rotation only as its insertion anchor.
    return (
      rotations.find(binding => bindingTool(binding) === this.tool) ??
      rotations[0]
    );
  }

  get reference() {
    const binding = this.rotationBinding;
    return binding?.spatial.objects.find(
      object => object.nodeId === binding.spatial.ownerNodeId,
    )?.spatial.reference;
  }

  get referencePicking(): Exclude<SpatialTool, 'translate'> | undefined {
    const tool = this.tool;
    return !this.active &&
      tool &&
      tool !== 'translate' &&
      (this.reference || this.sourceTool)
      ? tool
      : undefined;
  }

  private get displayedBindings(): readonly TransformGizmoBinding[] {
    if (!this.isAvailable()) return [];
    const available = this.bindings.filter(binding => this.canEdit(binding));
    if (this.active) {
      const active = this.active.binding;
      return available.filter(
        binding =>
          bindingTool(binding) === bindingTool(active) &&
          referenceBinding(binding) === referenceBinding(active),
      );
    }
    let tool = this.tool;
    let reference = false;
    if (this.altHeld && tool !== 'translate') {
      reference = this.bindings.some(
        binding => bindingTool(binding) === tool && referenceBinding(binding),
      );
    }
    const matching = available.filter(binding => bindingTool(binding) === tool);
    if (
      matching.every(referenceBinding) &&
      !matching.some(
        binding =>
          binding.kind === 'spatial' &&
          binding.spatial.source.kind === 'reference-offset',
      )
    )
      reference = true;
    return matching.filter(binding => referenceBinding(binding) === reference);
  }

  private get displayedMode(): TransformGizmoBinding['mode'] | undefined {
    return this.displayedBindings[0]?.mode;
  }

  constructor(
    scene: THREE.Scene,
    private camera: THREE.Camera,
    private readonly domElement: HTMLElement,
    private readonly setNavigationEnabled: (enabled: boolean) => void,
    private readonly translationGrid: TranslationGrid,
    private readonly onEvent: (event: TransformGizmoEvent) => void,
    private readonly isAvailable: () => boolean = () => true,
    private readonly canEdit: (
      binding: TransformGizmoBinding,
    ) => boolean = () => true,
    private readonly context: () => string | undefined = () => undefined,
  ) {
    makeObservable<
      this,
      | 'selectedTool'
      | 'sourceTool'
      | 'displayedBindings'
      | 'altHeld'
      | 'shiftHeld'
      | 'bindings'
      | 'active'
      | 'displayedMode'
      | 'setAltHeld'
      | 'setShiftHeld'
      | 'beginDrag'
      | 'finishDrag'
      | 'applyDrag'
    >(this, {
      selectedTool: observableRef,
      sourceTool: observableRef,
      availableTools: computed,
      tool: computed,
      toolBinding: computed,
      reference: computed,
      referencePicking: computed,
      rotationBinding: computed,
      selectTool: action,
      displayedBindings: computed,
      altHeld: observableRef,
      shiftHeld: observableRef,
      bindings: observableRef,
      active: observableRef,
      displayedMode: computed,
      setAltHeld: action,
      setShiftHeld: action,
      beginDrag: action,
      finishDrag: action,
      applyDrag: action,
      dragPreview: computed,
      attach: action,
      detach: action,
      cancel: action,
    });
    this.previousTouchAction = domElement.style.touchAction;
    this.disposeContext = reaction(
      context,
      action(context => {
        if (this.selectedTool?.context !== context)
          this.selectedTool = undefined;
      }),
    );
    this.createAxis = axis => {
      const proxy = new THREE.Object3D();
      scene.add(proxy);
      const controls = new TransformControls(this.camera, domElement);
      // Axis helpers share one pointer owner instead of competing DOM listeners.
      controls.disconnect();
      controls.setSpace('local');
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
    };
    this.axes = [];
    this.disposeMode = autorun(() => {
      const bindings = this.displayedBindings;
      this.bindings;
      for (const control of this.axes) {
        const visible = !!control.binding && bindings.includes(control.binding);
        control.controls.getHelper().visible = visible;
        control.controls.enabled = visible;
        if (!visible && this.hovered === control) this.setHovered(undefined);
      }
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
    domElement.ownerDocument.addEventListener(
      'keydown',
      this.onModifierKey,
      options,
    );
    domElement.ownerDocument.addEventListener(
      'keyup',
      this.onModifierKey,
      options,
    );
    domElement.ownerDocument.defaultView?.addEventListener(
      'blur',
      this.onBlur,
      options,
    );
  }

  attach(
    object: THREE.Object3D,
    bindings: readonly TransformGizmoBinding[],
    sourceTool?: SpatialTool,
  ): void {
    this.detach();
    this.attachedObject = object;
    this.sourceTool = sourceTool;
    while (this.axes.length > bindings.length) {
      const control = this.axes.pop()!;
      control.controls.getHelper().removeFromParent();
      control.proxy.removeFromParent();
      control.controls.dispose();
    }
    for (const [index, binding] of bindings.entries()) {
      const control = this.axes[index] ?? this.createAxis(binding.axis);
      this.axes[index] = control;
      control.controls.showX = binding.axis === 'x';
      control.controls.showY = binding.axis === 'y';
      control.controls.showZ = binding.axis === 'z';
      control.binding = binding;
      if (!binding) continue;
      const axisRotation =
        binding.mode === 'rotate' && bindingTool(binding) === 'rotate-axis';
      control.controls.setColors(
        axisRotation ? '#ffad4d' : spatialAxisColors.x,
        axisRotation ? '#ffad4d' : spatialAxisColors.y,
        axisRotation ? '#ffad4d' : spatialAxisColors.z,
        '#d8ff3e',
      );
      control.controls.setMode(binding.mode);
      control.controls.setSize(binding.mode === 'rotate' ? 0.95 : 0.72);
      control.controls.attach(control.proxy);
    }
    this.bindings = bindings;
    this.updateAnchor();
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    for (const {controls} of this.axes) controls.camera = camera;
  }

  detach(): void {
    if (this.active) this.cancel();
    this.setHovered(undefined);
    for (const control of this.axes) {
      control.controls.detach();
      control.binding = undefined;
    }
    this.attachedObject = undefined;
    this.bindings = [];
    this.sourceTool = undefined;
  }

  dispose(): void {
    this.detach();
    this.disposeMode();
    this.disposeContext();
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
    this.updateScreenSize();
  }

  updateScreenSize(viewportHeight = this.domElement.clientHeight): void {
    if (viewportHeight === 0) return;
    this.camera.updateWorldMatrix(true, false);
    for (const {controls, proxy, binding} of this.axes) {
      if (!binding) continue;
      // Convert the library's camera-relative size into CSS pixels. These are
      // the Perspective/Orthographic factors used by TransformControlsGizmo.
      const projectionScale = this.camera.projectionMatrix.elements[5];
      const factor =
        this.camera instanceof THREE.PerspectiveCamera
          ? proxy.position.distanceTo(this.camera.position) *
            Math.min(1.9 / projectionScale, 7)
          : 2 / projectionScale;
      const size =
        worldUnitsPerPixel(this.camera, proxy.position, viewportHeight) *
        handleLengthPixels;
      controls.setSize((4 * size) / factor);
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
    this.endTranslation(active);
    this.setHovered(undefined);
    this.releasePointer();
    this.setNavigationEnabled(true);
    this.onEvent({kind: 'cancel', binding: active.binding});
    return true;
  }

  private beginDrag(control: AxisControl): void {
    if (this.active || !control.binding || !this.isAvailable()) return;
    this.active = {
      control,
      binding: control.binding,
      position: control.proxy.position.clone(),
      quaternion: control.proxy.quaternion.clone(),
      value: control.binding.value,
      delta: 0,
      gridStep:
        control.binding.mode === 'translate'
          ? this.translationGrid.lock()
          : undefined,
    };
    makeObservable(this.active, {value: observableRef});
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
    active.delta =
      binding.mode === 'rotate'
        ? (control.angle * 180) / Math.PI
        : control.proxy.position
            .clone()
            .sub(position)
            .dot(direction.clone().applyQuaternion(quaternion));
    this.applyDrag();
  }

  private applyDrag(): void {
    const active = this.active!;
    const {binding, position, quaternion, control} = active;
    const direction = new THREE.Vector3(
      binding.axis === 'x' ? 1 : 0,
      binding.axis === 'y' ? 1 : 0,
      binding.axis === 'z' ? 1 : 0,
    );
    // Quantize physical distance/angle before reversing the parameter mapping.
    // Keep the gesture's starting value, so off-grid inputs do not jump on grab.
    const step =
      active.gridStep !== undefined
        ? active.gridStep * (this.shiftHeld ? majorGridCells : 1)
        : this.shiftHeld
          ? coarseRotationStep
          : undefined;
    const delta =
      step === undefined
        ? active.delta
        : Math.round(active.delta / step) * step;
    const candidate = binding.value + delta / binding.sensitivity;
    const value =
      step === undefined
        ? snapNumericValue(
            {
              value: binding.value,
              kind: binding.parameterKind,
              step: binding.step,
            },
            candidate,
          )
        : Number(candidate.toPrecision(12));
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
    this.endTranslation(active);
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

  private endTranslation(active: ActiveDrag): void {
    if (active.gridStep !== undefined) this.translationGrid.unlock();
  }

  private setAltHeld(value: boolean): void {
    this.altHeld = value;
  }

  private setShiftHeld(value: boolean): boolean {
    if (this.shiftHeld === value) return false;
    this.shiftHeld = value;
    return true;
  }

  private onBlur = (): void => {
    this.cancel();
    this.setAltHeld(false);
    this.setShiftHeld(false);
  };

  private onModifierKey = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') {
      if (this.setShiftHeld(event.shiftKey) && this.active) this.applyDrag();
      return;
    }
    if (event.key !== 'Alt') return;
    this.setAltHeld(event.type === 'keydown');
    if (
      this.tool &&
      this.tool !== 'translate' &&
      (this.reference || this.sourceTool)
    )
      event.preventDefault();
  };

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
    if (this.axes.length === 0) return undefined;
    const raycaster = this.prepareRay(event);
    let nearest: {control: AxisControl; distance: number} | undefined;
    for (const control of this.axes) {
      if (!control.binding || !this.displayedBindings.includes(control.binding))
        continue;
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
    this.setAltHeld(event.altKey);
    this.setShiftHeld(event.shiftKey);
    const control = this.pickAxis(event);
    this.setHovered(control);
    if (!control) return;
    this.pointerId = event.pointerId;
    this.domElement.setPointerCapture(event.pointerId);
    control.controls.getHelper().updateMatrixWorld(true);
    control.controls.pointerDown(null);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.active && event.pointerId !== this.pointerId) return;
    this.setAltHeld(event.altKey);
    this.setShiftHeld(event.shiftKey);
    if (this.active) {
      this.prepareRay(event);
      this.active.control.controls.pointerMove(null);
    } else if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      this.setHovered(this.pickAxis(event));
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || event.button !== 0) return;
    this.setAltHeld(event.altKey);
    if (this.setShiftHeld(event.shiftKey) && this.active) this.applyDrag();
    this.active?.control.controls.pointerUp(null);
  };

  private onPointerLeave = (): void => {
    if (!this.active) this.setHovered(undefined);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.cancel();
  };
}

function referenceBinding(binding: TransformGizmoBinding): boolean {
  return (
    binding.kind === 'spatial' &&
    ['pivot', 'pivotOffset', 'axisOffset'].includes(binding.spatial.operation)
  );
}

export function bindingTool(binding: TransformGizmoBinding): SpatialTool {
  if (binding.kind === 'spatial') {
    if (
      binding.spatial.operation === 'axisOffset' ||
      (binding.mode === 'rotate' &&
        binding.spatial.objects[0]?.spatial.axisOnly)
    )
      return 'rotate-axis';
    if (referenceBinding(binding)) return 'rotate-point';
  }
  return binding.mode === 'rotate' ? 'rotate-point' : 'translate';
}
