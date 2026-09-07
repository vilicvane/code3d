import {
  Matrix4,
  Quaternion,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from 'three';
import type {CameraFraming} from '../rendering/model-renderer';
import {ArcballControls} from 'three/addons/controls/ArcballControls.js';

type CameraPose = CameraFraming & Readonly<{orientation: Quaternion}>;
const viewTransitionDuration = 300;

/** Arcball navigation with the current focus exposed to framing and previews. */
export class ViewportNavigation extends ArcballControls {
  // The documented target is missing from Three's current type declarations.
  declare target: Vector3;

  // Arcball's public target is a requested target, not its live focus after
  // pan/cursor zoom. Keep that dependency inside this integration boundary.
  declare protected _gizmos: Group;
  declare protected _animationId: number;
  declare protected _timeStart: number;
  private readonly defaultDirection: Vector3;
  private readonly defaultUp: Vector3;
  private transition?: Readonly<{
    startedAt: number;
    from: CameraPose;
    to: CameraPose;
  }>;

  constructor(camera: PerspectiveCamera, element: HTMLElement) {
    super(camera, element);
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
      if (this.transition) this.syncCamera();
    });
  }

  get focus(): Vector3 {
    return this._gizmos.position;
  }

  setViewDirection(direction: Vector3, up: Vector3): void {
    this.transitionTo({
      focus: this.focus.clone(),
      distance: this.object.position.distanceTo(this.focus),
      orientation: viewOrientation(direction, up),
    });
  }

  resetView(frame: Quaternion, framing?: CameraFraming): void {
    this.transitionTo({
      focus: framing?.focus ?? this.focus.clone(),
      distance:
        framing?.distance ?? this.object.position.distanceTo(this.focus),
      orientation: viewOrientation(
        this.defaultDirection.clone().applyQuaternion(frame),
        this.defaultUp.clone().applyQuaternion(frame),
      ),
    });
  }

  frame(framing: CameraFraming, allowZoomIn: boolean): void {
    this.applyPose({
      ...framing,
      distance: allowZoomIn
        ? framing.distance
        : Math.max(
            framing.distance,
            this.object.position.distanceTo(this.focus),
          ),
      orientation: this.object.quaternion,
    });
    this.syncCamera();
  }

  updateTransition(time: number): void {
    const transition = this.transition;
    if (!transition) return;
    const t = Math.min(
      (time - transition.startedAt) / viewTransitionDuration,
      1,
    );
    const eased = t * t * (3 - 2 * t);
    const {from, to} = transition;
    if (t === 1) {
      this.applyPose(to);
      this.syncCamera();
      return;
    }
    this.applyPose({
      focus: from.focus.clone().lerp(to.focus, eased),
      distance: from.distance * Math.pow(to.distance / from.distance, eased),
      orientation: from.orientation.clone().slerp(to.orientation, eased),
    });
    this.dispatchEvent({type: 'change'});
  }

  private transitionTo(to: CameraPose): void {
    this.syncCamera();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.applyPose(to);
      this.syncCamera();
      return;
    }
    this.transition = {
      startedAt: performance.now(),
      from: {
        focus: this.focus.clone(),
        distance: this.object.position.distanceTo(this.focus),
        orientation: this.object.quaternion.clone(),
      },
      to,
    };
  }

  private applyPose(pose: CameraPose): void {
    this.focus.copy(pose.focus);
    this.object.quaternion.copy(pose.orientation);
    this.object.position
      .set(0, 0, pose.distance)
      .applyQuaternion(pose.orientation)
      .add(this.focus);
    this.object.up.set(0, 1, 0).applyQuaternion(pose.orientation);
    this.object.updateMatrixWorld();
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
    this.setTbRadius(this.radiusFactor);
  }
}

function viewOrientation(direction: Vector3, up: Vector3): Quaternion {
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(direction, new Vector3(), up),
  );
}
