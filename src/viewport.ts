import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from './model/compiler';
import type {
  ModelOperationInputRole,
  ModelSnapshotObject,
  ParameterUsage,
  RenderMesh,
  SourceRef,
  Transform,
  Vec3,
} from './model/runtime';
import {
  PositionGizmo,
  type PositionAxis,
  type PositionGizmoBinding,
  type PositionGizmoEvent,
} from './tools/position-gizmo';
import type {
  SourceDecorationProvider,
  ViewportDecoration,
} from './viewport-decoration';

export type Occurrence = Readonly<{
  key: string;
  node: ModelSnapshotObject;
  object: THREE.Object3D;
  depth: number;
  view: 'model' | 'outline' | 'source';
}>;

type SourceViewTarget = Readonly<{
  kind: 'source';
  targetId: string;
  evaluationIndex: number;
}>;

type SelectedViewTarget = Readonly<{kind: 'model'}> | SourceViewTarget;

type RenderedViewTarget =
  | SelectedViewTarget
  | Readonly<{kind: 'outline'; nodeIds: readonly string[]}>
  | Readonly<{kind: 'completion'}>;

type TransientPreviewRestore = Readonly<{
  module: ModelModule;
  selectedKey: string;
  cameraPosition: THREE.Vector3;
  controlsTarget: THREE.Vector3;
  cameraNear: number;
  cameraFar: number;
}>;

type SelectionGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  blocked: boolean;
};

type SelectionClick = Readonly<{
  node: ModelSnapshotObject;
  x: number;
  y: number;
  time: number;
}>;

type DecorationInstance = Readonly<{
  object: THREE.Object3D;
  occurrenceKey?: string;
}>;

export type ModelViewportOptions = Readonly<{
  onSelect: (occurrence: Occurrence) => void;
  onDrillDown: (node: ModelSnapshotObject) => void;
  onNavigateSource: (sourceRef: SourceRef) => void;
  onPositionTool: (event: PositionGizmoEvent) => void;
  sourceDecorationProviders?: readonly SourceDecorationProvider[];
}>;

const sourceDecorationOwner = (providerId: string): string =>
  `source-context:${providerId}`;
const selectionDragThreshold = 4;
const doubleClickDistance = 6;
const doubleClickInterval = 450;

export class ModelViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly root = new THREE.Group();
  private readonly decorationRoot = new THREE.Group();
  private readonly occurrences = new Map<string, Occurrence>();
  private readonly parameterPreviews = new Map<string, number>();
  private readonly committedParameterPreviews = new Map<string, number>();
  private readonly occurrenceTranslationPreviews = new Map<string, Vec3>();
  private readonly committedOccurrenceTranslationPreviews = new Map<
    string,
    Vec3
  >();
  private readonly decorationLayers = new Map<string, DecorationInstance[]>();
  private readonly positionGizmo: PositionGizmo;
  private readonly onSelect: ModelViewportOptions['onSelect'];
  private readonly onDrillDown: ModelViewportOptions['onDrillDown'];
  private readonly onNavigateSource: ModelViewportOptions['onNavigateSource'];
  private readonly sourceDecorationProviders: readonly SourceDecorationProvider[];
  private readonly impactHelpers: THREE.BoxHelper[] = [];
  private selectionHelper: THREE.BoxHelper | null = null;
  private highlightedTargetId?: string;
  private highlightedOccurrenceKeys = new Set<string>();
  private selectionEmphasized = true;
  private selectedKey = 'root';
  private explode = 0;
  private module: ModelModule | null = null;
  private selectedViewTarget: SelectedViewTarget = {kind: 'model'};
  private renderedViewTarget: RenderedViewTarget = {kind: 'model'};
  private transientPreviewRestore?: TransientPreviewRestore;
  private selectionGesture?: SelectionGesture;
  private selectionClick?: SelectionClick;

  constructor(
    private readonly container: HTMLElement,
    {
      onSelect,
      onDrillDown,
      onNavigateSource,
      onPositionTool,
      sourceDecorationProviders = [],
    }: ModelViewportOptions,
  ) {
    this.onSelect = onSelect;
    this.onDrillDown = onDrillDown;
    this.onNavigateSource = onNavigateSource;
    this.sourceDecorationProviders = sourceDecorationProviders;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'viewport-canvas';
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color('#171815');
    this.scene.fog = new THREE.Fog('#171815', 180, 430);
    this.scene.add(this.root, this.decorationRoot);

    const hemi = new THREE.HemisphereLight('#f6f4df', '#333b40', 1.8);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#fff8df', 3.2);
    key.position.set(70, 110, 80);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#90a0ff', 1.6);
    rim.position.set(-80, 55, -65);
    this.scene.add(rim);

    const grid = new THREE.GridHelper(360, 36, '#4b5046', '#282b26');
    grid.position.y = -0.08;
    this.scene.add(grid);

    this.camera.position.set(105, 82, 120);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.target.set(0, 20, 0);
    this.controls.minDistance = 20;
    this.controls.maxDistance = 650;
    this.positionGizmo = new PositionGizmo(
      this.scene,
      this.camera,
      this.renderer.domElement,
      enabled => {
        this.controls.enabled = enabled;
      },
      onPositionTool,
    );

    this.renderer.domElement.addEventListener('pointerdown', event =>
      this.beginSelectionGesture(event),
    );
    this.renderer.domElement.addEventListener('pointermove', event =>
      this.updateSelectionGesture(event),
    );
    this.renderer.domElement.addEventListener('pointerup', event =>
      this.endSelectionGesture(event),
    );
    this.renderer.domElement.addEventListener('pointercancel', event =>
      this.cancelSelectionGesture(event),
    );

    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    this.animate();
  }

  renderModule(
    module: ModelModule,
    selectedKey = 'root',
    fitCamera = true,
  ): void {
    this.module = module;
    this.selectedViewTarget = {kind: 'model'};
    this.transientPreviewRestore = undefined;
    if (module.fallback) {
      this.renderModelView(selectedKey, fitCamera);
    } else {
      this.renderedViewTarget = {kind: 'model'};
      this.resetRenderedView();
    }
  }

  selectBySourceOffset(
    file: string,
    offset: number,
    preferredOccurrenceKey?: string,
    preferredContextId?: string,
  ): boolean {
    const match = this.sourceTargetAt(file, offset);
    if (!match) {
      return false;
    }

    const preferredSourceIndex = sourceEvaluationIndex(preferredOccurrenceKey);
    const matchingContextIndex = preferredContextId
      ? match.evaluations.findIndex(
          evaluation => evaluation.contextId === preferredContextId,
        )
      : -1;
    const preferredEvaluationIndex =
      this.renderedViewTarget.kind === 'source' &&
      this.renderedViewTarget.targetId === match.id
        ? this.renderedViewTarget.evaluationIndex
        : preferredSourceIndex !== undefined
          ? preferredSourceIndex
          : matchingContextIndex;
    const evaluationIndex = match.evaluations[preferredEvaluationIndex]
      ? preferredEvaluationIndex
      : 0;
    this.selectedViewTarget = {
      kind: 'source',
      targetId: match.id,
      evaluationIndex,
    };
    this.transientPreviewRestore = undefined;
    if (
      this.renderedViewTarget.kind !== 'source' ||
      this.renderedViewTarget.targetId !== match.id ||
      this.renderedViewTarget.evaluationIndex !== evaluationIndex
    ) {
      this.renderSourceTarget(
        match,
        evaluationIndex,
        true,
        preferredOccurrenceKey,
      );
    } else if (
      preferredOccurrenceKey &&
      this.occurrences.has(preferredOccurrenceKey)
    ) {
      this.selectKey(preferredOccurrenceKey, false);
    }
    return true;
  }

  selectEvaluationContext(contextId: string): boolean {
    const scope = this.renderedSourceScope();
    if (!scope) return false;
    const evaluationIndex = scope.target.evaluations.findIndex(
      evaluation => evaluation.contextId === contextId,
    );
    if (evaluationIndex < 0) return false;
    this.selectedViewTarget = {
      kind: 'source',
      targetId: scope.target.id,
      evaluationIndex,
    };
    this.transientPreviewRestore = undefined;
    this.renderSourceTarget(scope.target, evaluationIndex, false);
    return true;
  }

  selectSourceEvaluation(evaluationIndex: number): boolean {
    const scope = this.renderedSourceScope();
    if (!scope?.target.evaluations[evaluationIndex]) return false;
    this.selectedViewTarget = {
      kind: 'source',
      targetId: scope.target.id,
      evaluationIndex,
    };
    this.transientPreviewRestore = undefined;
    this.renderSourceTarget(scope.target, evaluationIndex, false);
    return true;
  }

  sourceEvaluation():
    | Readonly<{
        target: SourceTarget;
        evaluation: SourceTargetEvaluation;
        evaluationIndex: number;
      }>
    | undefined {
    const scope = this.renderedSourceScope();
    return scope && this.renderedViewTarget.kind === 'source'
      ? {
          ...scope,
          evaluationIndex: this.renderedViewTarget.evaluationIndex,
        }
      : undefined;
  }

  selectRoot(): void {
    this.selectedViewTarget = {kind: 'model'};
    this.transientPreviewRestore = undefined;
    if (!this.module?.fallback) {
      this.renderedViewTarget = {kind: 'model'};
      this.resetRenderedView();
      return;
    }
    if (!this.occurrences.has('root')) {
      this.renderModelView('root', true);
    }
    this.selectKey('root', true);
  }

  previewOutline(nodeIds: readonly string[]): boolean {
    const nodes = this.resolveNodes(nodeIds);
    if (nodes.length === 0) {
      return false;
    }
    this.captureTransientPreviewRestore();
    this.renderOutlinePreview(nodes);
    return true;
  }

  previewCompletion(
    target: SourceTarget,
    evaluationIndex: number,
    memberName: string,
  ): boolean {
    const evaluation = target.evaluations[evaluationIndex];
    if (!this.module || !evaluation) return false;
    const receiverNodeId =
      evaluation.element?.nodeId ??
      evaluation.nodeIds.find(nodeId => this.module?.objects.has(nodeId));
    const receiver = receiverNodeId
      ? this.module.objects.get(receiverNodeId)
      : undefined;
    if (!receiver) return false;
    const element = receiver.elements.find(
      candidate => candidate.name === memberName,
    );
    const previewEvaluation: SourceTargetEvaluation = {
      ...evaluation,
      element: element
        ? {
            nodeId: receiver.nodeId,
            name: element.name,
            kind: element.kind,
          }
        : undefined,
    };
    const previewTarget: SourceTarget = {
      ...target,
      id: `completion:${target.id}`,
      kind: element ? 'element' : target.kind,
      evaluations: [previewEvaluation],
    };
    this.captureTransientPreviewRestore();
    this.renderSourceScene(
      previewTarget,
      previewEvaluation,
      {kind: 'completion'},
      true,
      undefined,
      receiver.nodeId,
    );
    return true;
  }

  previewCompletedProject(
    module: ModelModule,
    file: string,
    offset: number,
    preferredContextId?: string,
  ): boolean {
    this.captureTransientPreviewRestore();
    if (!this.transientPreviewRestore) return false;
    this.module = module;
    const target = this.sourceTargetAt(file, offset);
    if (target) {
      const matchingContext = preferredContextId
        ? target.evaluations.findIndex(
            evaluation => evaluation.contextId === preferredContextId,
          )
        : -1;
      const evaluation =
        target.evaluations[matchingContext] ?? target.evaluations[0];
      if (evaluation) {
        this.renderSourceScene(target, evaluation, {kind: 'completion'}, true);
        return true;
      }
    }
    if (!module.fallback) return false;
    this.renderModelView('root', true, {kind: 'completion'});
    return true;
  }

  restoreTransientPreview(): void {
    const restore = this.transientPreviewRestore;
    if (!restore) {
      return;
    }
    this.transientPreviewRestore = undefined;
    this.module = restore.module;
    const target = this.selectedViewTarget;
    if (target.kind === 'model') {
      this.renderModelView(restore.selectedKey, false);
    } else {
      const sourceTarget = this.module.sourceTargets.find(
        candidate => candidate.id === target.targetId,
      );
      if (sourceTarget) {
        this.renderSourceTarget(
          sourceTarget,
          target.evaluationIndex,
          false,
          restore.selectedKey,
        );
      } else {
        this.selectedViewTarget = {kind: 'model'};
        this.renderModelView('root', false);
      }
    }
    this.camera.position.copy(restore.cameraPosition);
    this.controls.target.copy(restore.controlsTarget);
    this.camera.near = restore.cameraNear;
    this.camera.far = restore.cameraFar;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  getSelected(): Occurrence | undefined {
    return this.occurrences.get(this.selectedKey);
  }

  hasRelativePositionContext(): boolean {
    return isRelativePositionContext(this.renderedSourceScope()?.target);
  }

  sourceConstraintParameters(): readonly ParameterUsage[] | undefined {
    const scope = this.renderedSourceScope();
    const occurrence = this.getSelected();
    if (scope?.target.kind !== 'constraint' || !occurrence) {
      return undefined;
    }
    return occurrence.node.constraints.find(
      constraint => constraint.id === scope.evaluation.constraintId,
    )?.parameters;
  }

  setExplode(value: number): void {
    this.explode = value;
    this.applyPreviewTransforms();
  }

  setParameterPreview(targetId: string, value: number): void {
    this.parameterPreviews.set(targetId, value);
    if (this.highlightedTargetId !== targetId) {
      this.highlightedTargetId = targetId;
      this.rebuildImpactHelpers();
    }
    this.applyPreviewTransforms();
  }

  clearParameterPreview(targetId: string): void {
    const committed = this.committedParameterPreviews.get(targetId);
    if (committed === undefined) {
      this.parameterPreviews.delete(targetId);
    } else {
      this.parameterPreviews.set(targetId, committed);
    }
    if (this.highlightedTargetId === targetId) {
      this.highlightedTargetId = this.parameterPreviews.keys().next().value;
      this.rebuildImpactHelpers();
    }
    this.applyPreviewTransforms();
  }

  commitParameterPreview(targetId: string, value: number): void {
    this.committedParameterPreviews.set(targetId, value);
    this.parameterPreviews.set(targetId, value);
    this.positionGizmo.commitParameterValue(targetId, value);
  }

  setOccurrenceTranslationPreview(
    occurrenceKeys: readonly string[],
    delta: Vec3,
  ): void {
    occurrenceKeys.forEach(key => {
      const committed = this.committedOccurrenceTranslationPreviews.get(key);
      this.occurrenceTranslationPreviews.set(key, [
        (committed?.[0] ?? 0) + delta[0],
        (committed?.[1] ?? 0) + delta[1],
        (committed?.[2] ?? 0) + delta[2],
      ]);
    });
    this.highlightedOccurrenceKeys = new Set(occurrenceKeys);
    this.rebuildImpactHelpers();
    this.applyPreviewTransforms();
  }

  clearOccurrenceTranslationPreview(occurrenceKeys: readonly string[]): void {
    occurrenceKeys.forEach(key => {
      const committed = this.committedOccurrenceTranslationPreviews.get(key);
      if (committed) {
        this.occurrenceTranslationPreviews.set(key, committed);
      } else {
        this.occurrenceTranslationPreviews.delete(key);
      }
    });
    this.highlightedOccurrenceKeys = new Set(
      this.committedOccurrenceTranslationPreviews.keys(),
    );
    this.rebuildImpactHelpers();
    this.applyPreviewTransforms();
  }

  commitOccurrenceTranslationPreview(occurrenceKeys: readonly string[]): void {
    occurrenceKeys.forEach(key => {
      const translation = this.occurrenceTranslationPreviews.get(key);
      if (translation) {
        this.committedOccurrenceTranslationPreviews.set(key, translation);
      }
    });
  }

  setDecorations(
    owner: string,
    decorations: readonly ViewportDecoration[],
    scope?: Readonly<{occurrenceKeys: readonly string[]}>,
  ): void {
    this.clearDecorations(owner);
    if (decorations.length === 0) {
      return;
    }
    const occurrenceKeys = scope ? new Set(scope.occurrenceKeys) : undefined;
    this.root.updateMatrixWorld(true);
    const instances = decorations.flatMap<DecorationInstance>(decoration => {
      if (decoration.kind === 'mesh') {
        const object = createMeshDecorationObject(decoration);
        this.decorationRoot.add(object);
        return [{object}];
      }
      return [...this.occurrences.values()]
        .filter(
          occurrence =>
            occurrence.node.nodeId === decoration.nodeId &&
            (!occurrenceKeys || occurrenceKeys.has(occurrence.key)),
        )
        .map(occurrence => {
          const decorationObject =
            decoration.kind === 'surface'
              ? createSurfaceDecorationObject(decoration)
              : createAnchorDecorationObject(decoration);
          const object = new THREE.Group();
          object.matrixAutoUpdate = false;
          object.add(decorationObject);
          this.decorationRoot.add(object);
          const instance = {object, occurrenceKey: occurrence.key};
          this.updateDecorationTransform(instance);
          return instance;
        });
    });
    if (instances.length > 0) this.decorationLayers.set(owner, instances);
  }

  clearDecorations(owner: string): void {
    const instances = this.decorationLayers.get(owner);
    if (!instances) {
      return;
    }
    instances.forEach(({object}) => {
      object.removeFromParent();
      disposeObject(object);
    });
    this.decorationLayers.delete(owner);
  }

  hideSourceDecorationsDuringPreview(): void {
    this.sourceDecorationProviders
      .filter(provider => provider.previewBehavior === 'hide')
      .forEach(provider =>
        this.clearDecorations(sourceDecorationOwner(provider.id)),
      );
  }

  restoreSourceDecorations(): void {
    const scope = this.renderedSourceScope();
    if (this.module && scope) {
      this.renderSourceDecorations(this.module, scope.target, scope.evaluation);
    }
  }

  cancelPositionTool(): boolean {
    return this.positionGizmo.cancel();
  }

  fit(target: THREE.Object3D = this.root): void {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) {
      return;
    }

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const distance = Math.max(sphere.radius * 2.8, 24);
    this.controls.target.copy(sphere.center);
    this.camera.position
      .copy(sphere.center)
      .addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 1000, 0.05);
    this.camera.far = Math.max(distance * 20, 1000);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  focusSelection(): void {
    const occurrence = this.getSelected();
    if (occurrence) {
      this.fit(occurrence.object);
    }
  }

  private buildObject(
    node: ModelSnapshotObject,
    key: string,
    depth: number,
    view: Occurrence['view'],
  ): THREE.Object3D {
    const object = createThreeObject(node);
    object.name = node.name;
    object.userData.selectionKey = key;
    applyNodeTransform(object, node);

    const occurrence = {key, node, object, depth, view};
    this.occurrences.set(key, occurrence);

    node.children.forEach((child, index) => {
      object.add(this.buildObject(child, `${key}/${index}`, depth + 1, view));
    });

    return object;
  }

  private renderSourceTarget(
    target: SourceTarget,
    evaluationIndex: number,
    fitCamera = true,
    selectedKey?: string,
  ): void {
    const evaluation = target.evaluations[evaluationIndex];
    if (!evaluation) {
      return;
    }
    this.renderSourceScene(
      target,
      evaluation,
      {kind: 'source', targetId: target.id, evaluationIndex},
      fitCamera,
      selectedKey,
    );
  }

  private renderSourceScene(
    target: SourceTarget,
    evaluation: SourceTargetEvaluation,
    renderedViewTarget: RenderedViewTarget,
    fitCamera: boolean,
    selectedKey?: string,
    focusedNodeId = evaluation.element?.nodeId,
  ): void {
    const relatedNodes = this.resolveNodes(evaluation.nodeIds);
    const focusNodes = focusedNodeId
      ? relatedNodes.filter(node => node.nodeId === focusedNodeId)
      : relatedNodes;
    const relationContextNodes = focusedNodeId
      ? relatedNodes
          .filter(node => node.nodeId !== focusedNodeId)
          .map(node => ({node, targetId: target.id}))
      : [];
    const contextNodes = uniqueContextNodes([
      ...relationContextNodes,
      ...this.resolveContextNodes(
        target.contextTargetIds,
        evaluation.operationId,
        evaluation.nodeIds,
      ),
    ]);
    const layeredScene = focusNodes.length + contextNodes.length > 1;
    this.selectionEmphasized =
      focusedNodeId !== undefined || target.kind !== 'constraint';
    this.renderedViewTarget = renderedViewTarget;
    this.resetRenderedView();
    contextNodes.forEach(({node, targetId}, index) => {
      this.root.add(
        this.buildContextObject(node, `context/${index}`, targetId),
      );
    });
    focusNodes.forEach((node, index) => {
      const object = this.buildObject(node, `source/${index}`, 1, 'source');
      if (layeredScene) makeFocusObjectTranslucent(object);
      this.root.add(object);
    });
    this.renderSourceDecorations(this.module!, target, evaluation);
    this.applyPreviewTransforms();
    const nextKey =
      selectedKey && this.occurrences.has(selectedKey)
        ? selectedKey
        : this.occurrences.keys().next().value;
    if (nextKey) {
      this.selectKey(nextKey, false);
    }
    if (fitCamera) {
      this.fit();
    }
  }

  private renderModelView(
    selectedKey: string,
    fitCamera: boolean,
    renderedViewTarget: RenderedViewTarget = {kind: 'model'},
  ): void {
    if (!this.module?.fallback) {
      return;
    }
    this.selectionEmphasized = true;
    this.renderedViewTarget = renderedViewTarget;
    this.resetRenderedView();
    const rootObject = this.buildObject(
      this.module.fallback,
      'root',
      this.module.fallback.kind === 'group' ? 0 : 1,
      'model',
    );
    this.root.add(rootObject);
    this.applyPreviewTransforms();
    this.selectKey(
      this.occurrences.has(selectedKey) ? selectedKey : 'root',
      false,
    );
    if (fitCamera) {
      this.fit();
    }
  }

  private renderOutlinePreview(nodes: readonly ModelSnapshotObject[]): void {
    this.selectionEmphasized = true;
    this.renderedViewTarget = {
      kind: 'outline',
      nodeIds: nodes.map(node => node.nodeId),
    };
    this.resetRenderedView();
    nodes.forEach((node, index) => {
      this.root.add(this.buildObject(node, `outline/${index}`, 1, 'outline'));
    });
    this.applyPreviewTransforms();
    this.fit();
  }

  private sourceTargetAt(
    file: string,
    offset: number,
  ): SourceTarget | undefined {
    return this.module?.sourceTargets
      .filter(
        ({sourceRef}) =>
          sourceRef.file === file &&
          sourceRef.start <= offset &&
          offset <= sourceRef.end,
      )
      .sort(
        (left, right) =>
          sourceSpan(left.sourceRef) - sourceSpan(right.sourceRef) ||
          sourceTargetPriority(left) - sourceTargetPriority(right),
      )[0];
  }

  private buildContextObject(
    node: ModelSnapshotObject,
    key: string,
    targetId: string,
  ): THREE.Object3D {
    const object = createThreeObject(node);
    object.name = `${node.name} (context)`;
    object.userData.context = true;
    object.userData.sourceTargetId = targetId;
    object.userData.sourceNodeId = node.nodeId;
    applyNodeTransform(object, node);
    dimObject(object);
    node.children.forEach((child, index) => {
      object.add(this.buildContextObject(child, `${key}/${index}`, targetId));
    });
    return object;
  }

  private resolveNodes(nodeIds: readonly string[]): ModelSnapshotObject[] {
    if (!this.module) {
      return [];
    }
    const seen = new Set<string>();
    return nodeIds.flatMap(nodeId => {
      const node = this.module?.objects.get(nodeId);
      if (!node || seen.has(node.nodeId)) {
        return [];
      }
      seen.add(node.nodeId);
      return [node];
    });
  }

  private resolveContextNodes(
    targetIds: readonly string[],
    operationId: string | undefined,
    focusNodeIds: readonly string[],
  ): Array<Readonly<{node: ModelSnapshotObject; targetId: string}>> {
    const focus = new Set(focusNodeIds);
    const seen = new Set<string>();
    return targetIds.flatMap(targetId => {
      const target = this.module?.sourceTargets.find(
        candidate => candidate.id === targetId,
      );
      if (!target) {
        return [];
      }
      const evaluation = target.evaluations.find(
        candidate => candidate.operationId === operationId,
      );
      if (!evaluation) {
        return [];
      }
      return this.resolveNodes(evaluation.nodeIds).flatMap(node => {
        if (focus.has(node.nodeId) || seen.has(node.nodeId)) {
          return [];
        }
        seen.add(node.nodeId);
        return [{node, targetId}];
      });
    });
  }

  private captureTransientPreviewRestore(): void {
    if (!this.module) return;
    this.transientPreviewRestore ??= {
      module: this.module,
      selectedKey: this.selectedKey,
      cameraPosition: this.camera.position.clone(),
      controlsTarget: this.controls.target.clone(),
      cameraNear: this.camera.near,
      cameraFar: this.camera.far,
    };
  }

  private resetRenderedView(): void {
    this.positionGizmo.detach();
    this.clearImpactHelpers();
    this.clearAllDecorations();
    this.disposeRoot();
    this.occurrences.clear();
    this.rebuildSelectionHelper();
    this.parameterPreviews.clear();
    this.committedParameterPreviews.clear();
    this.occurrenceTranslationPreviews.clear();
    this.committedOccurrenceTranslationPreviews.clear();
    this.highlightedTargetId = undefined;
    this.highlightedOccurrenceKeys.clear();
    this.selectionClick = undefined;
    this.root.clear();
    this.decorationRoot.clear();
  }

  private selectKey(key: string, notify: boolean): void {
    const occurrence = this.occurrences.get(key);
    if (!occurrence) {
      return;
    }
    this.selectedKey = key;
    this.rebuildSelectionHelper();
    this.rebuildImpactHelpers();
    this.updatePositionGizmo();
    if (notify) {
      this.onSelect(occurrence);
    }
  }

  private rebuildSelectionHelper(): void {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      this.selectionHelper.material.dispose();
      this.selectionHelper = null;
    }

    const occurrence = this.getSelected();
    if (!occurrence || !this.selectionEmphasized) {
      return;
    }
    this.selectionHelper = new THREE.BoxHelper(occurrence.object, '#d8ff3e');
    this.selectionHelper.material.depthTest = false;
    this.selectionHelper.material.transparent = true;
    this.selectionHelper.material.opacity = 0.85;
    this.selectionHelper.renderOrder = 20;
    this.scene.add(this.selectionHelper);
  }

  private updatePositionGizmo(): void {
    const occurrence = this.getSelected();
    if (
      !occurrence ||
      occurrence.depth === 0 ||
      !this.hasRelativePositionContext()
    ) {
      this.positionGizmo.detach();
      return;
    }
    const scope = this.renderedSourceScope();
    const constraintId =
      scope?.target.kind === 'constraint'
        ? scope.evaluation.constraintId!
        : null;
    this.positionGizmo.attach(
      occurrence.object,
      positionBindings(
        occurrence,
        [...this.occurrences.values()],
        constraintId,
      ),
    );
  }

  private renderedSourceScope():
    | Readonly<{
        target: SourceTarget;
        evaluation: SourceTargetEvaluation;
      }>
    | undefined {
    if (!this.module || this.renderedViewTarget.kind !== 'source') {
      return undefined;
    }
    const renderedTarget = this.renderedViewTarget;
    const target = this.module.sourceTargets.find(
      candidate => candidate.id === renderedTarget.targetId,
    );
    const evaluation = target?.evaluations[renderedTarget.evaluationIndex];
    return target && evaluation ? {target, evaluation} : undefined;
  }

  private applyPreviewTransforms(): void {
    for (const occurrence of this.occurrences.values()) {
      applyNodeTransform(occurrence.object, occurrence.node);
      const offset = this.previewTranslationFor(occurrence);
      occurrence.object.position.x += offset[0];
      occurrence.object.position.y += offset[1];
      occurrence.object.position.z += offset[2];

      if (
        this.renderedViewTarget.kind === 'model' &&
        occurrence.depth === 1 &&
        this.explode > 0
      ) {
        const factor = 1 + this.explode / 55;
        occurrence.object.position.multiplyScalar(factor);
      }
    }
    this.root.updateMatrixWorld(true);
    this.updateDecorationTransforms();
    this.selectionHelper?.update();
    this.impactHelpers.forEach(helper => helper.update());
    this.positionGizmo.updateAnchor();
  }

  private previewTranslationFor(occurrence: Occurrence): Vec3 {
    const occurrenceOffset = this.occurrenceTranslationPreviews.get(
      occurrence.key,
    );
    const offset: [number, number, number] = [
      occurrenceOffset?.[0] ?? 0,
      occurrenceOffset?.[1] ?? 0,
      occurrenceOffset?.[2] ?? 0,
    ];
    for (const constraint of occurrence.node.constraints) {
      const localOffset: [number, number, number] = [0, 0, 0];
      for (const parameter of constraint.parameters) {
        const previewValue = this.parameterPreviews.get(parameter.target.id);
        if (previewValue === undefined || parameter.operation !== 'offset') {
          continue;
        }
        const axis = axisIndex(parameter.argument);
        if (axis !== undefined) {
          localOffset[axis] +=
            (previewValue - parameter.target.value) * parameter.sensitivity;
        }
      }
      const frame = new THREE.Quaternion(...constraint.offsetFrame.quaternion);
      const worldOffset = new THREE.Vector3(...localOffset).applyQuaternion(
        frame,
      );
      offset[0] += worldOffset.x;
      offset[1] += worldOffset.y;
      offset[2] += worldOffset.z;
    }
    return offset;
  }

  private renderSourceDecorations(
    module: ModelModule,
    target: SourceTarget,
    evaluation: SourceTargetEvaluation,
  ): void {
    for (const provider of this.sourceDecorationProviders) {
      const decorations = provider.decorations({module, target, evaluation});
      this.setDecorations(sourceDecorationOwner(provider.id), decorations);
    }
  }

  private beginSelectionGesture(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) {
      this.selectionGesture = undefined;
      this.selectionClick = undefined;
      return;
    }
    this.selectionGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      blocked: this.positionGizmo.isPointerActive(),
    };
  }

  private updateSelectionGesture(event: PointerEvent): void {
    const gesture = this.selectionGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) {
      return;
    }
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    gesture.moved =
      deltaX * deltaX + deltaY * deltaY >
      selectionDragThreshold * selectionDragThreshold;
  }

  private endSelectionGesture(event: PointerEvent): void {
    const gesture = this.selectionGesture;
    this.selectionGesture = undefined;
    if (
      !gesture ||
      gesture.pointerId !== event.pointerId ||
      gesture.moved ||
      gesture.blocked
    ) {
      this.selectionClick = undefined;
      return;
    }
    const targets = this.pickTargets(event);
    const target = targets[0];
    if (!target) {
      this.selectionClick = undefined;
      return;
    }

    const previousDrillTarget = this.selectionClick;
    const repeatedDrillTarget = previousDrillTarget
      ? targets.find(
          candidate =>
            this.pickTargetNodeId(candidate) ===
            previousDrillTarget.node.nodeId,
        )
      : undefined;
    if (
      previousDrillTarget &&
      repeatedDrillTarget &&
      this.hasCompositionSourceContext() &&
      this.isDoubleClick(previousDrillTarget.node.nodeId, event)
    ) {
      this.selectionClick = undefined;
      this.onDrillDown(previousDrillTarget.node);
      return;
    }

    const selected = this.getSelected();
    const selectedTarget = selected
      ? targets.find(
          candidate =>
            this.pickTargetNodeId(candidate) === selected.node.nodeId,
        )
      : undefined;
    const nextSelectionClick =
      selected && selectedTarget && this.hasCompositionSourceContext()
        ? {
            node: selected.node,
            x: event.clientX,
            y: event.clientY,
            time: event.timeStamp,
          }
        : undefined;
    this.applyPickTarget(target);
    this.selectionClick = nextSelectionClick;
  }

  private pickTargetNodeId(target: ViewportPickTarget): string | undefined {
    return target.kind === 'occurrence'
      ? this.occurrences.get(target.key)?.node.nodeId
      : target.nodeId;
  }

  private cancelSelectionGesture(event: PointerEvent): void {
    if (this.selectionGesture?.pointerId === event.pointerId) {
      this.selectionGesture = undefined;
      this.selectionClick = undefined;
    }
  }

  private pickTargets(event: PointerEvent): readonly ViewportPickTarget[] {
    if (this.renderedViewTarget.kind === 'completion') return [];
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.root.children, true);
    const targets: ViewportPickTarget[] = [];
    const seen = new Set<string>();
    for (const {object} of hits) {
      const target = pickTargetFromAncestors(object);
      if (!target) continue;
      const identity = viewportPickTargetIdentity(target);
      if (seen.has(identity)) continue;
      seen.add(identity);
      targets.push(target);
    }
    return targets;
  }

  private applyPickTarget(target: ViewportPickTarget): void {
    if (target.kind === 'occurrence') {
      this.selectKey(target.key, true);
    } else {
      this.selectSourceTarget(target.targetId, target.nodeId);
    }
  }

  private hasCompositionSourceContext(): boolean {
    const scope = this.renderedSourceScope();
    return Boolean(
      scope?.evaluation.operationId && scope.target.contextTargetIds.length > 0,
    );
  }

  private isDoubleClick(nodeId: string, event: PointerEvent): boolean {
    const previous = this.selectionClick;
    if (!previous || previous.node.nodeId !== nodeId) return false;
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    return (
      event.timeStamp - previous.time <= doubleClickInterval &&
      deltaX * deltaX + deltaY * deltaY <=
        doubleClickDistance * doubleClickDistance
    );
  }

  private selectSourceTarget(targetId: string, nodeId: string): void {
    const target = this.module?.sourceTargets.find(
      candidate => candidate.id === targetId,
    );
    if (!target) {
      return;
    }
    const evaluationIndex = target.evaluations.findIndex(evaluation =>
      this.resolveNodes(evaluation.nodeIds).some(node =>
        containsNode(node, nodeId),
      ),
    );
    if (evaluationIndex < 0) {
      return;
    }
    this.selectedViewTarget = {kind: 'source', targetId, evaluationIndex};
    this.transientPreviewRestore = undefined;
    this.renderSourceTarget(target, evaluationIndex, false);
    const occurrence = [...this.occurrences.values()].find(
      candidate => candidate.node.nodeId === nodeId,
    );
    if (occurrence) {
      this.selectKey(occurrence.key, false);
    }
    this.onNavigateSource(target.sourceRef);
    const selected = this.getSelected();
    if (selected) {
      this.onSelect(selected);
    }
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.selectionHelper?.update();
    this.impactHelpers.forEach(helper => helper.update());
    this.renderer.render(this.scene, this.camera);
  };

  private rebuildImpactHelpers(): void {
    this.clearImpactHelpers();
    if (
      !this.highlightedTargetId &&
      this.highlightedOccurrenceKeys.size === 0
    ) {
      return;
    }
    for (const occurrence of this.occurrences.values()) {
      if (
        occurrence.key === this.selectedKey ||
        (!this.highlightedOccurrenceKeys.has(occurrence.key) &&
          !occurrence.node.parameters.some(
            parameter => parameter.target.id === this.highlightedTargetId,
          ))
      ) {
        continue;
      }
      const helper = new THREE.BoxHelper(occurrence.object, '#8ea2ff');
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.72;
      helper.renderOrder = 19;
      this.impactHelpers.push(helper);
      this.scene.add(helper);
    }
  }

  private clearImpactHelpers(): void {
    for (const helper of this.impactHelpers) {
      this.scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
    }
    this.impactHelpers.length = 0;
  }

  private updateDecorationTransforms(): void {
    for (const instances of this.decorationLayers.values()) {
      instances.forEach(instance => this.updateDecorationTransform(instance));
    }
  }

  private updateDecorationTransform(instance: DecorationInstance): void {
    if (!instance.occurrenceKey) return;
    const occurrence = this.occurrences.get(instance.occurrenceKey);
    if (!occurrence) return;
    instance.object.matrix.copy(occurrence.object.matrixWorld);
    instance.object.matrixWorldNeedsUpdate = true;
  }

  private clearAllDecorations(): void {
    for (const owner of [...this.decorationLayers.keys()]) {
      this.clearDecorations(owner);
    }
  }

  private disposeRoot(): void {
    disposeObject(this.root);
  }
}

function positionBindings(
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
  constraintId: string | null,
): PositionGizmoBinding[] {
  const constraint =
    constraintId === null
      ? occurrence.node.constraints.at(-1)
      : occurrence.node.constraints.find(
          candidate => candidate.id === constraintId,
        );
  if (!constraint) {
    return [];
  }
  const receiver = constraint.sourceRefs.at(-1);
  const parameters = preferUpstreamTargets(
    constraint.parameters.filter(({operation}) => operation === 'offset'),
  );
  const modelParameters = occurrences.flatMap(({node}) => node.parameters);
  const safeTargets = positionOnlyTargets(modelParameters);
  const byTarget = new Map<
    string,
    {
      target: ParameterUsage['target'];
      sensitivities: Map<PositionAxis, number>;
    }
  >();
  for (const parameter of parameters) {
    if (!safeTargets.has(parameter.target.id)) {
      continue;
    }
    if (parameter.operation !== 'offset') {
      continue;
    }
    const axis = positionAxis(parameter.argument);
    if (!axis || !Number.isFinite(parameter.sensitivity)) {
      continue;
    }
    const aggregate = byTarget.get(parameter.target.id) ?? {
      target: parameter.target,
      sensitivities: new Map<PositionAxis, number>(),
    };
    aggregate.sensitivities.set(
      axis,
      (aggregate.sensitivities.get(axis) ?? 0) + parameter.sensitivity,
    );
    byTarget.set(parameter.target.id, aggregate);
  }

  const candidates = new Map<PositionAxis, PositionGizmoBinding[]>();
  for (const {target, sensitivities} of byTarget.values()) {
    const effective = [...sensitivities].filter(
      ([, sensitivity]) => Math.abs(sensitivity) > 1e-9,
    );
    if (effective.length !== 1) {
      continue;
    }
    const [axis, sensitivity] = effective[0];
    const binding: PositionGizmoBinding = {
      kind: 'parameter',
      axis,
      target,
      label: target.label,
      value: target.value,
      sensitivity,
      parameterKind: target.kind,
      unit: target.unit,
      min: target.min,
      max: target.max,
      step: target.step,
      frame: constraint.offsetFrame,
    };
    const axisCandidates = candidates.get(axis) ?? [];
    axisCandidates.push(binding);
    candidates.set(axis, axisCandidates);
  }

  return (['x', 'y', 'z'] as const).flatMap(axis => {
    const axisCandidates = candidates.get(axis) ?? [];
    if (axisCandidates.length === 1) {
      return axisCandidates;
    }
    if (!receiver) {
      return [];
    }
    const occurrenceKeys = occurrences
      .filter(({node}) =>
        node.constraints.some(candidate =>
          candidate.sourceRefs.some(sourceRef =>
            sameSource(sourceRef, receiver),
          ),
        ),
      )
      .map(({key}) => key);
    return [
      {
        kind: 'expression',
        axis,
        label: `Δ${axis.toUpperCase()}`,
        value: 0,
        sensitivity: 1,
        parameterKind: 'length',
        step: 0.5,
        frame: constraint.offsetFrame,
        receiver: {sourceRef: receiver},
        occurrenceKeys,
      },
    ];
  });
}

function preferUpstreamTargets(
  parameters: readonly ParameterUsage[],
): ParameterUsage[] {
  const groups = new Map<string, ParameterUsage[]>();
  for (const parameter of parameters) {
    const {file, start, end} = parameter.expressionRef;
    const key = `${parameter.operation}:${parameter.argument}:${file}:${start}:${end}`;
    const group = groups.get(key) ?? [];
    group.push(parameter);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap(group => {
    const upstream = group.filter(
      ({expressionRef, target}) =>
        !containsSource(expressionRef, target.sourceRef),
    );
    return upstream.length > 0 ? upstream : group;
  });
}

function containsSource(container: SourceRef, candidate: SourceRef): boolean {
  return (
    container.file === candidate.file &&
    container.start <= candidate.start &&
    candidate.end <= container.end
  );
}

function sameSource(left: SourceRef, right: SourceRef): boolean {
  return (
    left.file === right.file &&
    left.start === right.start &&
    left.end === right.end
  );
}

function sourceSpan(sourceRef: SourceRef): number {
  return sourceRef.end - sourceRef.start;
}

function sourceTargetPriority(target: SourceTarget): number {
  if (target.kind === 'element') return -1;
  if (target.kind === 'constraint') return 0;
  if (target.kind === 'operation-input') return 1;
  if (target.kind === 'operation-output') return 2;
  return 3;
}

function isRelativePositionContext(target: SourceTarget | undefined): boolean {
  if (target?.kind === 'constraint') return true;
  const role = target?.operation?.role;
  return target?.kind === 'operation-input' && isCompositionRole(role);
}

function isCompositionRole(role: ModelOperationInputRole | undefined): boolean {
  return (
    role === 'receiver' ||
    role === 'operand' ||
    role === 'tool' ||
    role === 'child'
  );
}

function positionOnlyTargets(
  parameters: readonly ParameterUsage[],
): Set<string> {
  const usages = new Map<string, ParameterUsage[]>();
  for (const parameter of parameters) {
    const targetUsages = usages.get(parameter.target.id) ?? [];
    targetUsages.push(parameter);
    usages.set(parameter.target.id, targetUsages);
  }

  const safe = new Set<string>();
  for (const [targetId, targetUsages] of usages) {
    const axes = new Set(
      targetUsages.map(usage =>
        usage.operation === 'offset' ? positionAxis(usage.argument) : undefined,
      ),
    );
    if (
      axes.size === 1 &&
      !axes.has(undefined) &&
      targetUsages.every(
        ({sensitivity}) =>
          Number.isFinite(sensitivity) && Math.abs(sensitivity) > 1e-9,
      )
    ) {
      safe.add(targetId);
    }
  }
  return safe;
}

function positionAxis(argument: string): PositionAxis | undefined {
  if (argument === 'x') return 'x';
  if (argument === 'y') return 'y';
  if (argument === 'z') return 'z';
  return undefined;
}

function axisIndex(argument: string): 0 | 1 | 2 | undefined {
  if (argument === 'x') return 0;
  if (argument === 'y') return 1;
  if (argument === 'z') return 2;
  return undefined;
}

function createThreeObject(node: ModelSnapshotObject): THREE.Object3D {
  if (node.kind === 'group') {
    return new THREE.Group();
  }

  if (!node.mesh) {
    throw new Error(`OpenCascade solid ${node.name} has no renderable mesh.`);
  }

  const container = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: node.color,
    roughness: 0.52,
    metalness: 0.12,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  container.add(new THREE.Mesh(createSurfaceGeometry(node.mesh), material));

  const edgeGeometry = createEdgeGeometry(node.mesh);
  if (edgeGeometry) {
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: '#080a07',
      transparent: true,
      opacity: 0.72,
    });
    container.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
  }

  return container;
}

function createMeshDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'mesh'}>,
): THREE.Object3D {
  const container = createDecoratedMesh(
    decoration.id,
    decoration.mesh,
    decoration.appearance,
  );
  container.userData.decoration = decoration;
  applyTransform(container, decoration.transform);
  return container;
}

function createSurfaceDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'surface'}>,
): THREE.Object3D {
  const container = createDecoratedMesh(
    decoration.id,
    decoration.mesh,
    decoration.appearance,
  );
  container.userData.decoration = decoration;
  return container;
}

function createDecoratedMesh(
  id: string,
  mesh: RenderMesh,
  appearance: ViewportDecoration['appearance'],
): THREE.Object3D {
  const container = new THREE.Group();
  container.name = id;

  const depthBias = appearance.depthBias ?? 0;
  const materialOptions = {
    color: appearance.color,
    transparent: (appearance.opacity ?? 1) < 1,
    opacity: appearance.opacity ?? 1,
    depthTest: appearance.depthTest ?? true,
    depthWrite: false,
    polygonOffset: depthBias !== 0,
    polygonOffsetFactor: -depthBias,
    polygonOffsetUnits: -depthBias,
  } as const;
  const surfaceMaterial =
    appearance.shading === 'unlit'
      ? new THREE.MeshBasicMaterial({
          ...materialOptions,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({
          ...materialOptions,
          emissive: appearance.emissive,
          emissiveIntensity: appearance.emissiveIntensity ?? 0,
          roughness: 0.38,
          metalness: 0.06,
        });
  const surface = new THREE.Mesh(createSurfaceGeometry(mesh), surfaceMaterial);
  surface.renderOrder = 4;
  container.add(surface);

  const edgeGeometry = createEdgeGeometry(mesh);
  if (edgeGeometry && appearance.edgeColor) {
    const edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: appearance.edgeColor,
        transparent: (appearance.edgeOpacity ?? 1) < 1,
        opacity: appearance.edgeOpacity ?? 1,
        depthTest: appearance.depthTest ?? true,
        depthWrite: false,
      }),
    );
    edges.renderOrder = 5;
    container.add(edges);
  } else {
    edgeGeometry?.dispose();
  }
  return container;
}

function createAnchorDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'anchor'}>,
): THREE.Object3D {
  const {appearance, markerSize} = decoration;
  const color = new THREE.Color(appearance.color);
  const container = new THREE.Group();
  container.name = decoration.id;
  container.userData.decoration = decoration;
  applyTransform(container, decoration.transform);

  if (decoration.elementKind === 'point') {
    container.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(markerSize * 0.14, 20, 14),
        anchorSurfaceMaterial(appearance),
      ),
      anchorCross(markerSize * 0.38, appearance),
    );
  } else if (decoration.elementKind === 'line') {
    container.add(anchorAxis(decoration.span, markerSize, color));
  } else if (decoration.elementKind === 'face') {
    container.add(
      anchorArrow(new THREE.Vector3(0, 1, 0), markerSize, markerSize, color),
    );
  } else {
    container.add(
      anchorLine([0, 0, 0], [markerSize, 0, 0], appearance),
      anchorLine([0, 0, 0], [0, markerSize, 0], appearance),
      anchorLine([0, 0, 0], [0, 0, markerSize], appearance),
    );
  }
  container.traverse(object => {
    object.renderOrder = 24;
    const material = 'material' in object ? object.material : undefined;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach(candidate => {
      if (candidate instanceof THREE.Material) {
        candidate.depthTest = appearance.depthTest ?? false;
        candidate.depthWrite = false;
        candidate.transparent = true;
      }
    });
  });
  return container;
}

function anchorAxis(
  span: Readonly<{negative: number; positive: number}>,
  markerSize: number,
  color: THREE.Color,
): THREE.Object3D {
  const axis = new THREE.Group();
  axis.add(
    anchorArrow(new THREE.Vector3(0, 1, 0), span.positive, markerSize, color),
    anchorArrow(new THREE.Vector3(0, -1, 0), span.negative, markerSize, color),
  );
  return axis;
}

function anchorArrow(
  direction: THREE.Vector3,
  length: number,
  size: number,
  color: THREE.Color,
): THREE.ArrowHelper {
  return new THREE.ArrowHelper(
    direction,
    new THREE.Vector3(),
    length,
    color.getHex(),
    size * 0.28,
    size * 0.16,
  );
}

function anchorCross(
  radius: number,
  appearance: ViewportDecoration['appearance'],
): THREE.LineSegments {
  const points = [
    new THREE.Vector3(-radius, 0, 0),
    new THREE.Vector3(radius, 0, 0),
    new THREE.Vector3(0, -radius, 0),
    new THREE.Vector3(0, radius, 0),
    new THREE.Vector3(0, 0, -radius),
    new THREE.Vector3(0, 0, radius),
  ];
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    anchorLineMaterial(appearance),
  );
}

function anchorLine(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  appearance: ViewportDecoration['appearance'],
): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...from),
      new THREE.Vector3(...to),
    ]),
    anchorLineMaterial(appearance),
  );
}

function anchorSurfaceMaterial(
  appearance: ViewportDecoration['appearance'],
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: appearance.color,
    transparent: true,
    opacity: appearance.opacity ?? 1,
    depthTest: appearance.depthTest ?? false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function anchorLineMaterial(
  appearance: ViewportDecoration['appearance'],
): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: appearance.color,
    transparent: true,
    opacity: appearance.opacity ?? 1,
    depthTest: appearance.depthTest ?? false,
    depthWrite: false,
  });
}

function createSurfaceGeometry(mesh: RenderMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(mesh.vertices, 3),
  );
  if (mesh.normals.length === mesh.vertices.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createEdgeGeometry(
  mesh: RenderMesh,
): THREE.BufferGeometry | undefined {
  if (mesh.edges.length === 0) {
    return undefined;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
  return geometry;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => material.dispose());
    }
  });
}

function dimObject(object: THREE.Object3D): void {
  object.traverse(child => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.set('#788078');
          material.transparent = true;
          material.opacity = 0.18;
          material.depthWrite = false;
        }
      });
      child.renderOrder = -2;
    } else if (child instanceof THREE.LineSegments) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => {
        if (material instanceof THREE.LineBasicMaterial) {
          material.color.set('#a1aa9d');
          material.opacity = 0.28;
          material.depthWrite = false;
        }
      });
      child.renderOrder = -1;
    }
  });
}

function makeFocusObjectTranslucent(object: THREE.Object3D): void {
  object.traverse(child => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.transparent = true;
          material.opacity = 0.82;
          material.depthWrite = false;
        }
      });
    }
  });
}

function applyNodeTransform(
  object: THREE.Object3D,
  node: ModelSnapshotObject,
): void {
  applyTransform(object, node.transform);
}

function applyTransform(object: THREE.Object3D, transform: Transform): void {
  object.position.set(...transform.position);
  object.quaternion.set(...transform.quaternion);
  object.scale.set(...transform.scale);
}

type ViewportPickTarget =
  | Readonly<{kind: 'occurrence'; key: string}>
  | Readonly<{kind: 'source-target'; targetId: string; nodeId: string}>;

function viewportPickTargetIdentity(target: ViewportPickTarget): string {
  return target.kind === 'occurrence'
    ? `occurrence:${target.key}`
    : `source-target:${target.targetId}:${target.nodeId}`;
}

function pickTargetFromAncestors(
  object: THREE.Object3D,
): ViewportPickTarget | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.selectionKey === 'string') {
      return {kind: 'occurrence', key: current.userData.selectionKey};
    }
    if (
      typeof current.userData.sourceTargetId === 'string' &&
      typeof current.userData.sourceNodeId === 'string'
    ) {
      return {
        kind: 'source-target',
        targetId: current.userData.sourceTargetId,
        nodeId: current.userData.sourceNodeId,
      };
    }
    current = current.parent;
  }
  return undefined;
}

function sourceEvaluationIndex(
  occurrenceKey: string | undefined,
): number | undefined {
  if (!occurrenceKey?.startsWith('source/')) {
    return undefined;
  }
  return Number(occurrenceKey.split('/')[1]);
}

function containsNode(node: ModelSnapshotObject, nodeId: string): boolean {
  return (
    node.nodeId === nodeId ||
    node.children.some(child => containsNode(child, nodeId))
  );
}

function uniqueContextNodes(
  entries: readonly Readonly<{
    node: ModelSnapshotObject;
    targetId: string;
  }>[],
): Array<Readonly<{node: ModelSnapshotObject; targetId: string}>> {
  const seen = new Set<string>();
  return entries.filter(({node}) => {
    if (seen.has(node.nodeId)) return false;
    seen.add(node.nodeId);
    return true;
  });
}
