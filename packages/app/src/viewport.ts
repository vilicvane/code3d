import type {ModelDiagnostic} from './model/diagnostic';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
  TopologySelectionScope,
} from './model/compiler';
import {
  compareTopologyIds,
  sameTopologyId,
  TopologyIdSet,
  composeTransforms,
  type TopologyId,
  type ModelOperationInputRole,
  type ModelSnapshotObject,
  type ParameterUsage,
  type RenderMesh,
  type SourceRef,
  type TopologyKind,
  type Vec3,
} from '@code3d/core/tooling';
import {
  ModelRenderer,
  applyNodeTransform,
  applyTransform,
  createEdgeGeometry,
  createRenderedModelNode,
  createSurfaceGeometry,
  disposeObject,
  type ModelPlacement,
} from './rendering/model-renderer';
import {
  TransformGizmo,
  type TransformAxis,
  type TransformGizmoBinding,
  type TransformGizmoEvent,
} from './tools/transform-gizmo';
import type {
  SourceDecorationProvider,
  ViewportDecoration,
} from './viewport-decoration';
import {editableParameterUsages} from './model/parameter-provenance';
import {
  canPreviewConstraintTransform,
  spatialBindings,
} from './tools/model-spatial-tool';
import type {SpatialObjectPreview} from './tools/spatial-edit';
import {ViewportCoordinateReference} from './ui/viewport-coordinate-reference';
import {pickScreenTopology} from './rendering/topology-picking';
import {boundAppearance} from './rendering/bound-appearance';
import {writeBoxEdges} from './rendering/box-edges';
import {AnchorDecorationObject} from './rendering/anchor-decoration';
import {
  createScreenSpaceEdgeLines,
  ScreenSpaceCornerLines,
} from './rendering/screen-space-lines';
import {
  collectExportInstances,
  renderedModelName,
} from './rendering/model-export-scene';

export type Occurrence = Readonly<{
  key: string;
  node: ModelSnapshotObject;
  object: THREE.Object3D;
  depth: number;
  view: 'model' | 'source';
  placement: ModelPlacement;
  operationRole?: ModelOperationInputRole;
}>;

type SourceViewTarget = Readonly<{
  kind: 'source';
  targetId: string;
  evaluationIndex: number;
}>;

type SelectedViewTarget = Readonly<{kind: 'model'}> | SourceViewTarget;

type RenderedViewTarget = SelectedViewTarget | Readonly<{kind: 'completion'}>;

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
  anchor?: AnchorDecorationObject;
  corners?: ScreenSpaceCornerLines;
  bounds?: boolean;
  visibility?: 'without-object-bounds';
}>;

export type ModelViewportOptions = Readonly<{
  onSourcePreviewDiagnostic?: (diagnostic: ModelDiagnostic | undefined) => void;
  onSelect: (occurrence: Occurrence) => void;
  onDrillDown: (node: ModelSnapshotObject) => void;
  onNavigateSource: (sourceRef: SourceRef) => void;
  onPositionTool: (event: TransformGizmoEvent) => void;
  onTopologySelection: (event: TopologySelectionEvent) => void;
  sourceDecorationProviders?: readonly SourceDecorationProvider[];
  showCoordinateReference?: boolean;
}>;

export type TopologySelectionEvent =
  | Readonly<{
      kind: 'hover';
      topology: TopologyKind;
      id?: TopologyId;
      selectedIds: readonly TopologyId[];
    }>
  | Readonly<{
      kind: 'change';
      topology: TopologyKind;
      id: TopologyId;
      selectedIds: readonly TopologyId[];
    }>
  | Readonly<{kind: 'cancel'}>;

type TopologySelectionState = {
  kind: TopologyKind;
  multiple: boolean;
  occurrenceKey: string;
  mesh: RenderMesh;
  guide: THREE.Group;
  pickObject?: THREE.Mesh;
  selectedIds: TopologyIdSet;
  hoveredId?: TopologyId;
};

const symbolLineWidth = 1;
const interactiveLineWidth = 2;
const topologyPointSize = 5;
const toolSurfaceOpacity = 0.22;
const impactSurfaceOpacity = 0.08;

type ObjectHighlightAppearance =
  | Readonly<{
      kind: 'bounds';
      color: string;
      opacity: number;
      lineWidth: number;
      renderOrder: number;
    }>
  | Readonly<{
      kind: 'geometry';
      color: string;
      opacity: number;
      lineWidth: number;
      pointSize: number;
      surfaceOpacity: number;
      renderOrder: number;
    }>;

class ObjectHighlight extends THREE.Group {
  private readonly bounds = new THREE.Box3();
  private readonly boundsPositions = new Float32Array(12 * 2 * 3);
  private readonly corners?: ScreenSpaceCornerLines;
  private boundsOverridden = false;

  constructor(
    private readonly target: THREE.Object3D,
    node: ModelSnapshotObject,
    appearance: ObjectHighlightAppearance,
  ) {
    super();
    const geometryHighlight =
      appearance.kind === 'geometry'
        ? createObjectGeometryHighlight(node, appearance)
        : undefined;
    if (geometryHighlight) {
      this.add(geometryHighlight);
    } else {
      const lines = new ScreenSpaceCornerLines(
        this.boundsPositions,
        appearance.color,
        appearance.lineWidth,
        appearance.opacity,
        false,
        appearance.renderOrder,
      );
      this.corners = lines;
      this.add(lines);
    }
    this.frustumCulled = false;
    this.matrixAutoUpdate = false;
    this.update();
  }

  update(): void {
    if (!this.corners) {
      this.target.updateWorldMatrix(true, false);
      this.matrix.copy(this.target.matrixWorld);
      this.matrixWorldNeedsUpdate = true;
      return;
    }

    this.bounds.setFromObject(this.target);
    this.visible = !this.bounds.isEmpty() && !this.boundsOverridden;
    if (!this.visible) return;

    const {min, max} = this.bounds;
    this.corners.geometry.instanceCount =
      writeBoxEdges(
        this.boundsPositions,
        [min.x, min.y, min.z],
        [max.x, max.y, max.z],
      ) * 2;
  }

  updateScreenSize(camera: THREE.Camera, width: number, height: number): void {
    this.corners?.update(camera, width, height);
  }

  showsBoundsFor(target: THREE.Object3D): boolean {
    return this.target === target && !!this.corners && this.visible;
  }

  overrideBoundsFor(targets: ReadonlySet<THREE.Object3D>): void {
    const overridden = targets.has(this.target);
    if (!this.corners || this.boundsOverridden === overridden) return;
    this.boundsOverridden = overridden;
    this.update();
  }

  dispose(): void {
    disposeObject(this);
  }
}

const sourceDecorationOwner = (providerId: string): string =>
  `source-context:${providerId}`;
const selectionDragThreshold = 4;
const doubleClickDistance = 6;
const doubleClickInterval = 450;

export class ModelViewport {
  private topologyPointer?: Readonly<{clientX: number; clientY: number}>;
  private readonly rendering: ModelRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly coordinateReference?: ViewportCoordinateReference;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly root = new THREE.Group();
  private readonly decorationRoot = new THREE.Group();
  private readonly occurrences = new Map<string, Occurrence>();
  private readonly contextOccurrences = new Map<string, Occurrence>();
  private readonly parameterPreviews = new Map<string, number>();
  private readonly committedParameterPreviews = new Map<string, number>();
  private readonly occurrenceTranslationPreviews = new Map<string, Vec3>();
  private hasFramedView = false;
  private readonly committedOccurrenceTranslationPreviews = new Map<
    string,
    Vec3
  >();
  private readonly decorationLayers = new Map<string, DecorationInstance[]>();
  private readonly transformGizmo: TransformGizmo;
  private readonly spatialPreviews = new Map<string, SpatialObjectPreview>();
  private readonly committedSpatialPreviews = new Map<
    string,
    SpatialObjectPreview
  >();
  private readonly spatialParameterValues = new Map<string, number>();
  private readonly onSelect: ModelViewportOptions['onSelect'];
  private readonly onSourcePreviewDiagnostic: ModelViewportOptions['onSourcePreviewDiagnostic'];
  private readonly onDrillDown: ModelViewportOptions['onDrillDown'];
  private readonly onNavigateSource: ModelViewportOptions['onNavigateSource'];
  private readonly onTopologySelection: ModelViewportOptions['onTopologySelection'];
  private readonly sourceDecorationProviders: readonly SourceDecorationProvider[];
  private readonly impactHighlights: ObjectHighlight[] = [];
  private selectionHighlight: ObjectHighlight | null = null;
  private topologySelection?: TopologySelectionState;
  private topologySelectionOverlay?: THREE.Group;
  private highlightedTargetId?: string;
  private highlightedOccurrenceKeys = new Set<string>();
  private selectionEmphasized = true;
  private selectedKey = 'root';
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
      onSourcePreviewDiagnostic,
      onTopologySelection,
      sourceDecorationProviders = [],
      showCoordinateReference = true,
    }: ModelViewportOptions,
  ) {
    this.onSelect = onSelect;
    this.onSourcePreviewDiagnostic = onSourcePreviewDiagnostic;
    this.onDrillDown = onDrillDown;
    this.onNavigateSource = onNavigateSource;
    this.onTopologySelection = onTopologySelection;
    this.sourceDecorationProviders = sourceDecorationProviders;
    this.rendering = new ModelRenderer(this.container);
    this.scene = this.rendering.scene;
    this.camera = this.rendering.camera;
    this.renderer = this.rendering.renderer;
    this.scene.add(this.root, this.decorationRoot);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.target.set(0, 20, 0);
    this.controls.minDistance = 20;
    this.controls.maxDistance = 650;
    this.controls.addEventListener('change', () => this.refreshTopologyHover());
    if (showCoordinateReference) {
      this.coordinateReference = new ViewportCoordinateReference(
        this.container,
        this.camera,
      );
    }
    this.transformGizmo = new TransformGizmo(
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
    this.renderer.domElement.addEventListener('pointerleave', () => {
      this.topologyPointer = undefined;
      this.updateTopologyHover(undefined);
    });

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

    const matchingContextIndex = preferredContextId
      ? match.evaluations.findIndex(
          evaluation => evaluation.contextId === preferredContextId,
        )
      : -1;
    const retainedEvaluationIndex =
      this.renderedViewTarget.kind === 'source' &&
      this.renderedViewTarget.targetId === match.id
        ? this.renderedViewTarget.evaluationIndex
        : -1;
    const preferredEvaluationIndex =
      matchingContextIndex >= 0
        ? matchingContextIndex
        : retainedEvaluationIndex >= 0
          ? retainedEvaluationIndex
          : 0;
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

  previewCompletion(
    target: SourceTarget,
    evaluationIndex: number,
    memberName: string,
  ): boolean {
    const evaluation = target.evaluations[evaluationIndex];
    if (!this.module || !evaluation) return false;
    const receiverNodeId =
      evaluation.focusNodeIds?.[0] ??
      evaluation.nodeIds.find(nodeId => this.module?.objects.has(nodeId));
    const receiver = receiverNodeId
      ? this.module.objects.get(receiverNodeId)
      : undefined;
    if (!receiver) return false;
    const referenceName =
      evaluation.element?.name ?? evaluation.topologyReferences?.[0]?.name;
    const element = receiver.elements.find(
      candidate =>
        candidate.name ===
        (referenceName ? `${referenceName}.${memberName}` : memberName),
    );
    const previewEvaluation: SourceTargetEvaluation = {
      ...evaluation,
      topologyReferences: element?.topology
        ? [{nodeId: receiver.nodeId, name: element.name, ...element.topology}]
        : undefined,
      anchorReferences: undefined,
      element: element
        ? {
            nodeId: receiver.nodeId,
            name: element.name,
            kind: element.kind,
            transform: element.transform,
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
      [receiver.nodeId],
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

  exportScene() {
    if (!this.module || this.transientPreviewRestore) return undefined;
    return {
      module: this.module,
      instances: collectExportInstances(this.occurrences.values()),
    };
  }

  exportName(): string {
    if (!this.module) return 'code3d-model';
    const roots = [...this.occurrences.values()]
      .filter(occurrence => occurrence.object.parent === this.root)
      .map(occurrence => occurrence.node.nodeId);
    return renderedModelName(
      this.module,
      roots,
      this.sourceEvaluation()?.target.sourceRef,
    );
  }

  beginTopologySelection(
    occurrenceKey: string,
    inputNodeId: string,
    kind: TopologyKind,
    multiple: boolean,
    initialIds: readonly TopologyId[] = [],
    scope?: TopologySelectionScope,
  ): readonly TopologyId[] {
    const occurrence = this.occurrences.get(occurrenceKey);
    const input = this.module?.objects.get(
      scope?.geometryNodeId ?? inputNodeId,
    );
    if (!occurrence || !input || input.kind === 'group' || !input.mesh) {
      throw new Error('Topology selection requires a geometric model.');
    }
    const renderedIds = topologyIds(input.mesh, kind);
    const availableIds = scope
      ? renderedIds.filter(id =>
          scope.availableIds.some(available => sameTopologyId(available, id)),
        )
      : renderedIds;
    const mesh = scope
      ? restrictTopologyMesh(input.mesh, kind, new TopologyIdSet(availableIds))
      : input.mesh;
    if (availableIds.length === 0) {
      throw new Error(`The model has no selectable ${kind}s.`);
    }
    this.clearTopologySelection();
    const {guide, pickObject} = createTopologySelectionGuide(
      input,
      mesh,
      kind,
      occurrence.placement,
    );
    if (scope) {
      occurrence.object.updateWorldMatrix(true, false);
      applyTransform(guide, scope.transform);
      guide.applyMatrix4(occurrence.object.matrixWorld);
    }
    this.decorationRoot.add(guide);
    this.topologySelection = {
      kind,
      multiple,
      occurrenceKey,
      mesh,
      guide,
      pickObject,
      selectedIds: new TopologyIdSet(initialIds),
    };
    this.rebuildSelectionHighlight();
    this.updateTransformGizmo();
    this.rebuildTopologySelectionOverlay();
    this.refreshTopologyHover();
    return availableIds;
  }

  endTopologySelection(): void {
    this.clearTopologySelection();
    this.rebuildSelectionHighlight();
    this.updateTransformGizmo();
  }

  setSelectedTopologyIds(ids: readonly TopologyId[]): void {
    if (!this.topologySelection) return;
    this.topologySelection.selectedIds = new TopologyIdSet(ids);
    this.rebuildTopologySelectionOverlay();
    this.refreshTopologyHover();
  }

  hasRelativePositionContext(): boolean {
    return isRelativePositionContext(this.renderedSourceScope()?.target);
  }

  setParameterPreview(targetId: string, value: number): void {
    this.parameterPreviews.set(targetId, value);
    if (this.highlightedTargetId !== targetId) {
      this.highlightedTargetId = targetId;
      this.rebuildImpactHighlights();
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
      this.rebuildImpactHighlights();
    }
    this.applyPreviewTransforms();
  }

  commitParameterPreview(targetId: string, value: number): void {
    this.committedParameterPreviews.set(targetId, value);
    this.parameterPreviews.set(targetId, value);
    this.transformGizmo.commitParameterValue(targetId, value);
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
    this.rebuildImpactHighlights();
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
    this.rebuildImpactHighlights();
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

  setSpatialPreview(objects: readonly SpatialObjectPreview[]): void {
    for (const preview of objects) {
      const previous = this.committedSpatialPreviews.get(preview.key);
      this.spatialPreviews.set(preview.key, {
        ...preview,
        transform: previous
          ? composeTransforms(preview.transform, previous.transform)
          : preview.transform,
      });
    }
    this.highlightedOccurrenceKeys = new Set(objects.map(object => object.key));
    this.rebuildImpactHighlights();
    this.applyPreviewTransforms();
  }

  clearSpatialPreview(objects: readonly SpatialObjectPreview[]): void {
    for (const {key} of objects) {
      const committed = this.committedSpatialPreviews.get(key);
      if (committed) this.spatialPreviews.set(key, committed);
      else this.spatialPreviews.delete(key);
    }
    this.highlightedOccurrenceKeys.clear();
    this.rebuildImpactHighlights();
    this.applyPreviewTransforms();
  }

  commitSpatialPreview(
    objects: readonly SpatialObjectPreview[],
    parameter?: Readonly<{id: string; value: number}>,
  ): void {
    this.setSpatialPreview(objects);
    for (const {key} of objects)
      this.committedSpatialPreviews.set(key, this.spatialPreviews.get(key)!);
    if (parameter)
      this.spatialParameterValues.set(parameter.id, parameter.value);
    this.updateTransformGizmo();
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
      if (
        (decoration.kind === 'mesh' || decoration.kind === 'edges') &&
        !decoration.nodeId
      ) {
        const object =
          decoration.kind === 'mesh'
            ? createMeshDecorationObject(decoration)
            : createEdgeDecorationObject(decoration);
        this.decorationRoot.add(object);
        return [{object}];
      }
      return this.renderedOccurrences()
        .filter(
          occurrence =>
            occurrence.node.nodeId === decoration.nodeId &&
            (!occurrenceKeys || occurrenceKeys.has(occurrence.key)),
        )
        .map(occurrence => {
          const decorationObject =
            decoration.kind === 'mesh'
              ? createMeshDecorationObject(decoration)
              : decoration.kind === 'edges'
                ? createEdgeDecorationObject(decoration)
                : decoration.kind === 'bounds'
                  ? createBoundsDecorationObject(decoration)
                  : decoration.kind === 'surface'
                    ? createSurfaceDecorationObject(
                        decoration,
                        decoration.operationRole ?? occurrence.operationRole,
                      )
                    : new AnchorDecorationObject(decoration);
          const object = new THREE.Group();
          object.matrixAutoUpdate = false;
          object.add(decorationObject);
          this.decorationRoot.add(object);
          const instance: DecorationInstance = {
            object,
            occurrenceKey: occurrence.key,
            bounds: decoration.kind === 'bounds',
            anchor:
              decorationObject instanceof AnchorDecorationObject
                ? decorationObject
                : undefined,
            corners: decorationObject.children.find(
              (child): child is ScreenSpaceCornerLines =>
                child instanceof ScreenSpaceCornerLines,
            ),
            visibility:
              decoration.kind === 'edges' ? decoration.visibility : undefined,
          };
          this.updateDecorationTransform(instance);
          instance.corners?.update(
            this.camera,
            this.renderer.domElement.clientWidth,
            this.renderer.domElement.clientHeight,
          );
          instance.anchor?.update(
            this.camera,
            this.renderer.domElement.clientHeight,
          );
          return instance;
        });
    });
    if (instances.length > 0) this.decorationLayers.set(owner, instances);
    this.updateDecorationVisibilities();
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
    this.updateDecorationVisibilities();
  }

  setSourceDecorationVisible(providerId: string, visible: boolean): void {
    const owner = sourceDecorationOwner(providerId);
    if (!visible) {
      this.clearDecorations(owner);
      return;
    }
    const scope = this.renderedSourceScope();
    if (!this.module || !scope) return;
    const provider = this.sourceDecorationProviders.find(
      candidate => candidate.id === providerId,
    )!;
    this.setDecorations(
      owner,
      provider.decorations({
        module: this.module,
        target: scope.target,
        evaluation: scope.evaluation,
      }),
    );
  }

  hideSourceDecorationsDuringPreview(): void {
    this.sourceDecorationProviders
      .filter(provider => provider.previewBehavior === 'hide')
      .forEach(provider => this.setSourceDecorationVisible(provider.id, false));
  }

  restoreSourceDecorations(): void {
    const scope = this.renderedSourceScope();
    if (this.module && scope) {
      this.renderSourceDecorations(this.module, scope.target, scope.evaluation);
    }
  }

  cancelPositionTool(): boolean {
    return this.transformGizmo.cancel();
  }

  fit(target: THREE.Object3D = this.root): void {
    this.frame(target, true);
    this.hasFramedView = true;
  }

  captureImage(width: number, height: number): Promise<Blob> {
    this.selectionHighlight?.update();
    this.impactHighlights.forEach(highlight => highlight.update());
    this.updateDecorationVisibilities();
    return this.rendering.captureImage(width, height, (camera, width, height) =>
      this.updateDecorationSizes(camera, width, height),
    );
  }

  private frameChangedView(target: THREE.Object3D = this.root): void {
    this.frame(target, !this.hasFramedView);
    this.hasFramedView = true;
  }

  private frame(target: THREE.Object3D, allowZoomIn: boolean): void {
    this.rendering.frame(
      target,
      allowZoomIn,
      this.controls.target,
      this.transformGizmo.framing(),
    );
    this.controls.update();
  }

  private buildObject(
    node: ModelSnapshotObject,
    key: string,
    depth: number,
    view: Occurrence['view'],
    placement: ModelPlacement,
    operationRole?: ModelOperationInputRole,
  ): THREE.Object3D {
    const object = createRenderedModelNode(node);
    object.name = node.name;
    object.userData.selectionKey = key;
    applyNodeTransform(object, node, placement);

    const occurrence = {
      key,
      node,
      object,
      depth,
      view,
      placement,
      operationRole,
    };
    this.occurrences.set(key, occurrence);

    node.children.forEach((child, index) => {
      object.add(
        this.buildObject(
          child,
          `${key}/${index}`,
          depth + 1,
          view,
          placement,
          operationRole,
        ),
      );
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
    focusNodeIds = evaluation.focusNodeIds,
  ): void {
    const relatedNodes = this.resolveNodes(evaluation.nodeIds)
      .filter(
        node =>
          !evaluation.constraintPreviewDiagnostic ||
          node.nodeId !== evaluation.constraintOwnerNodeId,
      )
      .map(node =>
        node.nodeId === evaluation.constraintPreview?.nodeId
          ? {...node, ...evaluation.constraintPreview}
          : node,
      );
    const placement = sourceTargetPlacement(evaluation);
    const focusNodes = focusNodeIds
      ? relatedNodes.filter(node => focusNodeIds.includes(node.nodeId))
      : relatedNodes;
    const relationContextNodes = focusNodeIds
      ? relatedNodes
          .filter(node => !focusNodeIds.includes(node.nodeId))
          .map(node => ({node, targetId: target.id}))
      : [];
    const contextNodes = uniqueContextNodes([
      ...relationContextNodes,
      ...this.resolveContextNodes(
        target.contextTargetIds,
        evaluation.operationId,
        evaluation.nodeIds,
      ),
    ]).filter(
      ({node}) =>
        !evaluation.constraintPreviewDiagnostic ||
        node.nodeId !== evaluation.constraintOwnerNodeId,
    );
    const layeredScene = focusNodes.length + contextNodes.length > 1;
    this.selectionEmphasized =
      focusNodeIds !== undefined || target.kind !== 'constraint';
    this.renderedViewTarget = renderedViewTarget;
    this.resetRenderedView();
    this.onSourcePreviewDiagnostic?.(evaluation.constraintPreviewDiagnostic);
    contextNodes.forEach(({node, targetId}, index) => {
      this.root.add(
        this.buildContextObject(node, `context/${index}`, targetId, placement),
      );
    });
    focusNodes.forEach((node, index) => {
      const operationRole = sourceOperationRole(
        this.module!,
        evaluation,
        node.nodeId,
      );
      const object = this.buildObject(
        node,
        `source/${index}`,
        1,
        'source',
        placement,
        operationRole,
      );
      const references =
        evaluation.topologyReferences?.filter(
          reference => reference.nodeId === node.nodeId,
        ) ?? [];
      if (
        references.length > 0 ||
        (target.kind === 'topology-selection' && !evaluation.operationId)
      ) {
        dimObject(object);
      } else if (operationRole === 'tool') {
        makeToolObjectTranslucent(object);
      } else if (layeredScene) {
        makeFocusObjectTranslucent(object);
      }
      for (const reference of references) {
        const mesh = this.module!.objects.get(reference.geometryNodeId)?.mesh;
        if (!mesh) continue;
        const kind = reference.kind === 'solid' ? 'surface' : reference.kind;
        const ids = new TopologyIdSet(
          reference.kind === 'solid'
            ? topologyIds(mesh, 'surface')
            : [reference.id],
        );
        const highlight = createTopologyHighlight(
          mesh,
          kind,
          ids,
          '#d8ff3e',
          24,
          symbolLineWidth,
        );
        if (highlight) {
          highlight.raycast = () => undefined;
          applyTransform(highlight, reference.transform);
          object.add(highlight);
        }
      }
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
      this.frameChangedView();
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
      'standalone',
    );
    this.root.add(rootObject);
    this.applyPreviewTransforms();
    this.selectKey(
      this.occurrences.has(selectedKey) ? selectedKey : 'root',
      false,
    );
    if (fitCamera) {
      this.frameChangedView();
    }
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
      .sort((left, right) => {
        const leftIsTool = left.tool !== undefined;
        const rightIsTool = right.tool !== undefined;
        if (leftIsTool !== rightIsTool) return leftIsTool ? -1 : 1;
        return (
          sourceSpan(left.sourceRef) - sourceSpan(right.sourceRef) ||
          sourceTargetPriority(left) - sourceTargetPriority(right) ||
          latestRuntimeOrder(right) - latestRuntimeOrder(left)
        );
      })[0];
  }

  private buildContextObject(
    node: ModelSnapshotObject,
    key: string,
    targetId: string,
    placement: ModelPlacement,
  ): THREE.Object3D {
    const object = createRenderedModelNode(node);
    object.name = `${node.name} (context)`;
    object.userData.context = true;
    object.userData.sourceTargetId = targetId;
    object.userData.sourceNodeId = node.nodeId;
    applyNodeTransform(object, node, placement);
    dimObject(object);
    this.contextOccurrences.set(key, {
      key,
      node,
      object,
      depth: 1,
      view: 'source',
      placement,
    });
    node.children.forEach((child, index) => {
      object.add(
        this.buildContextObject(child, `${key}/${index}`, targetId, placement),
      );
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
    this.onSourcePreviewDiagnostic?.(undefined);
    if (this.topologySelection) {
      this.clearTopologySelection();
      this.onTopologySelection({kind: 'cancel'});
    }
    this.transformGizmo.detach();
    this.coordinateReference?.setTarget(undefined);
    this.clearImpactHighlights();
    this.clearAllDecorations();
    this.disposeRoot();
    this.occurrences.clear();
    this.contextOccurrences.clear();
    this.rebuildSelectionHighlight();
    this.parameterPreviews.clear();
    this.committedParameterPreviews.clear();
    this.occurrenceTranslationPreviews.clear();
    this.committedOccurrenceTranslationPreviews.clear();
    this.spatialPreviews.clear();
    this.committedSpatialPreviews.clear();
    this.spatialParameterValues.clear();
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
    this.coordinateReference?.setTarget(occurrence.object);
    this.rebuildSelectionHighlight();
    this.rebuildImpactHighlights();
    this.updateDecorationVisibilities();
    this.updateDecorationSizes(
      this.camera,
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
    );
    this.updateTransformGizmo();
    if (notify) {
      this.onSelect(occurrence);
    }
  }

  private rebuildSelectionHighlight(): void {
    if (this.selectionHighlight) {
      this.scene.remove(this.selectionHighlight);
      this.selectionHighlight.dispose();
      this.selectionHighlight = null;
    }

    const occurrence = this.getSelected();
    if (
      !occurrence ||
      occurrence.node.mesh ||
      !this.selectionEmphasized ||
      this.topologySelection
    ) {
      return;
    }
    this.selectionHighlight = new ObjectHighlight(
      occurrence.object,
      occurrence.node,
      {
        kind: 'bounds',
        ...boundAppearance,
        lineWidth: symbolLineWidth,
        renderOrder: 20,
      },
    );
    this.scene.add(this.selectionHighlight);
  }

  private updateTransformGizmo(): void {
    const occurrence = this.getSelected();
    const scope = this.renderedSourceScope();
    if (occurrence && scope && this.module) {
      const bindings = spatialBindings(
        this.module,
        scope,
        occurrence,
        this.renderedOccurrences(),
        this.committedSpatialPreviews,
        this.spatialParameterValues,
      );
      if (bindings.length > 0) {
        this.transformGizmo.attach(occurrence.object, bindings);
        return;
      }
      if (scope.evaluation.constraintSpatial) {
        this.transformGizmo.detach();
        return;
      }
    }
    if (
      this.topologySelection ||
      !occurrence ||
      occurrence.depth === 0 ||
      !this.hasRelativePositionContext()
    ) {
      this.transformGizmo.detach();
      return;
    }
    const constraintId =
      scope?.target.kind === 'constraint'
        ? scope.evaluation.constraintId!
        : null;
    this.transformGizmo.attach(
      occurrence.object,
      positionBindings(occurrence, this.renderedOccurrences(), constraintId),
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
    for (const occurrence of this.renderedOccurrences()) {
      applyNodeTransform(
        occurrence.object,
        occurrence.node,
        occurrence.placement,
      );
      const offset = this.previewTranslationFor(occurrence);
      occurrence.object.position.x += offset[0];
      occurrence.object.position.y += offset[1];
      occurrence.object.position.z += offset[2];
      const spatial = this.spatialPreviews.get(occurrence.key);
      if (spatial) {
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(...spatial.transform.position),
          new THREE.Quaternion(...spatial.transform.quaternion),
          new THREE.Vector3(1, 1, 1),
        );
        occurrence.object.updateMatrix();
        occurrence.object.matrix
          .multiply(matrix)
          .decompose(
            occurrence.object.position,
            occurrence.object.quaternion,
            occurrence.object.scale,
          );
      }
    }
    this.root.updateMatrixWorld(true);
    this.updateDecorationTransforms();
    this.selectionHighlight?.update();
    this.impactHighlights.forEach(highlight => highlight.update());
    this.transformGizmo.updateAnchor();
  }

  private renderedOccurrences(): Occurrence[] {
    return [...this.occurrences.values(), ...this.contextOccurrences.values()];
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
      offset[0] += worldOffset.x * constraint.offsetDirection;
      offset[1] += worldOffset.y * constraint.offsetDirection;
      offset[2] += worldOffset.z * constraint.offsetDirection;
    }
    return offset;
  }

  private renderSourceDecorations(
    module: ModelModule,
    target: SourceTarget,
    evaluation: SourceTargetEvaluation,
  ): void {
    if (evaluation.constraintPreviewDiagnostic) return;
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
      blocked: this.transformGizmo.isPointerActive(),
    };
  }

  private updateSelectionGesture(event: PointerEvent): void {
    this.topologyPointer = {clientX: event.clientX, clientY: event.clientY};
    this.updateTopologyHover(this.pickTopology(event));
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
    if (this.topologySelection) {
      const id = this.pickTopology(event);
      if (id !== undefined) this.selectTopology(id);
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

  private selectTopology(id: TopologyId): void {
    const selection = this.topologySelection;
    if (!selection) return;
    if (selection.multiple && selection.selectedIds.has(id)) {
      selection.selectedIds.delete(id);
    } else {
      if (!selection.multiple) selection.selectedIds.clear();
      selection.selectedIds.add(id);
    }
    this.rebuildTopologySelectionOverlay();
    this.onTopologySelection({
      kind: 'change',
      topology: selection.kind,
      id,
      selectedIds: selectedTopologyIds(selection),
    });
  }

  private updateTopologyHover(id: TopologyId | undefined): void {
    const selection = this.topologySelection;
    if (!selection || sameTopologyId(selection.hoveredId, id)) return;
    selection.hoveredId = id;
    this.rebuildTopologySelectionOverlay();
    this.onTopologySelection({
      kind: 'hover',
      topology: selection.kind,
      id,
      selectedIds: selectedTopologyIds(selection),
    });
  }

  private refreshTopologyHover(): void {
    this.updateTopologyHover(
      this.topologyPointer
        ? this.pickTopology(this.topologyPointer)
        : undefined,
    );
  }

  private rebuildTopologySelectionOverlay(): void {
    this.clearTopologySelectionOverlay();
    const selection = this.topologySelection;
    if (!selection) return;

    const overlay = new THREE.Group();
    const selected = createTopologyHighlight(
      selection.mesh,
      selection.kind,
      new TopologyIdSet(
        [...selection.selectedIds].filter(
          id => !sameTopologyId(id, selection.hoveredId),
        ),
      ),
      '#d8ff3e',
      31,
    );
    if (selected) overlay.add(selected);
    if (selection.hoveredId !== undefined) {
      const hovered = createTopologyHighlight(
        selection.mesh,
        selection.kind,
        new TopologyIdSet([selection.hoveredId]),
        selection.selectedIds.has(selection.hoveredId) ? '#ffad66' : '#63dcff',
        33,
      );
      if (hovered) overlay.add(hovered);
    }
    selection.guide.add(overlay);
    this.topologySelectionOverlay = overlay;
  }

  private clearTopologySelection(): void {
    this.clearTopologySelectionOverlay();
    if (this.topologySelection) {
      this.topologySelection.guide.removeFromParent();
      disposeObject(this.topologySelection.guide);
    }
    this.topologySelection = undefined;
  }

  private clearTopologySelectionOverlay(): void {
    if (!this.topologySelectionOverlay) return;
    this.topologySelectionOverlay.removeFromParent();
    disposeObject(this.topologySelectionOverlay);
    this.topologySelectionOverlay = undefined;
  }

  private pickTopology(
    event: Readonly<{clientX: number; clientY: number}>,
  ): TopologyId | undefined {
    const selection = this.topologySelection;
    if (!selection) return undefined;
    selection.guide.updateWorldMatrix(true, false);
    if (selection.kind !== 'surface') {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const localToClip = new THREE.Matrix4()
        .multiplyMatrices(
          this.camera.projectionMatrix,
          this.camera.matrixWorldInverse,
        )
        .multiply(selection.guide.matrixWorld);
      return pickScreenTopology(
        selection.mesh,
        selection.kind,
        localToClip,
        {x: event.clientX - rect.left, y: event.clientY - rect.top},
        rect,
      );
    }
    this.prepareRaycaster(event);
    selection.pickObject!.updateWorldMatrix(true, false);
    const hits = this.raycaster.intersectObject(selection.pickObject!);
    for (const hit of hits) {
      const id = surfaceIdFromIntersection(hit);
      if (id !== undefined) return id;
    }
    return undefined;
  }

  private prepareRaycaster(
    event: Readonly<{clientX: number; clientY: number}>,
  ): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickTargets(event: PointerEvent): readonly ViewportPickTarget[] {
    if (this.renderedViewTarget.kind === 'completion') return [];
    this.prepareRaycaster(event);

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
    this.rendering.resize();
    this.refreshTopologyHover();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.coordinateReference?.update();
    this.rendering.renderFrame(() => {
      this.selectionHighlight?.update();
      this.impactHighlights.forEach(highlight => highlight.update());
      this.updateDecorationVisibilities();
      this.updateDecorationSizes(
        this.camera,
        this.renderer.domElement.clientWidth,
        this.renderer.domElement.clientHeight,
      );
    });
  };

  private rebuildImpactHighlights(): void {
    this.clearImpactHighlights();
    if (
      !this.highlightedTargetId &&
      this.highlightedOccurrenceKeys.size === 0
    ) {
      return;
    }
    for (const occurrence of this.renderedOccurrences()) {
      if (
        occurrence.key === this.selectedKey ||
        (!this.highlightedOccurrenceKeys.has(occurrence.key) &&
          !occurrence.node.parameters.some(
            parameter => parameter.target.id === this.highlightedTargetId,
          ))
      ) {
        continue;
      }
      const highlight = new ObjectHighlight(
        occurrence.object,
        occurrence.node,
        {
          kind: 'geometry',
          color: '#8ea2ff',
          opacity: 0.72,
          lineWidth: symbolLineWidth,
          pointSize: topologyPointSize,
          surfaceOpacity: impactSurfaceOpacity,
          renderOrder: 19,
        },
      );
      this.impactHighlights.push(highlight);
      this.scene.add(highlight);
    }
  }

  private clearImpactHighlights(): void {
    for (const highlight of this.impactHighlights) {
      this.scene.remove(highlight);
      highlight.dispose();
    }
    this.impactHighlights.length = 0;
  }

  private updateDecorationTransforms(): void {
    for (const instances of this.decorationLayers.values()) {
      instances.forEach(instance => this.updateDecorationTransform(instance));
    }
  }

  private updateDecorationSizes(
    camera: THREE.Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (viewportHeight === 0) return;
    camera.updateWorldMatrix(true, false);
    this.transformGizmo.updateScreenSize(viewportHeight);
    this.selectionHighlight?.updateScreenSize(
      camera,
      viewportWidth,
      viewportHeight,
    );
    this.impactHighlights.forEach(highlight =>
      highlight.updateScreenSize(camera, viewportWidth, viewportHeight),
    );
    for (const instances of this.decorationLayers.values()) {
      for (const instance of instances) {
        instance.anchor?.update(camera, viewportHeight);
        instance.corners?.update(camera, viewportWidth, viewportHeight);
      }
    }
  }

  private updateDecorationVisibilities(): void {
    const boundsKeys = new Set<string>();
    const boundsTargets = new Set<THREE.Object3D>();
    for (const instances of this.decorationLayers.values()) {
      for (const instance of instances) {
        if (!instance.bounds || !instance.occurrenceKey) continue;
        boundsKeys.add(instance.occurrenceKey);
        const occurrence =
          this.occurrences.get(instance.occurrenceKey) ??
          this.contextOccurrences.get(instance.occurrenceKey);
        if (occurrence) boundsTargets.add(occurrence.object);
      }
    }
    this.selectionHighlight?.overrideBoundsFor(boundsTargets);
    this.impactHighlights.forEach(highlight =>
      highlight.overrideBoundsFor(boundsTargets),
    );
    for (const instances of this.decorationLayers.values()) {
      instances.forEach(instance =>
        this.updateDecorationVisibility(instance, boundsKeys),
      );
    }
  }

  private updateDecorationVisibility(
    instance: DecorationInstance,
    boundsKeys: ReadonlySet<string>,
  ): void {
    if (
      instance.visibility !== 'without-object-bounds' ||
      !instance.occurrenceKey
    )
      return;
    const occurrence =
      this.occurrences.get(instance.occurrenceKey) ??
      this.contextOccurrences.get(instance.occurrenceKey);
    if (!occurrence) return;
    instance.object.visible = !(
      boundsKeys.has(instance.occurrenceKey) ||
      this.selectionHighlight?.showsBoundsFor(occurrence.object) ||
      this.impactHighlights.some(highlight =>
        highlight.showsBoundsFor(occurrence.object),
      )
    );
  }

  private updateDecorationTransform(instance: DecorationInstance): void {
    if (!instance.occurrenceKey) return;
    const occurrence =
      this.occurrences.get(instance.occurrenceKey) ??
      this.contextOccurrences.get(instance.occurrenceKey);
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

export function positionBindings(
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
  constraintId: string | null,
): TransformGizmoBinding[] {
  const constraint =
    constraintId === null
      ? occurrence.node.constraints.at(-1)
      : occurrence.node.constraints.find(
          candidate => candidate.id === constraintId,
        );
  if (!constraint || !canPreviewConstraintTransform(occurrence.node)) {
    return [];
  }
  const receiver = constraint.sourceRefs.at(-1);
  const parameters = editableParameterUsages(
    constraint.parameters.filter(
      ({operation, operationRef}) =>
        operation === 'offset' &&
        receiver &&
        sameSource(operationRef, receiver),
    ),
  );
  const modelParameters = occurrences.flatMap(({node}) => node.parameters);
  const safeTargets = positionOnlyTargets(modelParameters);
  const byTarget = new Map<
    string,
    {
      target: ParameterUsage['target'];
      sensitivities: Map<TransformAxis, number>;
    }
  >();
  for (const parameter of parameters) {
    if (!safeTargets.has(parameter.target.id)) {
      continue;
    }
    const axis = positionAxis(parameter.argument);
    if (!axis || !Number.isFinite(parameter.sensitivity)) {
      continue;
    }
    const aggregate = byTarget.get(parameter.target.id) ?? {
      target: parameter.target,
      sensitivities: new Map<TransformAxis, number>(),
    };
    aggregate.sensitivities.set(
      axis,
      (aggregate.sensitivities.get(axis) ?? 0) + parameter.sensitivity,
    );
    byTarget.set(parameter.target.id, aggregate);
  }

  const candidates = new Map<TransformAxis, TransformGizmoBinding[]>();
  for (const {target, sensitivities} of byTarget.values()) {
    const effective = [...sensitivities].filter(
      ([, sensitivity]) => Math.abs(sensitivity) > 1e-9,
    );
    if (effective.length !== 1) {
      continue;
    }
    const [axis, sensitivity] = effective[0];
    const binding: TransformGizmoBinding = {
      kind: 'parameter',
      mode: 'translate',
      anchor: 'bounds',
      axis,
      target,
      label: target.label,
      value: target.value,
      sensitivity: sensitivity * constraint.offsetDirection,
      parameterKind: target.kind,
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
        mode: 'translate',
        anchor: 'bounds',
        axis,
        label: `Δ${axis.toUpperCase()}`,
        value: 0,
        sensitivity: constraint.offsetDirection,
        parameterKind: 'length',
        step: 0.5,
        frame: constraint.offsetFrame,
        receiver: {sourceRef: receiver},
        occurrenceKeys,
      },
    ];
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

function latestRuntimeOrder(target: SourceTarget): number {
  return target.evaluations[0]?.runtime.order ?? -1;
}

function sourceTargetPriority(target: SourceTarget): number {
  if (target.kind === 'topology-selection') return -3;
  if (target.kind === 'operation-selection') return -2;
  if (target.kind === 'tool') return -1;
  if (target.kind === 'element') return -1;
  if (target.kind === 'constraint') return 0;
  if (target.kind === 'operation-input') return 1;
  if (target.kind === 'operation-output') return 2;
  return 3;
}

export function sourceTargetPlacement(
  evaluation: SourceTargetEvaluation,
): ModelPlacement {
  return evaluation.isCollection ||
    evaluation.constraintId !== undefined ||
    isCompositionRole(evaluation.operationInput?.role)
    ? 'composition'
    : 'standalone';
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
    role === 'child' ||
    role === 'section' ||
    role === 'spine'
  );
}

function sourceOperationRole(
  module: ModelModule,
  evaluation: SourceTargetEvaluation,
  nodeId: string,
): ModelOperationInputRole | undefined {
  if (module.toolNodeIds.has(nodeId)) return 'tool';
  const input = evaluation.operationInput;
  if (!input) return undefined;
  const sourceNodeIds = evaluation.constraintOwnerNodeId
    ? [evaluation.constraintOwnerNodeId]
    : evaluation.nodeIds;
  return sourceNodeIds.includes(nodeId) ? input.role : undefined;
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

function positionAxis(argument: string): TransformAxis | undefined {
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

export function restrictTopologyMesh(
  mesh: RenderMesh,
  kind: TopologyKind,
  ids: TopologyIdSet,
): RenderMesh {
  if (kind === 'vertex') {
    const indices = mesh.vertexIds.flatMap((id, index) =>
      ids.has(id) ? [index] : [],
    );
    return {
      ...mesh,
      vertexIds: indices.map(index => mesh.vertexIds[index]),
      topologyVertices: new Float32Array(
        indices.flatMap(index => [
          ...mesh.topologyVertices.slice(index * 3, index * 3 + 3),
        ]),
      ),
    };
  }
  if (kind === 'edge') {
    const groups = mesh.edgeGroups.filter(group => ids.has(group.edgeId));
    const positions: number[] = [];
    const edgeGroups = groups.map(group => {
      const start = positions.length / 3;
      for (const coordinate of mesh.edges.subarray(
        group.start * 3,
        (group.start + group.count) * 3,
      ))
        positions.push(coordinate);
      return {...group, start};
    });
    return {...mesh, edges: new Float32Array(positions), edgeGroups};
  }
  const groups = mesh.surfaceGroups.filter(group => ids.has(group.surfaceId));
  const indices: number[] = [];
  const surfaceGroups = groups.map(group => {
    const start = indices.length;
    for (const index of mesh.triangles.subarray(
      group.start,
      group.start + group.count,
    ))
      indices.push(index);
    return {...group, start};
  });
  return {...mesh, triangles: new Uint32Array(indices), surfaceGroups};
}

function createTopologySelectionGuide(
  node: ModelSnapshotObject,
  mesh: RenderMesh,
  kind: TopologyKind,
  placement: ModelPlacement,
): Readonly<{guide: THREE.Group; pickObject?: THREE.Mesh}> {
  const guide = new THREE.Group();
  guide.name = `${node.name} (selectable ${kind}s)`;
  applyNodeTransform(guide, node, placement);
  if (kind === 'vertex') {
    if (mesh.topologyVertices.length === 0) {
      throw new Error('The model has no renderable vertices.');
    }
    guide.add(
      createScreenSpacePoints(
        mesh.topologyVertices,
        '#aeb7a8',
        topologyPointSize,
        0.72,
        false,
        27,
      ),
    );
    return {guide};
  }
  if (kind === 'surface') {
    const pickObject = new THREE.Mesh(
      createSurfaceGeometry(mesh),
      new THREE.MeshBasicMaterial({visible: false, side: THREE.DoubleSide}),
    );
    pickObject.userData.surfaceGroups = mesh.surfaceGroups;
    guide.add(pickObject);
    return {guide, pickObject};
  }

  guide.add(
    createScreenSpaceEdgeLines(
      mesh.edges,
      '#aeb7a8',
      interactiveLineWidth,
      0.58,
      false,
      27,
    ),
  );
  return {guide};
}

function createMeshDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'mesh'}>,
): THREE.Object3D {
  const container = createDecoratedMesh(
    decoration.id,
    decoration.mesh,
    decoration.appearance,
    decoration.operationRole,
  );
  container.userData.decoration = decoration;
  applyTransform(container, decoration.transform);
  return container;
}

function createEdgeDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'edges'}>,
): THREE.Object3D {
  const container = new THREE.Group();
  container.name = decoration.id;
  container.userData.decoration = decoration;
  const positions = decoration.edgeIds
    ? edgeSelectionPositions(
        decoration.mesh,
        new TopologyIdSet(decoration.edgeIds),
      )
    : decoration.mesh.edges;
  if (positions && positions.length > 0) {
    const {appearance} = decoration;
    container.add(
      decoration.corners
        ? new ScreenSpaceCornerLines(
            positions,
            appearance.color,
            symbolLineWidth,
            appearance.opacity,
            appearance.depthTest,
            7,
          )
        : createScreenSpaceEdgeLines(
            positions,
            appearance.color,
            symbolLineWidth,
            appearance.opacity,
            appearance.depthTest,
            7,
          ),
    );
  }

  applyTransform(container, decoration.transform);
  return container;
}

function createBoundsDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'bounds'}>,
): THREE.Object3D {
  const container = new THREE.Group();
  container.name = decoration.id;
  container.userData.decoration = decoration;
  const positions = new Float32Array(12 * 2 * 3);
  const [x, y, z] = decoration.size;
  const count = writeBoxEdges(
    positions,
    [-x / 2, -y / 2, -z / 2],
    [x / 2, y / 2, z / 2],
  );
  if (count > 0) {
    const {appearance} = decoration;
    const lines = new ScreenSpaceCornerLines(
      positions,
      appearance.color,
      symbolLineWidth,
      appearance.opacity,
      appearance.depthTest,
      20,
    );
    lines.geometry.instanceCount = count * 2;
    container.add(lines);
  }
  applyTransform(container, decoration.transform);
  return container;
}

function createSurfaceDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'surface'}>,
  operationRole?: ModelOperationInputRole,
): THREE.Object3D {
  const container = createDecoratedMesh(
    decoration.id,
    decoration.mesh,
    decoration.appearance,
    operationRole,
  );
  container.userData.decoration = decoration;
  return container;
}

function createDecoratedMesh(
  id: string,
  mesh: RenderMesh,
  appearance: ViewportDecoration['appearance'],
  operationRole?: ModelOperationInputRole,
): THREE.Object3D {
  const container = new THREE.Group();
  container.name = id;

  const depthBias = appearance.depthBias ?? 0;
  const opacity =
    operationRole === 'tool'
      ? Math.min(appearance.opacity ?? 1, toolSurfaceOpacity)
      : (appearance.opacity ?? 1);
  const materialOptions = {
    color: appearance.color,
    transparent: opacity < 1,
    opacity,
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
          toneMapped: false,
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

  if (mesh.edges.length > 0 && appearance.edgeColor) {
    container.add(
      createScreenSpaceEdgeLines(
        mesh.edges,
        appearance.edgeColor,
        symbolLineWidth,
        appearance.edgeOpacity,
        appearance.depthTest,
        5,
      ),
    );
  }
  return container;
}

function createScreenSpacePoints(
  positions: Float32Array,
  color: string,
  size: number,
  opacity = 1,
  depthTest = true,
  renderOrder = 0,
): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: false,
      // Keep opaque highlights after translucent guides in the same render queue.
      transparent: true,
      opacity,
      depthTest,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  points.renderOrder = renderOrder;
  return points;
}

function createObjectGeometryHighlight(
  node: ModelSnapshotObject,
  appearance: Extract<ObjectHighlightAppearance, {kind: 'geometry'}>,
): THREE.Object3D | undefined {
  const {mesh} = node;
  if (!mesh) return undefined;

  const highlight = new THREE.Group();
  if (node.kind === 'vertex') {
    if (mesh.topologyVertices.length > 0) {
      highlight.add(
        createScreenSpacePoints(
          mesh.topologyVertices,
          appearance.color,
          appearance.pointSize,
          appearance.opacity,
          false,
          appearance.renderOrder,
        ),
      );
    }
  } else {
    if (
      (node.kind === 'solid' || node.kind === 'face') &&
      mesh.triangles.length > 0
    ) {
      const surface = new THREE.Mesh(
        createSurfaceGeometry(mesh),
        new THREE.MeshBasicMaterial({
          color: appearance.color,
          transparent: true,
          opacity: appearance.surfaceOpacity,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      surface.renderOrder = appearance.renderOrder;
      highlight.add(surface);
    }
    if (mesh.edges.length > 0) {
      highlight.add(
        createScreenSpaceEdgeLines(
          mesh.edges,
          appearance.color,
          appearance.lineWidth,
          appearance.opacity,
          node.kind === 'solid' || node.kind === 'face',
          appearance.renderOrder + 1,
        ),
      );
    }
  }
  return highlight.children.length > 0 ? highlight : undefined;
}

function vertexSelectionPositions(
  mesh: RenderMesh,
  vertexIds: TopologyIdSet,
): Float32Array | undefined {
  const positions: number[] = [];
  mesh.vertexIds.forEach((vertexId, index) => {
    if (!vertexIds.has(vertexId)) return;
    const offset = index * 3;
    positions.push(
      mesh.topologyVertices[offset],
      mesh.topologyVertices[offset + 1],
      mesh.topologyVertices[offset + 2],
    );
  });
  return positions.length > 0 ? new Float32Array(positions) : undefined;
}

function edgeSelectionPositions(
  mesh: RenderMesh,
  edgeIds: TopologyIdSet,
): Float32Array | undefined {
  const groups = mesh.edgeGroups.filter(group => edgeIds.has(group.edgeId));
  const coordinateCount = groups.reduce(
    (count, group) => count + group.count * 3,
    0,
  );
  if (coordinateCount === 0) return undefined;
  const positions = new Float32Array(coordinateCount);
  let offset = 0;
  groups.forEach(group => {
    const coordinates = mesh.edges.subarray(
      group.start * 3,
      (group.start + group.count) * 3,
    );
    positions.set(coordinates, offset);
    offset += coordinates.length;
  });
  return positions;
}

function createTopologyHighlight(
  mesh: RenderMesh,
  kind: TopologyKind,
  ids: TopologyIdSet,
  color: string,
  renderOrder: number,
  lineWidth = interactiveLineWidth,
): THREE.Object3D | undefined {
  if (kind === 'vertex') {
    const positions = vertexSelectionPositions(mesh, ids);
    return positions
      ? createScreenSpacePoints(
          positions,
          color,
          topologyPointSize,
          1,
          false,
          renderOrder,
        )
      : undefined;
  }
  if (kind === 'edge') {
    const positions = edgeSelectionPositions(mesh, ids);
    return positions
      ? createScreenSpaceEdgeLines(
          positions,
          color,
          lineWidth,
          1,
          false,
          renderOrder,
        )
      : undefined;
  }
  const groups = mesh.surfaceGroups.filter(group => ids.has(group.surfaceId));
  if (groups.length === 0) return undefined;
  const triangles = new Uint32Array(
    groups.flatMap(group => [
      ...mesh.triangles.slice(group.start, group.start + group.count),
    ]),
  );
  const surface = new THREE.Mesh(
    createSurfaceGeometry({
      vertices: mesh.vertices,
      normals: mesh.normals,
      triangles,
      edges: new Float32Array(),
      topologyVertices: new Float32Array(),
      vertexIds: [],
      surfaceGroups: [],
      edgeGroups: [],
    }),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.52,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  surface.renderOrder = renderOrder;
  return surface;
}

function topologyIds(mesh: RenderMesh, kind: TopologyKind): TopologyId[] {
  const ids =
    kind === 'vertex'
      ? mesh.vertexIds
      : kind === 'edge'
        ? mesh.edgeGroups.map(group => group.edgeId)
        : mesh.surfaceGroups.map(group => group.surfaceId);
  return [...new TopologyIdSet(ids)].sort(compareTopologyIds);
}

function selectedTopologyIds(selection: TopologySelectionState): TopologyId[] {
  return [...selection.selectedIds].sort(compareTopologyIds);
}

function surfaceIdFromIntersection(
  hit: THREE.Intersection,
): TopologyId | undefined {
  if (hit.faceIndex == null) return undefined;
  const groups = hit.object.userData.surfaceGroups as
    RenderMesh['surfaceGroups'] | undefined;
  const triangleStart = hit.faceIndex * 3;
  return groups?.find(
    group =>
      group.start <= triangleStart && triangleStart < group.start + group.count,
  )?.surfaceId;
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
          material.transparent = true;
          material.opacity = 0.28;
          material.depthWrite = false;
        }
      });
      child.renderOrder = -1;
    }
  });
}

function makeToolObjectTranslucent(object: THREE.Object3D): void {
  makeObjectSurfacesTranslucent(object, toolSurfaceOpacity);
}

function makeFocusObjectTranslucent(object: THREE.Object3D): void {
  makeObjectSurfacesTranslucent(object, 0.82);
}

function makeObjectSurfacesTranslucent(
  object: THREE.Object3D,
  opacity: number,
): void {
  object.traverse(child => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.transparent = true;
          material.opacity = Math.min(material.opacity, opacity);
          material.depthWrite = false;
        }
      });
    }
  });
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
