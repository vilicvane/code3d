import {
  action,
  computed,
  makeObservable,
  observableRef,
  observableShallow,
} from 'mobx';
import {transformCameraPose, type CameraPose} from '../rendering/view-camera';
import type {ModelRenderMode} from '../rendering/model-renderer';
import type {ModelModule} from './compiler';
import type {ViewportScene} from './viewport-scene';

type SceneView = Readonly<{
  scene: ViewportScene;
  /** Camera pose in the scene's canonical coordinate frame. */
  pose: CameraPose;
  mode: ModelRenderMode;
  keepLocalView: boolean;
  evaluation: symbol;
  checkedEvaluation: symbol;
  savedAt: number;
}>;

/** Session camera memory and geometry-check progress have one owner per scene. */
export class ViewportViewState {
  private readonly evaluations = new WeakMap<ModelModule, symbol>();
  private readonly views = new Map<string, SceneView>();
  private activeKey?: string;
  private order = 0;

  constructor() {
    makeObservable<this, 'views' | 'activeKey' | 'current'>(this, {
      views: observableShallow,
      activeKey: observableRef,
      current: computed,
      scene: computed,
      pose: computed,
      mode: computed,
      keepLocalView: computed,
      framingPending: computed,
      accept: action,
      remember: action,
      completeFraming: action,
      clear: action,
    });
  }

  private get current(): SceneView | undefined {
    return this.activeKey === undefined
      ? undefined
      : this.views.get(this.activeKey);
  }

  get scene(): ViewportScene | undefined {
    return this.current?.scene;
  }

  get pose(): CameraPose | undefined {
    const view = this.current;
    return (
      view && transformCameraPose(view.pose, view.scene.frame.clone().invert())
    );
  }

  get mode(): ModelRenderMode {
    return this.current?.mode ?? 'modeling';
  }

  get keepLocalView(): boolean {
    return this.current?.keepLocalView ?? false;
  }

  get framingPending(): boolean {
    const view = this.current;
    return !!view && view.evaluation !== view.checkedEvaluation;
  }

  /** Focus changes within one evaluation do not create another framing request. */
  accept(
    scene: ViewportScene,
    module: ModelModule,
    initialPose: () => CameraPose,
  ): void {
    let evaluation = this.evaluations.get(module);
    if (!evaluation) this.evaluations.set(module, (evaluation = Symbol()));
    let view = this.views.get(scene.key);
    if (!view) {
      const inherited = scene.defaults
        .flatMap(candidate => {
          const source = this.views.get(candidate.key);
          return source ? [{source, transform: candidate.transform}] : [];
        })
        .sort((a, b) => b.source.savedAt - a.source.savedAt)[0];
      view = inherited
        ? {
            ...inherited.source,
            pose: transformCameraPose(
              inherited.source.pose,
              inherited.transform,
            ),
          }
        : {
            scene,
            pose: transformCameraPose(initialPose(), scene.frame),
            mode: 'modeling',
            keepLocalView: false,
            evaluation,
            // A newly initialized view has already been fitted to its geometry.
            checkedEvaluation: evaluation,
            savedAt: 0,
          };
    }
    this.views.set(scene.key, {...view, scene, evaluation});
    this.activeKey = scene.key;
  }

  remember(
    pose: CameraPose,
    mode: ModelRenderMode,
    keepLocalView = this.keepLocalView,
  ): void {
    const view = this.current;
    if (!view) return;
    this.views.set(view.scene.key, {
      ...view,
      pose: transformCameraPose(pose, view.scene.frame),
      mode,
      keepLocalView,
      savedAt: ++this.order,
    });
  }

  /** Consume the latest accepted evaluation, including deliberate local views. */
  completeFraming(): void {
    const view = this.current;
    if (view)
      this.views.set(view.scene.key, {
        ...view,
        checkedEvaluation: view.evaluation,
      });
  }

  clear(): void {
    this.activeKey = undefined;
  }
}
