import {Matrix4, Quaternion, Vector3, type Group} from 'three';
import {
  cameraAspect,
  cameraProjection,
  cameraViewHeight,
  createViewCamera,
  perspectiveDistance,
  resizeViewCamera,
  updateProjectionCamera,
  setCameraViewHeight,
  type CameraFraming,
  type CameraProjection,
  type ViewCamera,
} from '../rendering/view-camera';
import {
  ArcballControls,
  type ArcballControlsMouseActionOperation,
} from 'three/addons/controls/ArcballControls.js';

// Arcball exposes these gesture hooks in its implementation, but not its typings.
declare module 'three/addons/controls/ArcballControls.js' {
  interface ArcballControls {
    onSinglePanStart(
      event: PointerEvent,
      operation: ArcballControlsMouseActionOperation,
    ): void;
    onSinglePanMove(event: PointerEvent, state: symbol): void;
    onRotateStart(): void;
    onRotateMove(): void;
    getAngle(a: PointerEvent, b: PointerEvent): number;
  }
}

export type CameraPose = CameraFraming &
  Readonly<{
    orientation: Quaternion;
    projection: CameraProjection;
    /** Displayed perspective strength; 0 is orthographic, 1 is the navigation lens. */
    projectionMix: number;
  }>;
const transitionDurations = {view: 300, projection: 100} as const;

/** Arcball navigation with the current focus exposed to framing and previews. */
export class ViewportNavigation extends ArcballControls {
  declare object: ViewCamera;
  // The documented target is missing from Three's current type declarations.
  declare target: Vector3;

  // Arcball's public target is a requested target, not its live focus after
  // pan/cursor zoom. Keep that dependency inside this integration boundary.
  declare protected _gizmos: Group;
  declare protected _animationId: number;
  declare protected _timeStart: number;
  declare protected mouseActions: {
    operation: ArcballControlsMouseActionOperation;
    state: symbol;
  }[];
  declare protected _touchCurrent: PointerEvent[];
  declare protected _touchStart: PointerEvent[];
  declare protected _startFingerRotation: number;
  private rotationStart?: PointerEvent;
  private touchRotationFrame?: number;
  private viewCamera: ViewCamera;
  private projectionMix = 1;
  private readonly defaultDirection: Vector3;
  private readonly defaultUp: Vector3;
  private transition?: Readonly<{
    startedAt: number;
    kind: 'view' | 'projection';
    from: CameraPose;
    to: CameraPose;
  }>;

  constructor(
    camera: ViewCamera,
    element: HTMLElement,
    private readonly onCameraChange: (camera: ViewCamera) => void,
  ) {
    super(camera, element);
    this.viewCamera = camera;
    this.addEventListener('change', () => this.refreshViewCamera());
    this.cursorZoom = true;
    this.enableFocus = false;
    this.dampingFactor = 40;
    this.wMax = 8;
    this.unsetMouseAction('WHEEL', 'SHIFT');
    this.unsetMouseAction(1, 'SHIFT');
    this.focus.set(0, 20, 0);
    this.defaultDirection = camera.position.clone().sub(this.focus).normalize();
    this.defaultUp = camera.up.clone();
    this.syncCamera();
    this.addEventListener('start', () => {
      if (this.transition?.kind === 'view') this.syncCamera();
    });
  }

  get focus(): Vector3 {
    return this._gizmos.position;
  }

  capturePose(): CameraPose {
    const distance = this.object.position.distanceTo(this.focus);
    return {
      focus: this.focus.clone(),
      distance,
      viewHeight: cameraViewHeight(this.object, distance),
      projection: cameraProjection(this.object),
      projectionMix: this.projectionMix,
      orientation: this.object.quaternion.clone(),
    };
  }

  /** Remember the requested view if a scene switch interrupts its transition. */
  savedPose(): CameraPose {
    if (this.transition?.kind === 'projection')
      return {...this.capturePose(), projectionMix: 1};
    return this.transition?.to ?? this.capturePose();
  }

  defaultPose(framing: CameraFraming): CameraPose {
    return {
      ...framing,
      projection: 'perspective',
      projectionMix: 1,
      viewHeight: framing.distance / perspectiveDistance(1),
      orientation: viewOrientation(this.defaultDirection, this.defaultUp),
    };
  }

  restorePose(pose: CameraPose, animate = false): void {
    if (animate) this.transitionTo(pose);
    else {
      this.applyPose(pose);
      this.syncCamera();
    }
  }

  setViewDirection(direction: Vector3, up: Vector3): void {
    this.transitionTo({
      ...this.capturePose(),
      projection: 'orthographic',
      projectionMix: 0,
      orientation: viewOrientation(direction, up),
    });
  }

  resetView(frame: Quaternion, framing?: CameraFraming): void {
    const pose = this.capturePose();
    const viewHeight = framing
      ? framing.distance / perspectiveDistance(1)
      : pose.viewHeight;
    this.transitionTo({
      focus: framing?.focus ?? this.focus.clone(),
      viewHeight,
      distance: perspectiveDistance(viewHeight),
      projection: 'perspective',
      projectionMix: 1,
      orientation: viewOrientation(
        this.defaultDirection.clone().applyQuaternion(frame),
        this.defaultUp.clone().applyQuaternion(frame),
      ),
    });
  }

  frame(framing: CameraFraming, allowZoomIn: boolean): void {
    const pose = this.capturePose();
    const viewHeight = allowZoomIn
      ? framing.viewHeight
      : Math.max(framing.viewHeight, pose.viewHeight);
    this.applyPose({
      ...framing,
      projection: pose.projection,
      projectionMix: pose.projectionMix,
      viewHeight,
      distance:
        pose.projection === 'perspective'
          ? (framing.distance * viewHeight) / framing.viewHeight
          : Math.max(framing.distance, pose.distance),
      orientation: this.object.quaternion,
    });
    this.syncCamera();
  }

  updateTransition(time: number): void {
    const transition = this.transition;
    if (!transition) return;
    const t = Math.min(
      (time - transition.startedAt) / transitionDurations[transition.kind],
      1,
    );
    const eased = t * t * (3 - 2 * t);
    const {from, to} = transition;
    const projectionMix =
      from.projectionMix + (to.projectionMix - from.projectionMix) * eased;
    if (transition.kind === 'projection') {
      // Orbit/pan/zoom continue updating Arcball while only the displayed lens changes.
      this.projectionMix = projectionMix;
      if (t === 1) this.transition = undefined;
      this.refreshViewCamera();
      this.dispatchEvent({type: 'change'});
      return;
    }
    if (t === 1) {
      this.applyPose(to);
      this.syncCamera();
      return;
    }
    this.applyPose({
      projection: to.projection,
      projectionMix,
      focus: from.focus.clone().lerp(to.focus, eased),
      distance: from.distance * Math.pow(to.distance / from.distance, eased),
      viewHeight:
        from.viewHeight * Math.pow(to.viewHeight / from.viewHeight, eased),
      orientation: from.orientation.clone().slerp(to.orientation, eased),
    });
    this.dispatchEvent({type: 'change'});
  }

  private transitionTo(to: CameraPose): void {
    this.syncCamera();
    const from = this.capturePose();
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      (from.projection === to.projection &&
        from.focus.distanceToSquared(to.focus) < 1e-16 &&
        Math.abs(Math.log(from.distance / to.distance)) < 1e-10 &&
        Math.abs(Math.log(from.viewHeight / to.viewHeight)) < 1e-10 &&
        Math.abs(from.projectionMix - to.projectionMix) < 1e-10 &&
        from.orientation.angleTo(to.orientation) < 1e-7)
    ) {
      this.applyPose(to);
      this.syncCamera();
      return;
    }
    this.transition = {
      kind: 'view',
      startedAt: performance.now(),
      from,
      to,
    };
  }

  private applyPose(pose: CameraPose): void {
    const replacement = cameraProjection(this.object) !== pose.projection;
    const camera = replacement
      ? createViewCamera(pose.projection, cameraAspect(this.object))
      : this.object;
    this.focus.copy(pose.focus);
    camera.quaternion.copy(pose.orientation);
    camera.position
      .set(0, 0, pose.distance)
      .applyQuaternion(pose.orientation)
      .add(this.focus);
    camera.up.set(0, 1, 0).applyQuaternion(pose.orientation);
    setCameraViewHeight(camera, pose.viewHeight, pose.distance);
    camera.updateMatrixWorld();
    if (replacement) {
      camera.near = this.object.near;
      camera.far = this.object.far;
      this.target.copy(pose.focus);
      this.setCamera(camera);
    }
    this.projectionMix = pose.projectionMix;
    this.refreshViewCamera();
  }

  private refreshViewCamera(): void {
    const projection =
      this.projectionMix === 0 ? 'orthographic' : 'perspective';
    const native =
      (cameraProjection(this.object) === 'perspective' ? 1 : 0) ===
      this.projectionMix;
    const camera = native
      ? this.object
      : this.viewCamera !== this.object &&
          cameraProjection(this.viewCamera) === projection
        ? this.viewCamera
        : createViewCamera(projection, cameraAspect(this.object));
    if (!native)
      updateProjectionCamera(
        camera,
        this.object,
        this.focus,
        this.projectionMix,
      );
    if (camera !== this.viewCamera) {
      this.viewCamera = camera;
      this.onCameraChange(camera);
    }
  }

  override onSinglePanStart(
    event: PointerEvent,
    operation: ArcballControlsMouseActionOperation,
  ): void {
    this.rotationStart = operation === 'ROTATE' ? event : undefined;
    super.onSinglePanStart(event, operation);
  }

  override onSinglePanMove(event: PointerEvent, state: symbol): void {
    const rotate = this.mouseActions.some(
      action => action.operation === 'ROTATE' && action.state === state,
    );
    if (
      this.enabled &&
      this.enableRotate &&
      rotate &&
      this.projectionMix !== 1 &&
      this.transition?.kind !== 'projection'
    ) {
      const start = this.rotationStart;
      if (!start) {
        this.rotationStart = event;
        super.onSinglePanStart(event, 'ROTATE');
        return;
      }
      if (
        Math.hypot(
          event.clientX - start.clientX,
          event.clientY - start.clientY,
        ) < 4
      )
        return;
      this.resumePerspective();
      super.onSinglePanStart(start, 'ROTATE');
    } else if (!rotate) this.rotationStart = undefined;
    super.onSinglePanMove(event, state);
  }

  override onRotateMove(): void {
    if (this.projectionMix === 1 || this.transition?.kind === 'projection') {
      super.onRotateMove();
      return;
    }
    // Browsers deliver each finger separately. Measure the complete input frame
    // so a two-finger pan cannot briefly look like a twist after the first event.
    this.touchRotationFrame ??= window.requestAnimationFrame(() => {
      this.touchRotationFrame = undefined;
      if (
        !this.enabled ||
        !this.enableRotate ||
        this._touchCurrent.length !== 2 ||
        this.projectionMix === 1 ||
        this.transition?.kind === 'projection'
      )
        return;
      const rotation =
        this.getAngle(this._touchCurrent[1], this._touchCurrent[0]) +
        this.getAngle(this._touchStart[1], this._touchStart[0]);
      const delta = ((rotation - this._startFingerRotation + 540) % 360) - 180;
      if (Math.abs(delta) < 0.5) return;
      this.resumePerspective();
      super.onRotateStart();
    });
  }

  override dispose(): void {
    if (this.touchRotationFrame !== undefined)
      window.cancelAnimationFrame(this.touchRotationFrame);
    super.dispose();
  }

  private resumePerspective(): void {
    const pose = this.capturePose();
    const distance = perspectiveDistance(pose.viewHeight);
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    this.applyPose({
      ...pose,
      projection: 'perspective',
      projectionMix: reduced
        ? 1
        : (pose.projectionMix * distance) / pose.distance,
      distance,
    });
    this.syncCamera();
    if (!reduced) {
      const from = this.capturePose();
      this.transition = {
        kind: 'projection',
        startedAt: performance.now(),
        from,
        to: {...from, projectionMix: 1},
      };
    }
  }

  /** Accept a frame/preview camera edit and stop any previous rotation inertia. */
  syncCamera(): void {
    this.target.copy(this.focus);
    this.update();
    this.saveState();
    this.reset();
  }

  setNavigationEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.saveState();
      this.reset();
    }
  }

  override reset(): void {
    this.transition = undefined;
    // Arcball's queued first inertia frame can restart animation after reset.
    // Cancel it as well as subsequent frames when a frame/preview/tool takes over.
    window.cancelAnimationFrame(this._animationId);
    this._animationId = -1;
    this._timeStart = -1;
    super.reset();
  }

  resize(): void {
    resizeViewCamera(
      this.object,
      this.domElement!.clientWidth / this.domElement!.clientHeight,
    );
    this.refreshViewCamera();
    this.setTbRadius(this.radiusFactor);
  }
}

function viewOrientation(direction: Vector3, up: Vector3): Quaternion {
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(direction, new Vector3(), up),
  );
}
