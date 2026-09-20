import {MeasurementDecorationObject} from './rendering/measurement-decoration';
import type {
  InspectionItem,
  InspectionSnapshot,
} from './model/inspection-snapshot';
import type {CompiledSketch} from './model/sketch-trace';
import {previewElementDecorations} from './model/element-decorations';
import {committedSpatialObject} from './tools/spatial-edit';
import {isCompositionInputRole} from './model/operation-context';
import * as THREE from 'three';
import {
  action,
  computed,
  makeObservable,
  observableRef,
  observableShallow,
  reaction,
  runInAction,
} from 'mobx';
import {orientImageCamera, type ImageView} from './rendering/image-camera';
import {ViewportNavigation, type CameraPose} from './ui/viewport-navigation';
import type {ViewCamera} from './rendering/view-camera';
import {ViewportScenes, type ViewportScene} from './model/viewport-scene';
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
  createRenderedSketch,
  createSurfaceGeometry,
  disposeObject,
  modelingHelper,
  type ModelPlacement,
  type ModelRenderMode,
} from './rendering/model-renderer';
import {
  RenderScenePreference,
  type RenderScenePreset,
} from './rendering/render-scene';
import {
  TransformGizmo,
  bindingTool,
  type SpatialTool,
  type TransformGizmoBinding,
  type TransformGizmoEvent,
} from './tools/transform-gizmo';
import type {
  SourceDecorationProvider,
  ViewportDecoration,
} from './viewport-decoration';
import {parameterSourceDecoration} from './model/parameter-decorations';
import {previewSpatialReference} from './model/origin-decorations';
import {sourceParameterAt} from './model/tool-arguments';
import {
  contextualToolCallId,
  contextualToolScope,
  modelSpatialSourceRef,
} from './tools/contextual-tool-context';
import type {ToolParameterSchema} from './model/tool-schema';
import {representativeDimensionEdge} from './rendering/parameter-dimension';
import {
  continuedSpatialBindings,
  modelInsertionBindings,
  spatialBindings,
  transformationBindings,
  rotationReferenceBindings,
} from './tools/model-spatial-tool';
import type {SpatialObjectPreview, SpatialPreview} from './tools/spatial-edit';
import {ViewportCoordinateReference} from './ui/viewport-coordinate-reference';
import {pickScreenTopology} from './rendering/topology-picking';
import {boundAppearance} from './rendering/bound-appearance';
import {decorationRenderOrder} from './rendering/source-appearance';
import {
  applySourceEmphasis,
  type SourceEmphasis,
} from './rendering/source-appearance';
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
  /** Passive annotations keep the retained snapshot identity; tools use node's source identity. */
  renderedNodeId?: string;
  sketchId?: string;
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

type RenderedViewTarget =
  | SelectedViewTarget
  | Readonly<{kind: 'completion' | 'retained' | 'unfocused'}>;

type TransientPreviewRestore = Readonly<{
  module: ModelModule;
  inspection?: InspectionSnapshot;
  inspectionSource?: SourceViewSelection;
  target: SelectedViewTarget;
  selectedKey: string;
  pose: CameraPose;
  mode: ModelRenderMode;
}>;

type ViewportState = Readonly<{
  pose: CameraPose;
  mode: ModelRenderMode;
  savedAt: number;
}>;

type SourceViewSelection = Readonly<{
  file: string;
  offset: number;
  contextId?: string;
  /** The resolved target identity when an offset is shared by multiple targets. */
  sourceRef?: SourceRef;
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
  occurrenceKey: string;
  frame: 'geometry' | 'operation';
  anchor?: AnchorDecorationObject;
  measurement?: MeasurementDecorationObject;
  corners?: ScreenSpaceCornerLines;
  bounds?: boolean;
  visibility?: 'without-object-bounds' | 'without-topology-selection';
}>;

export type ModelViewportOptions = Readonly<{
  onViewChange?: () => void;
  onSelect: (occurrence: Occurrence) => void;
  onDrillDown: (node: ModelSnapshotObject) => void;
  onNavigateSource: (sourceRef: SourceRef, contextId?: string) => void;
  onPositionTool: (event: TransformGizmoEvent) => void;
  canEditPosition?: (binding: TransformGizmoBinding) => boolean;
  onTopologySelection: (event: TopologySelectionEvent) => void;
  sourceDecorationProviders?: readonly SourceDecorationProvider[];
  showCoordinateReference?: boolean;
  animateViewChanges?: boolean;
  isViewVisible?: () => boolean;
  renderScene?: RenderScenePreference;
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
  positionTool: boolean;
  kind: TopologyKind;
  multiple: boolean;
  occurrenceKey: string;
  mesh: RenderMesh;
  guide: THREE.Group;
  /** Candidate geometry expressed in the displayed occurrence's local frame. */
  localTransform: THREE.Matrix4;
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
      // Directional faces already carry Core's exact local geometry bounds.
      // Reusing them avoids both tessellation error and inflated world AABBs
      // from rotated child boxes; the instance matrix is applied in update().
      const up = node.elements.find(element => element.name === 'up');
      const down = node.elements.find(element => element.name === 'down');
      if (!up?.bound || !down?.bound) return;
      const [x, y, z] = up.transform.position;
      const [width, depth] = up.bound.size;
      const boundsPositions = new Float32Array(12 * 2 * 3);
      const edges = writeBoxEdges(
        boundsPositions,
        [x - width / 2, down.transform.position[1], z - depth / 2],
        [x + width / 2, y, z + depth / 2],
      );
      const lines = new ScreenSpaceCornerLines(
        boundsPositions,
        appearance.color,
        appearance.lineWidth,
        appearance.opacity,
        false,
        appearance.renderOrder,
      );
      lines.geometry.instanceCount = edges * 2;
      this.corners = lines;
      this.add(lines);
    }
    this.frustumCulled = false;
    this.matrixAutoUpdate = false;
    this.update();
  }

  update(): void {
    this.target.updateWorldMatrix(true, false);
    this.matrix.copy(this.target.matrixWorld);
    this.matrixWorldNeedsUpdate = true;
    this.visible = !this.corners || !this.boundsOverridden;
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
  private get camera(): ViewCamera {
    return this.rendering.camera;
  }
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: ViewportNavigation;
  private readonly coordinateReference?: ViewportCoordinateReference;
  private liveGridStep = 1;
  private awaitingToolUpdate = false;
  private pendingSpatialTool?: {
    key: string;
    targetId?: string;
    bindings: readonly TransformGizmoBinding[];
  };
  private readonly animateViewChanges: boolean;
  private readonly isViewVisible: () => boolean;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly root = new THREE.Group();
  private readonly decorationRoot = modelingHelper(new THREE.Group());
  private readonly occurrences = new Map<string, Occurrence>();
  private readonly contextOccurrences = new Map<string, Occurrence>();
  private readonly parameterPreviews = new Map<string, number>();
  private sourceParameter?: Readonly<{
    targetId: string;
    parameter: ToolParameterSchema;
  }>;
  private readonly committedParameterPreviews = new Map<string, number>();
  private hasFramedView = false;
  private scenes?: ViewportScenes;
  private activeScene?: ViewportScene;
  private readonly viewStates = new Map<string, ViewportState>();
  private stateRevision = 0;
  private readonly decorationLayers = new Map<string, DecorationInstance[]>();
  private readonly transformGizmo: TransformGizmo;
  private readonly spatialPreviews = new Map<string, SpatialObjectPreview>();
  private readonly committedSpatialPreviews = new Map<
    string,
    SpatialObjectPreview
  >();
  private readonly hiddenSourceDecorations = new Set<string>();
  private readonly spatialParameterValues = new Map<string, number>();
  private readonly onSelect: ModelViewportOptions['onSelect'];
  private readonly onViewChange: ModelViewportOptions['onViewChange'];
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
  private inspectionScene?: InspectionSnapshot;
  private inspectionSource?: SourceViewSelection;
  private readonly measurementChoices = new Map<
    string,
    ReadonlyMap<string, number>
  >();
  private selectedViewTarget: SelectedViewTarget = {kind: 'model'};
  private renderedViewTarget: RenderedViewTarget = {kind: 'model'};
  private transientPreviewRestore?: TransientPreviewRestore;
  private selectionGesture?: SelectionGesture;
  private selectionClick?: SelectionClick;
  private pendingFrame?: number;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    {
      onSelect,
      onViewChange,
      onDrillDown,
      onNavigateSource,
      onPositionTool,
      canEditPosition,
      onTopologySelection,
      sourceDecorationProviders = [],
      showCoordinateReference = true,
      animateViewChanges = true,
      isViewVisible = () => true,
      renderScene = new RenderScenePreference(),
    }: ModelViewportOptions,
  ) {
    this.onSelect = onSelect;
    this.animateViewChanges = animateViewChanges;
    this.isViewVisible = isViewVisible;
    this.onViewChange = onViewChange;
    this.onDrillDown = onDrillDown;
    this.onNavigateSource = onNavigateSource;
    this.onTopologySelection = onTopologySelection;
    this.sourceDecorationProviders = sourceDecorationProviders;
    this.rendering = new ModelRenderer(
      this.container,
      this.requestRender,
      undefined,
      renderScene,
    );
    makeObservable<
      this,
      | 'module'
      | 'inspectionScene'
      | 'sourceParameter'
      | 'parameterPreviews'
      | 'spatialPreviews'
      | 'hiddenSourceDecorations'
      | 'renderedViewTarget'
      | 'selectedKey'
      | 'selectKey'
      | 'selectSourceTarget'
      | 'liveGridStep'
      | 'awaitingToolUpdate'
      | 'topologySelection'
      | 'clearTopologySelection'
      | 'renderModelView'
      | 'retainRenderedGeometry'
    >(this, {
      module: observableRef,
      inspectionScene: observableRef,
      renderInspection: action,
      sourceParameter: observableRef,
      parameterPreviews: observableShallow,
      spatialPreviews: observableShallow,
      hiddenSourceDecorations: observableShallow,
      setParameterPreview: action,
      clearParameterPreview: action,
      commitParameterPreview: action,
      setSpatialPreview: action,
      clearSpatialPreview: action,
      setSourceDecorationVisible: action,
      renderedViewTarget: observableRef,
      selectedKey: observableRef,
      sourceContext: computed,
      positionToolContext: computed,
      availablePositionTools: computed,
      selectSourceTarget: action,
      selectKey: action,
      restoreTransientPreview: action,
      previewCompletion: action,
      previewCompletedProject: action,
      liveGridStep: observableRef,
      awaitingToolUpdate: observableRef,
      topologySelection: observableRef,
      clearTopologySelection: action,
      renderModelView: action,
      retainRenderedGeometry: action,
      beginTopologySelection: action,
      endTopologySelection: action,
      commitSpatialPreview: action,
      awaitToolUpdate: action,
      renderModule: action,
      gridStep: computed,
      renderMode: computed,
      setRenderMode: action,
      renderScenePreset: computed,
      setRenderScenePreset: action,
    });
    this.scene = this.rendering.scene;
    this.renderer = this.rendering.renderer;
    this.scene.add(this.root, this.decorationRoot);
    this.controls = new ViewportNavigation(
      this.camera,
      this.renderer.domElement,
      camera => {
        this.rendering.camera = camera;
        this.coordinateReference?.setCamera(camera);
        this.transformGizmo.setCamera(camera);
      },
    );
    this.controls.addEventListener('change', () => {
      this.rendering.updateCameraRange(
        this.controls.focus,
        this.controls.object.position.distanceTo(this.controls.focus),
        this.root,
      );
      this.refreshTopologyHover();
      this.requestRender();
    });
    if (showCoordinateReference) {
      this.coordinateReference = new ViewportCoordinateReference(
        this.container,
        this.camera,
        {
          onSelect: (direction, up) => {
            if (this.controls.enabled)
              this.controls.setViewDirection(direction, up);
          },
          onReset: () => {
            if (!this.controls.enabled) return;
            this.controls.resetView(this.cameraFraming(this.root));
            this.hasFramedView = true;
          },
        },
      );
    }
    this.transformGizmo = new TransformGizmo(
      this.scene,
      this.camera,
      this.renderer.domElement,
      enabled => {
        this.controls.setNavigationEnabled(enabled);
      },
      this.rendering.grid,
      onPositionTool,
      () =>
        !this.awaitingToolUpdate &&
        (!this.topologySelection || this.topologySelection.positionTool),
      canEditPosition,
      () => {
        const scope = this.sourceContext;
        const occurrence = this.getSelected();
        if (!scope || !occurrence || !this.module) return;
        return JSON.stringify([
          scope.target.sourceRef.file,
          contextualToolCallId(this.module, scope.target) ?? scope.target.id,
          scope.evaluation.contextId,
          occurrence.key,
        ]);
      },
      this.requestRender,
    );
    // Source context and in-flight previews own one decoration projection. A
    // committed preview remains authoritative until the model is replaced.
    const stopSourceDecorations = reaction(
      () => ({
        module: this.module,
        scope: this.sourceContext,
        parameter: this.sourceParameter,
        spatialTool: this.transformGizmo.tool,
        spatialPreviews: [...this.spatialPreviews],
        parameterPreviews: [...this.parameterPreviews],
        hidden: new Set(this.hiddenSourceDecorations),
      }),
      ({
        module,
        scope,
        parameter,
        spatialTool,
        spatialPreviews,
        parameterPreviews,
        hidden,
      }) => {
        const previewing =
          spatialPreviews.length + parameterPreviews.length > 0;
        for (const provider of this.sourceDecorationProviders) {
          const decorations =
            module &&
            scope &&
            !scope.evaluation.relationPreviewDiagnostic &&
            !hidden.has(provider.id) &&
            !(previewing && provider.previewBehavior === 'hide')
              ? provider.decorations({
                  module,
                  target: scope.target,
                  evaluation: scope.evaluation,
                  parameter:
                    parameter?.targetId === scope.target.id
                      ? parameter.parameter
                      : undefined,
                  spatialTool,
                })
              : [];
          this.setDecorations(sourceDecorationOwner(provider.id), decorations);
        }
      },
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

    const stopRenderMode = reaction(
      () => this.renderMode,
      mode => {
        this.container.dataset.renderMode = mode;
        this.selectionGesture = undefined;
        this.selectionClick = undefined;
        this.topologyPointer = undefined;
        this.updateTopologyHover(undefined);
        this.coordinateReference?.setVisible(mode === 'modeling');
        this.updateTransformGizmo();
        this.requestRender();
      },
      {fireImmediately: true},
    );
    const resizeObserver = new ResizeObserver(() => this.resize());
    resizeObserver.observe(this.container);
    window.addEventListener(
      'pagehide',
      () => {
        this.disposed = true;
        if (this.pendingFrame !== undefined)
          cancelAnimationFrame(this.pendingFrame);
        resizeObserver.disconnect();
        stopSourceDecorations();
        stopRenderMode();
        this.transformGizmo.dispose();
        this.controls.dispose();
      },
      {once: true},
    );
    this.resize();
  }

  get renderMode(): ModelRenderMode {
    return this.rendering.mode;
  }

  get presentedModule(): ModelModule | null {
    return this.module;
  }

  /** The last live frame, unaffected by temporary image-export grid settings. */
  get gridStep(): number | undefined {
    return this.renderMode === 'modeling' ? this.liveGridStep : undefined;
  }

  setRenderMode(mode: ModelRenderMode): void {
    this.rendering.setMode(mode);
  }

  get renderScenePreset(): RenderScenePreset {
    return this.rendering.scenePreset;
  }

  setRenderScenePreset(preset: RenderScenePreset): void {
    this.rendering.setScenePreset(preset);
  }

  /** Keep stale handles unavailable until a replacement model is rendered. */
  awaitToolUpdate(): void {
    this.awaitingToolUpdate = true;
    this.pendingSpatialTool = undefined;
  }

  renderModule(
    module: ModelModule | null,
    selectedKey = 'root',
    retainOnError = false,
  ): boolean {
    this.restoreTransientPreview();
    this.inspectionScene = undefined;
    this.inspectionSource = undefined;
    this.saveViewportState();
    this.awaitingToolUpdate = false;
    this.pendingSpatialTool = undefined;
    const retainGeometry =
      retainOnError && !!this.module && !!module?.diagnostic;
    this.module = module;
    this.sourceParameter = undefined;
    this.scenes = module ? new ViewportScenes(module) : undefined;
    this.selectedViewTarget = {kind: 'model'};
    this.renderedViewTarget = {kind: 'model'};
    if (module?.fallback) {
      this.renderModelView(selectedKey);
    } else if (retainGeometry) {
      this.retainRenderedGeometry();
    } else {
      this.activeScene = undefined;
      this.resetRenderedView();
      this.onViewChange?.();
    }
    return false;
  }

  /** Publish source focus even when inspection has no replacement scene. */
  renderInspection(
    module: ModelModule,
    scene: InspectionSnapshot | undefined,
    source?: SourceViewSelection,
    selectedKey?: string,
  ): void {
    const scope =
      source &&
      this.sourceEvaluationAt(
        module,
        source.file,
        source.offset,
        source.contextId,
        source.sourceRef,
      );
    if (!scene) {
      if (this.module !== module)
        this.renderModule(module, selectedKey, this.module !== null);
      else this.retainRenderedGeometry('unfocused');
      // An incomplete call can offer tools even without a previewable result.
      this.applyInspectionSource(scope, source);
      if (scope?.target.tool) {
        const nodeId =
          scope.evaluation.relationOwnerNodeId ??
          scope.evaluation.selection?.inputNodeId;
        const node = nodeId && module.objects.get(nodeId);
        if (node) this.renderModelView('root', this.renderedViewTarget, node);
      }
      this.onViewChange?.();
      return;
    }
    this.saveViewportState();
    this.module = module;
    this.inspectionScene = scene;
    this.scenes = new ViewportScenes(module);
    this.applyInspectionSource(scope, source);
    this.renderInspectionScene(module, scene, scope, selectedKey);
  }

  private applyInspectionSource(
    scope: ModelViewport['sourceContext'],
    source: SourceViewSelection | undefined,
  ): void {
    this.inspectionSource = source;
    const parameter =
      scope &&
      source &&
      sourceParameterAt(scope.target, source.file, source.offset);
    this.sourceParameter =
      scope && parameter
        ? {
            targetId: scope.target.id,
            parameter,
          }
        : undefined;
    this.selectedViewTarget = scope
      ? {
          kind: 'source',
          targetId: scope.target.id,
          evaluationIndex: scope.evaluationIndex,
        }
      : {kind: 'model'};
    this.renderedViewTarget = scope
      ? this.selectedViewTarget
      : {kind: 'unfocused'};
    this.transientPreviewRestore = undefined;
    this.awaitingToolUpdate = false;
    this.pendingSpatialTool = undefined;
  }

  private renderInspectionScene(
    module: ModelModule,
    scene: InspectionSnapshot,
    scope: ModelViewport['sourceContext'],
    selectedKey: string | undefined,
  ): void {
    const measurementChoices = this.measurementChoices.get('inspection');
    this.resetRenderedView();
    if (measurementChoices)
      this.measurementChoices.set('inspection', measurementChoices);
    const placement = scene.collection ? 'composition' : 'standalone';
    const focused = scene.target.some(item => item.focused);
    const bodies = new Map<
      string,
      {model: ModelSnapshotObject; emphasis: SourceEmphasis; visible: boolean}
    >();
    const addBody = (
      model: ModelSnapshotObject,
      emphasis: SourceEmphasis,
      visible = true,
    ) => {
      const previous = bodies.get(model.nodeId);
      if (!previous || !previous.visible)
        bodies.set(model.nodeId, {model, emphasis, visible});
      else if (emphasis !== 'context')
        bodies.set(model.nodeId, {model, emphasis, visible: true});
    };
    for (const item of scene.ambient)
      if (item.kind === 'model') addBody(item.model, 'context');
    for (const item of scene.target)
      if (item.kind === 'model')
        addBody(item.model, item.focused || !focused ? 'primary' : 'secondary');
    const authoredNodeId = (model: ModelSnapshotObject): string => {
      while (
        !module.objects.has(model.nodeId) &&
        !model.sourceNodeId &&
        model.children.length === 1
      )
        model = model.children[0];
      return model.sourceNodeId ?? model.nodeId;
    };
    const toolFocus = new Set(
      scope?.evaluation.focusNodeIds ?? scope?.evaluation.nodeIds ?? [],
    );
    const selectable = new Set(
      scene.target.flatMap(item =>
        item.kind === 'model' || item.kind === 'anchor'
          ? [item.model.nodeId]
          : [],
      ),
    );
    // A tool may edit an ambient participant without changing its inspect tier.
    for (const item of scene.ambient)
      if (
        (item.kind === 'model' || item.kind === 'anchor') &&
        toolFocus.has(authoredNodeId(item.model))
      )
        selectable.add(item.model.nodeId);
    const decorations: ViewportDecoration[] = [];
    const referenceMarkers = new Map<string, ViewportDecoration>();
    const values = [
      ...scene.ambient.map(item => ({item, ambient: true})),
      ...scene.target.map(item => ({item, ambient: false})),
    ];
    const sketchBodies = new Map<
      string,
      {
        item: Extract<InspectionItem, {kind: 'sketch'}>;
        emphasis: SourceEmphasis;
        points: Map<number, SourceEmphasis>;
      }
    >();
    const lookup = {...module, objects: scene.objects};
    for (const [index, {item, ambient}] of values.entries()) {
      const opacity = ambient ? 0.28 : item.focused || !focused ? 1 : 0.7;
      if (item.kind === 'sketch') {
        const emphasis = ambient
          ? 'context'
          : item.focused || !focused
            ? 'primary'
            : 'secondary';
        let body = sketchBodies.get(item.sketchId);
        if (!body) {
          body = {item, emphasis: 'context', points: new Map()};
          sketchBodies.set(item.sketchId, body);
        }
        const strongest = (a: SourceEmphasis, b: SourceEmphasis) =>
          a === 'primary' || b === 'primary'
            ? 'primary'
            : a === 'secondary' || b === 'secondary'
              ? 'secondary'
              : 'context';
        if (item.pointId === undefined)
          body.emphasis = strongest(body.emphasis, emphasis);
        else
          body.points.set(
            item.pointId,
            strongest(body.points.get(item.pointId) ?? 'context', emphasis),
          );
      } else if (item.kind === 'anchor') {
        if (!bodies.has(item.model.nodeId)) addBody(item.model, 'context');
        for (const element of item.elements) {
          const markers = previewElementDecorations(
            lookup,
            item.model,
            element,
            item.direction,
          );
          for (const marker of markers) {
            // Aliases of the same placed reference share geometry. Direction
            // markers keep their own orientation; the strongest tier wins.
            const {id: _id, appearance: _appearance, ...arrow} = marker;
            const key = JSON.stringify(
              marker.kind === 'anchor'
                ? arrow
                : [
                    item.model.nodeId,
                    marker.kind,
                    element.kind,
                    element.transform,
                    element.bound,
                    element.topology,
                  ],
            );
            const appearance = {
              ...marker.appearance,
              opacity: (marker.appearance.opacity ?? 1) * opacity,
              edgeOpacity:
                marker.appearance.edgeOpacity === undefined
                  ? undefined
                  : marker.appearance.edgeOpacity * opacity,
            };
            const previous = referenceMarkers.get(key);
            if (
              !previous ||
              appearance.opacity > (previous.appearance.opacity ?? 1)
            )
              referenceMarkers.set(key, {
                ...marker,
                id:
                  previous?.id ?? `inspect:reference:${referenceMarkers.size}`,
                appearance,
              });
          }
        }
      } else if (item.kind === 'bounds') {
        if (!bodies.has(item.model.nodeId))
          addBody(item.model, 'context', false);
        decorations.push({
          kind: 'bounds',
          id: `inspect:${index}`,
          nodeId: item.model.nodeId,
          size: item.size,
          transform: {...item.frame, scale: [1, 1, 1]},
          appearance: {
            ...boundAppearance,
            opacity: boundAppearance.opacity * opacity,
          },
        });
      } else if (item.kind === 'dimension') {
        if (!bodies.has(item.model.nodeId))
          addBody(item.model, 'context', false);
        decorations.push({
          kind: 'measurement',
          id: `inspect:${index}`,
          nodeId: item.model.nodeId,
          ...('candidates' in item
            ? {candidates: item.candidates}
            : 'at' in item
              ? {at: item.at}
              : {start: item.start, end: item.end}),
          value: item.value,
          axisLabel: item.axisLabel,
          appearance: {
            color: '#c4c4c4',
            opacity: 0.92 * opacity,
            depthTest: false,
          },
        });
      }
    }
    // The current execution is fully represented by its inspection scene;
    // its inputs may have been repositioned or replaced. Only other executions
    // add loop context, staged by their own relation previews.
    const handledNodeIds = new Set([
      ...(scope?.evaluation.nodeIds ?? []),
      ...[...bodies.values()].map(({model}) => authoredNodeId(model)),
    ]);
    for (const evaluation of scope?.target.evaluations ?? []) {
      for (const nodeId of evaluation.nodeIds) {
        if (handledNodeIds.has(nodeId)) continue;
        const model = module.objects.get(nodeId);
        if (!model) continue;
        handledNodeIds.add(nodeId);
        const preview =
          evaluation.relationPreview?.nodeId === nodeId
            ? evaluation.relationPreview
            : undefined;
        const node = preview ? {...model, ...preview} : model;
        const targetId = scope!.target.id;
        const key = `context/${targetId}:${nodeId}`;
        this.root.add(
          this.buildContextObject(
            node,
            key,
            targetId,
            'composition',
            'context',
          ),
        );
      }
    }
    this.selectionEmphasized = focused;
    for (const [index, {model, emphasis, visible}] of [
      ...bodies.values(),
    ].entries()) {
      const node = visible ? model : {...model, mesh: undefined, children: []};
      const object = !selectable.has(model.nodeId)
        ? this.buildContextObject(
            node,
            `context/${index}`,
            scope?.target.id ?? '',
            placement,
            'context',
          )
        : this.buildObject(node, `source/${index}`, 1, 'source', placement);
      if (
        selectable.has(model.nodeId) &&
        (scene.kind === 'inspect' || emphasis === 'context')
      )
        applySourceEmphasis(object, emphasis);
      this.root.add(object);
    }
    const sketchNodes: ModelSnapshotObject[] = [];
    for (const [index, body] of [...sketchBodies.values()].entries()) {
      const layers: CompiledSketch[] = [];
      for (
        let sketch = scene.sketches.get(body.item.sketchId);
        sketch;
        sketch = sketch.base ? scene.sketches.get(sketch.base) : undefined
      )
        layers.unshift(sketch);
      const original = module.sketches.get(body.item.sourceSketchId);
      const node = {
        ...body.item.model,
        sourceNodeId: original?.frameNodeId,
        transform: body.item.model.compositionTransform,
      };
      const key = `sketch/${index}`;
      const object = createRenderedSketch(layers, body.emphasis, body.points);
      object.name = 'Sketch';
      applyNodeTransform(object, node);
      const occurrence: Occurrence = {
        key,
        node: this.interactionNode(node),
        renderedNodeId: node.nodeId,
        sketchId: body.item.sourceSketchId,
        object,
        depth: 1,
        view: 'source',
        placement: 'standalone',
      };
      if (body.emphasis !== 'context' || body.points.size) {
        object.userData.selectionKey = key;
        this.occurrences.set(key, occurrence);
      } else this.contextOccurrences.set(key, occurrence);
      sketchNodes.push(node);
      this.root.add(object);
    }
    this.applyPreviewTransforms();
    const toolNodeId =
      scope?.evaluation.relationOwnerNodeId ??
      (scope?.evaluation.operationId &&
        module.operations.get(scope.evaluation.operationId)?.outputNodeId);
    const toolOccurrence =
      toolNodeId &&
      [...this.occurrences.values()].find(
        value => value.node.nodeId === toolNodeId,
      );
    const focusedIds = new Set(
      scene.target.flatMap(item =>
        item.focused && item.kind !== 'sketch'
          ? [authoredNodeId(item.model)]
          : [],
      ),
    );
    const focusedOccurrence = [...this.occurrences.values()].find(value =>
      focusedIds.has(value.node.nodeId),
    );
    const parameterOccurrence = [...this.occurrences.values()].find(value =>
      toolFocus.has(value.node.nodeId),
    );
    const retained = selectedKey && this.occurrences.get(selectedKey);
    const nextKey =
      focusedOccurrence?.key ??
      parameterOccurrence?.key ??
      (retained && (!toolNodeId || retained.node.nodeId === toolNodeId)
        ? retained.key
        : toolOccurrence
          ? toolOccurrence.key
          : this.occurrences.keys().next().value);
    if (nextKey) this.selectKey(nextKey, false);
    this.activateViewportScene(
      [...bodies.values()]
        .filter(value => value.visible)
        .map(value => value.model)
        .concat(sketchNodes),
      placement,
    );
    this.setDecorations('inspection', [
      ...decorations,
      ...referenceMarkers.values(),
    ]);
    this.onViewChange?.();
  }

  hasRenderableGeometry(): boolean {
    return this.renderedOccurrences().some(({node, sketchId, object}) => {
      if (sketchId) return object.children.length > 0;
      const mesh = node.mesh;
      return (
        mesh !== undefined &&
        (mesh.triangles.length > 0 ||
          mesh.edges.length > 0 ||
          mesh.topologyVertices.length > 0)
      );
    });
  }

  /** The current semantic focus, shared by panels, handles and reference picking. */
  get sourceContext():
    | Readonly<{
        target: SourceTarget;
        evaluation: SourceTargetEvaluation;
        evaluationIndex: number;
      }>
    | undefined {
    if (!this.module || this.renderedViewTarget.kind !== 'source') return;
    const {targetId, evaluationIndex} = this.renderedViewTarget;
    const target = this.module.sourceTargets.find(
      target => target.id === targetId,
    );
    const evaluation = target?.evaluations[evaluationIndex];
    return target && evaluation
      ? {target, evaluation, evaluationIndex}
      : undefined;
  }

  /** A relate owns its toolbar even while a reference or another expression has focus. */
  get availablePositionTools(): readonly SpatialTool[] {
    const source = this.sourceContext;
    if (
      source &&
      this.module &&
      contextualToolScope(this.module, source).evaluation.relationOwnerNodeId
    )
      return ['translate', 'rotate-point', 'rotate-axis'];
    if (this.positionToolContext === 'model')
      return ['translate', 'rotate-point'];
    return this.transformGizmo.availableTools;
  }

  get positionToolContext(): 'model' | 'relation' {
    const source = this.sourceContext;
    const occurrence = this.getSelected();
    if (
      source &&
      occurrence &&
      this.module &&
      modelSpatialSourceRef(this.module, source) &&
      source.evaluation.nodeIds.includes(occurrence.node.nodeId)
    )
      return 'model';
    return 'relation';
  }

  /** Resolve a replacement snapshot with the same context choice as rendering. */
  sourceEvaluationAt(
    module: ModelModule | null,
    file: string,
    offset: number,
    preferredContextId?: string,
    preferredSource?: SourceRef,
  ): ModelViewport['sourceContext'] {
    const target = this.sourceTargetAt(file, offset, module, preferredSource);
    if (!target) return;
    const current = module === this.module ? this.sourceContext : undefined;
    const matchingInspectionIndex = current?.evaluation.inspectCallId
      ? target.evaluations.findIndex(
          evaluation =>
            evaluation.inspectCallId === current.evaluation.inspectCallId &&
            (!preferredContextId ||
              evaluation.contextId === preferredContextId),
        )
      : -1;
    const owner =
      current && module
        ? contextualToolScope(module, current).evaluation.relationOwnerNodeId
        : undefined;
    // A loop's references and self can share a contextId. Source navigation
    // retains the actual relation instance, including when focus changes sides.
    const matchingOwnerIndex =
      owner && module
        ? target.evaluations.findIndex(
            evaluation =>
              (!preferredContextId ||
                evaluation.contextId === preferredContextId) &&
              contextualToolScope(module, {target, evaluation}).evaluation
                .relationOwnerNodeId === owner,
          )
        : -1;
    const matchingContextIndex = preferredContextId
      ? target.evaluations.findIndex(
          evaluation => evaluation.contextId === preferredContextId,
        )
      : -1;
    const retainedEvaluationIndex =
      module === this.module &&
      this.selectedViewTarget.kind === 'source' &&
      this.selectedViewTarget.targetId === target.id
        ? this.selectedViewTarget.evaluationIndex
        : -1;
    const requestedEvaluationIndex =
      retainedEvaluationIndex >= 0 &&
      (this.renderedViewTarget.kind !== 'source' ||
        this.renderedViewTarget.targetId !== target.id ||
        this.renderedViewTarget.evaluationIndex !== retainedEvaluationIndex)
        ? retainedEvaluationIndex
        : -1;
    const preferredEvaluationIndex =
      requestedEvaluationIndex >= 0
        ? requestedEvaluationIndex
        : matchingInspectionIndex >= 0
          ? matchingInspectionIndex
          : matchingOwnerIndex >= 0
            ? matchingOwnerIndex
            : matchingContextIndex >= 0
              ? matchingContextIndex
              : retainedEvaluationIndex >= 0
                ? retainedEvaluationIndex
                : 0;
    const evaluationIndex = target.evaluations[preferredEvaluationIndex]
      ? preferredEvaluationIndex
      : 0;
    const evaluation = target.evaluations[evaluationIndex];
    return evaluation && {target, evaluation, evaluationIndex};
  }

  previewCompletion(
    target: SourceTarget,
    evaluationIndex: number,
    memberName: string,
  ): boolean {
    const evaluation = target.evaluations[evaluationIndex];
    if (!this.module || !evaluation) return false;
    const receiverNodeId =
      evaluation.valueNodeIds?.[0] ??
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
    this.previewCompletedProject(
      this.module,
      {
        kind: 'preview',
        target: [
          element
            ? {
                kind: 'anchor',
                model: receiver,
                elements: [element],
                focused: true,
              }
            : {kind: 'model', model: receiver, focused: true},
        ],
        ambient: [],
        objects: this.module.objects,
        sketches: this.module.sketches,
      },
      {
        file: target.sourceRef.file,
        offset: target.sourceRef.start,
        contextId: evaluation.contextId,
        sourceRef: target.sourceRef,
      },
    );
    return true;
  }

  previewCompletedProject(
    module: ModelModule,
    scene: InspectionSnapshot,
    source: SourceViewSelection,
  ): void {
    this.captureTransientPreviewRestore();
    const restore = this.transientPreviewRestore;
    this.renderInspection(module, scene, source);
    this.transientPreviewRestore = restore;
    this.renderedViewTarget = {kind: 'completion'};
  }

  restoreTransientPreview(): void {
    const restore = this.transientPreviewRestore;
    if (!restore) {
      return;
    }
    this.transientPreviewRestore = undefined;
    this.module = restore.module;
    this.scenes = new ViewportScenes(restore.module);
    this.controls.restorePose(restore.pose);
    this.setRenderMode(restore.mode);
    this.selectedViewTarget = restore.target;
    if (restore.inspection) {
      this.renderInspection(
        restore.module,
        restore.inspection,
        restore.inspectionSource,
        restore.selectedKey,
      );
      return;
    }
    this.selectedViewTarget = {kind: 'model'};
    this.renderModelView(restore.selectedKey);
  }

  getSelected(): Occurrence | undefined {
    return this.renderedViewTarget.kind === 'retained'
      ? undefined
      : this.occurrences.get(this.selectedKey);
  }

  exportScene() {
    if (
      !this.module ||
      this.transientPreviewRestore ||
      this.renderedViewTarget.kind === 'retained'
    )
      return undefined;
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
      this.sourceContext?.target.sourceRef,
    );
  }

  beginTopologySelection(
    occurrenceKey: string,
    inputNodeId: string,
    kind: TopologyKind,
    multiple: boolean,
    initialIds: readonly TopologyId[] = [],
    scope?: TopologySelectionScope,
    positionTool = false,
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
    const {guide, pickObject} = createTopologySelectionGuide(input, mesh, kind);
    if (scope) applyTransform(guide, scope.transform);
    guide.updateMatrix();
    const localTransform = guide.matrix.clone();
    guide.matrixAutoUpdate = false;
    this.decorationRoot.add(guide);
    this.topologySelection = {
      positionTool,
      kind,
      multiple,
      occurrenceKey,
      mesh,
      guide,
      localTransform,
      pickObject,
      selectedIds: new TopologyIdSet(initialIds),
    };
    this.updateTopologySelectionTransform();
    this.rebuildSelectionHighlight();
    if (!positionTool) this.updateTransformGizmo();
    this.rebuildTopologySelectionOverlay();
    this.refreshTopologyHover();
    this.updateDecorationVisibilities();
    return availableIds;
  }

  endTopologySelection(): void {
    const positionTool = this.topologySelection?.positionTool;
    this.clearTopologySelection();
    this.rebuildSelectionHighlight();
    if (!positionTool) this.updateTransformGizmo();
    this.updateDecorationVisibilities();
  }

  get selectingRotationReference(): boolean {
    return this.topologySelection?.positionTool ?? false;
  }

  setSelectedTopologyIds(ids: readonly TopologyId[]): void {
    if (!this.topologySelection) return;
    this.topologySelection.selectedIds = new TopologyIdSet(ids);
    this.rebuildTopologySelectionOverlay();
    this.refreshTopologyHover();
  }

  hasRelativePositionContext(): boolean {
    const scope = this.sourceContext;
    return (
      isRelativePositionContext(scope?.target) ||
      !!(scope?.evaluation.isCollection && scope.evaluation.focusNodeIds)
    );
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
    continuation?: SpatialPreview['continuation'],
  ): void {
    this.setSpatialPreview(objects.map(committedSpatialObject));
    for (const {key} of objects)
      this.committedSpatialPreviews.set(key, this.spatialPreviews.get(key)!);
    if (parameter)
      this.spatialParameterValues.set(parameter.id, parameter.value);
    const bindings = continuation
      ? continuedSpatialBindings(
          this.transformGizmo.currentBindings,
          continuation.binding,
          continuation.value,
          objects.map(committedSpatialObject),
        )
      : [];
    const occurrence = this.getSelected();
    if (bindings.length && occurrence) {
      this.pendingSpatialTool = {
        key: occurrence.key,
        targetId: this.sourceContext?.target.id,
        bindings,
      };
      this.awaitingToolUpdate = false;
      this.transformGizmo.attach(
        occurrence.object,
        bindings,
        this.transformGizmo.tool,
      );
    }
  }

  setDecorations(
    owner: string,
    decorations: readonly ViewportDecoration[],
    scope?: Readonly<{occurrenceKeys: readonly string[]}>,
  ): void {
    const previousChoices = this.measurementChoices.get(owner);
    const choices = new Map<string, number>();
    this.measurementChoices.set(owner, choices);
    this.clearDecorations(owner);
    if (decorations.length === 0) {
      return;
    }
    const occurrenceKeys = scope ? new Set(scope.occurrenceKeys) : undefined;
    this.root.updateMatrixWorld(true);
    const resolveMeasurement = (
      value: Extract<ViewportDecoration, {kind: 'measurement'}>,
      occurrence: Occurrence,
    ) => {
      if (!('candidates' in value)) return value;
      const key = JSON.stringify([
        occurrence.key,
        value.nodeId,
        value.candidates,
      ]);
      const previous = previousChoices?.get(key);
      const segment =
        previous === undefined
          ? representativeDimensionEdge(
              value.candidates,
              this.camera,
              occurrence.object.matrixWorld,
            )!
          : value.candidates[previous];
      choices.set(key, value.candidates.indexOf(segment));
      return segment;
    };
    const instances = decorations.flatMap<DecorationInstance>(decoration => {
      return this.renderedOccurrences()
        .filter(
          occurrence =>
            (occurrence.node.nodeId === decoration.nodeId ||
              occurrence.renderedNodeId === decoration.nodeId) &&
            (!occurrenceKeys || occurrenceKeys.has(occurrence.key)),
        )
        .map(occurrence => {
          const projected =
            decoration.kind === 'anchor'
              ? previewSpatialReference(
                  decoration,
                  this.spatialPreviews.get(occurrence.key),
                  occurrence.node,
                )
              : decoration;
          const decorationObject =
            projected.kind === 'mesh'
              ? createMeshDecorationObject(projected)
              : projected.kind === 'edges'
                ? createEdgeDecorationObject(projected)
                : projected.kind === 'bounds'
                  ? createBoundsDecorationObject(projected)
                  : projected.kind === 'surface'
                    ? createSurfaceDecorationObject(
                        projected,
                        projected.operationRole ?? occurrence.operationRole,
                      )
                    : projected.kind === 'topology'
                      ? createTopologyDecorationObject(projected)
                      : projected.kind === 'measurement'
                        ? new MeasurementDecorationObject({
                            ...projected,
                            ...resolveMeasurement(projected, occurrence),
                          })
                        : new AnchorDecorationObject(projected);
          const object = new THREE.Group();
          object.matrixAutoUpdate = false;
          object.add(decorationObject);
          this.decorationRoot.add(object);
          const instance: DecorationInstance = {
            object,
            occurrenceKey: occurrence.key,
            frame:
              projected.kind === 'anchor'
                ? (projected.frame ?? 'geometry')
                : 'geometry',
            bounds: decoration.kind === 'bounds',
            anchor:
              decorationObject instanceof AnchorDecorationObject
                ? decorationObject
                : undefined,
            measurement:
              decorationObject instanceof MeasurementDecorationObject
                ? decorationObject
                : undefined,
            corners: decorationObject.children.find(
              (child): child is ScreenSpaceCornerLines =>
                child instanceof ScreenSpaceCornerLines,
            ),
            visibility:
              decoration.kind === 'edges' || decoration.kind === 'topology'
                ? decoration.visibility
                : undefined,
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
          instance.measurement?.update(
            this.camera,
            this.renderer.domElement.clientHeight,
          );
          return instance;
        });
    });
    if (instances.length > 0) this.decorationLayers.set(owner, instances);
    this.updateDecorationVisibilities();
    this.requestRender();
  }

  clearDecorations(owner: string): void {
    const instances = this.decorationLayers.get(owner);
    if (!instances) {
      return;
    }
    instances.forEach(({object, measurement}) => {
      measurement?.dispose();
      object.removeFromParent();
      disposeObject(object);
    });
    this.decorationLayers.delete(owner);
    this.updateDecorationVisibilities();
    this.requestRender();
  }

  setSourceDecorationVisible(providerId: string, visible: boolean): void {
    if (visible) this.hiddenSourceDecorations.delete(providerId);
    else this.hiddenSourceDecorations.add(providerId);
  }

  get positionTools(): TransformGizmo {
    return this.transformGizmo;
  }

  get dragPreview() {
    return this.transformGizmo.dragPreview;
  }

  cancelPositionTool(): boolean {
    return this.transformGizmo.cancel();
  }

  fit(target: THREE.Object3D = this.root): void {
    this.frame(target, true);
    this.hasFramedView = true;
  }

  setView(view: ImageView): void {
    const bounds = new THREE.Box3().setFromObject(this.root);
    if (bounds.isEmpty()) return;
    orientImageCamera(this.controls.object, bounds, view);
    bounds.getCenter(this.controls.focus);
    this.controls.syncCamera();
    this.hasFramedView = true;
  }

  async captureImage(
    width: number,
    height: number,
    view?: ImageView,
  ): Promise<Blob> {
    this.selectionHighlight?.update();
    this.impactHighlights.forEach(highlight => highlight.update());
    this.updateDecorationVisibilities();
    try {
      return await this.rendering.captureImage(
        width,
        height,
        (camera, width, height) =>
          this.updateDecorationSizes(camera, width, height),
        view
          ? {view, bounds: new THREE.Box3().setFromObject(this.root)}
          : undefined,
      );
    } finally {
      this.updateDecorationSizes(
        this.camera,
        this.renderer.domElement.clientWidth,
        this.renderer.domElement.clientHeight,
      );
      this.requestRender();
    }
  }

  private frameChangedView(target: THREE.Object3D = this.root): void {
    this.frame(target, !this.hasFramedView);
    this.hasFramedView = true;
  }

  private saveViewportState(): void {
    if (!this.activeScene || this.transientPreviewRestore) return;
    this.viewStates.set(this.activeScene.key, {
      pose: transformCameraPose(
        this.controls.savedPose(),
        this.activeScene.frame,
      ),
      mode: this.rendering.mode,
      savedAt: ++this.stateRevision,
    });
  }

  private activateViewportScene(
    nodes: readonly ModelSnapshotObject[],
    placement: ModelPlacement,
  ): void {
    if (this.transientPreviewRestore) {
      this.frameChangedView();
      return;
    }
    if (!this.hasRenderableGeometry()) {
      this.saveViewportState();
      this.activeScene = undefined;
      return;
    }
    const scene = this.scenes!.scene(nodes, placement);
    if (scene && this.activeScene && scene.key === this.activeScene.key) {
      const transform = scene.frame
        .clone()
        .invert()
        .multiply(this.activeScene.frame);
      this.controls.restorePose(
        transformCameraPose(this.controls.savedPose(), transform),
      );
      this.activeScene = scene;
      return;
    }
    const previousScene = this.activeScene;
    this.saveViewportState();
    this.activeScene = scene;
    if (!scene) return;
    let state = this.viewStates.get(scene.key);
    if (!state) {
      const source = scene.defaults
        .flatMap(candidate => {
          const saved = this.viewStates.get(candidate.key);
          return saved ? [{...candidate, saved}] : [];
        })
        .sort((a, b) => b.saved.savedAt - a.saved.savedAt)[0];
      if (source) {
        state = {
          ...source.saved,
          pose: transformCameraPose(source.saved.pose, source.transform),
        };
      }
    }
    this.setRenderMode(state?.mode ?? 'modeling');
    const framing = !state ? this.cameraFraming(this.root) : undefined;
    const pose = state
      ? transformCameraPose(state.pose, scene.frame.clone().invert())
      : framing && this.controls.defaultPose(framing);
    if (pose) {
      const previousFrame = scene.defaults.find(
        candidate => candidate.key === previousScene?.key,
      );
      if (previousFrame) {
        this.controls.restorePose(
          transformCameraPose(
            this.controls.capturePose(),
            scene.frame
              .clone()
              .invert()
              .multiply(previousFrame.transform)
              .multiply(previousScene!.frame),
          ),
        );
      }
      this.controls.restorePose(
        pose,
        previousScene !== undefined &&
          this.animateViewChanges &&
          this.isViewVisible(),
      );
      this.hasFramedView = true;
    }
    this.saveViewportState();
  }

  private frame(target: THREE.Object3D, allowZoomIn: boolean): void {
    const framing = this.cameraFraming(target);
    if (framing) this.controls.frame(framing, allowZoomIn);
  }

  private cameraFraming(target: THREE.Object3D) {
    return this.rendering.framing(
      target,
      this.controls.object,
      this.transformGizmo.framing(),
    );
  }

  /** Use retained geometry/pose with the original source's editing metadata. */
  private interactionNode(node: ModelSnapshotObject): ModelSnapshotObject {
    const source =
      node.sourceNodeId && this.module?.objects.get(node.sourceNodeId);
    if (!source) return node;
    const stage = this.sourceContext?.evaluation.relationPreview;
    const {kind: _kind, mesh: _mesh, children: _children, ...metadata} = source;
    return {
      ...node,
      ...metadata,
      ...(stage?.nodeId === source.nodeId ? stage : undefined),
      transform: node.transform,
      compositionTransform: node.compositionTransform,
    };
  }

  private buildObject(
    node: ModelSnapshotObject,
    key: string,
    depth: number,
    view: Occurrence['view'],
    placement: ModelPlacement,
    operationRole?: ModelOperationInputRole,
  ): THREE.Object3D {
    const object = createRenderedModelNode(node, this.requestRender);
    object.name = node.name;
    object.userData.selectionKey = key;
    applyNodeTransform(object, node, placement);

    const occurrence = {
      key,
      node: this.interactionNode(node),
      renderedNodeId: node.nodeId,
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

  private renderModelView(
    selectedKey: string,
    renderedViewTarget: RenderedViewTarget = {kind: 'model'},
    model = this.module?.fallback,
  ): void {
    this.inspectionScene = undefined;
    if (!model) {
      return;
    }
    this.selectionEmphasized = true;
    this.renderedViewTarget = renderedViewTarget;
    this.resetRenderedView();
    const rootObject = this.buildObject(
      model,
      'root',
      model.kind === 'group' ? 0 : 1,
      'model',
      'standalone',
    );
    if (renderedViewTarget.kind === 'source')
      applySourceEmphasis(rootObject, 'primary');
    this.root.add(rootObject);
    this.applyPreviewTransforms();
    this.selectKey(
      this.occurrences.has(selectedKey) ? selectedKey : 'root',
      false,
    );
    this.activateViewportScene([model], 'standalone');
    this.onViewChange?.();
  }

  private sourceTargetAt(
    file: string,
    offset: number,
    module: ModelModule | null = this.module,
    preferredSource?: SourceRef,
  ): SourceTarget | undefined {
    const candidates = (module?.sourceTargets ?? []).filter(
      ({sourceRef}) =>
        sourceRef.file === file &&
        sourceRef.start <= offset &&
        offset <= sourceRef.end,
    );
    // A call end and a zero-width insertion gap can share one caret. Navigation
    // carries its registered source identity; recompilation retains that choice
    // through the existing selected source context. Bare inspector targets only
    // provide scenes: they never shadow a semantic target reached by identity.
    const preferred = preferredSource
      ? candidates.filter(
          target =>
            target.kind !== 'inspect' &&
            target.sourceRef.file === preferredSource.file &&
            target.sourceRef.start === preferredSource.start &&
            target.sourceRef.end === preferredSource.end,
        )
      : [];
    const atExpressionStart = candidates.some(
      target => !target.relationArray && target.sourceRef.start === offset,
    );
    const selected = (
      preferred.length
        ? preferred
        : candidates.filter(
            target => !atExpressionStart || !target.relationArray,
          )
    ).sort((left, right) => {
      const isInsertion = (target: SourceTarget) =>
        !!target.relationArray &&
        offset > target.sourceRef.start &&
        offset < target.sourceRef.end;
      const leftInsertion = isInsertion(left);
      const rightInsertion = isInsertion(right);
      if (leftInsertion !== rightInsertion) return leftInsertion ? -1 : 1;
      const leftIsTool = left.tool !== undefined;
      const rightIsTool = right.tool !== undefined;
      if (leftIsTool !== rightIsTool) return leftIsTool ? -1 : 1;
      return (
        sourceSpan(left.sourceRef) - sourceSpan(right.sourceRef) ||
        sourceTargetPriority(left) - sourceTargetPriority(right) ||
        latestRuntimeOrder(right) - latestRuntimeOrder(left)
      );
    })[0];
    return selected?.rotationToolId
      ? (module?.sourceTargets.find(
          target => target.id === selected.rotationToolId,
        ) ?? selected)
      : selected;
  }

  private buildContextObject(
    node: ModelSnapshotObject,
    key: string,
    targetId: string,
    placement: ModelPlacement,
    emphasis: Exclude<SourceEmphasis, 'primary'>,
  ): THREE.Object3D {
    const object = createRenderedModelNode(node, this.requestRender);
    object.name = `${node.name} (context)`;
    object.userData.context = true;
    object.userData.sourceTargetId = targetId;
    object.userData.sourceNodeId = node.nodeId;
    applyNodeTransform(object, node, placement);
    applySourceEmphasis(object, emphasis);
    this.contextOccurrences.set(key, {
      key,
      node: this.interactionNode(node),
      renderedNodeId: node.nodeId,
      object,
      depth: 1,
      view: 'source',
      placement,
    });
    node.children.forEach((child, index) => {
      object.add(
        this.buildContextObject(
          child,
          `${key}/${index}`,
          targetId,
          placement,
          emphasis,
        ),
      );
    });
    return object;
  }

  private captureTransientPreviewRestore(): void {
    if (!this.module) return;
    this.saveViewportState();
    this.transientPreviewRestore ??= {
      module: this.module,
      inspection: this.inspectionScene,
      inspectionSource: this.inspectionSource,
      target: this.selectedViewTarget,
      selectedKey: this.selectedKey,
      pose: this.controls.capturePose(),
      mode: this.rendering.mode,
    };
  }

  private retainRenderedGeometry(
    kind: 'retained' | 'unfocused' = 'retained',
  ): void {
    this.renderedViewTarget = {kind};
    this.clearRenderedInteraction();
    this.rebuildSelectionHighlight();
  }

  private resetRenderedView(): void {
    this.clearRenderedInteraction();
    this.disposeRoot();
    this.occurrences.clear();
    this.contextOccurrences.clear();
    this.rebuildSelectionHighlight();
    this.root.clear();
  }

  private clearRenderedInteraction(): void {
    if (this.pendingSpatialTool) this.awaitToolUpdate();
    if (this.topologySelection) {
      this.clearTopologySelection();
      this.onTopologySelection({kind: 'cancel'});
    }
    this.transformGizmo.detach();
    this.clearImpactHighlights();
    this.clearAllDecorations();
    this.measurementChoices.clear();
    this.parameterPreviews.clear();
    this.committedParameterPreviews.clear();
    this.hiddenSourceDecorations.clear();
    this.spatialPreviews.clear();
    this.committedSpatialPreviews.clear();
    this.spatialParameterValues.clear();
    this.highlightedTargetId = undefined;
    this.highlightedOccurrenceKeys.clear();
    this.selectionClick = undefined;
    this.decorationRoot.clear();
  }

  private selectKey(key: string, notify: boolean): void {
    const occurrence = this.occurrences.get(key);
    if (!occurrence) {
      return;
    }
    this.selectedKey = key;
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
    this.requestRender();
    if (this.selectionHighlight) {
      this.scene.remove(this.selectionHighlight);
      this.selectionHighlight.dispose();
      this.selectionHighlight = null;
    }

    const occurrence = this.getSelected();
    if (
      !occurrence ||
      occurrence.sketchId ||
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
        // Selection fills stay in the decoration band, below sketch geometry
        // and below the glyphs that share that band.
        renderOrder: decorationRenderOrder.surface,
      },
    );
    this.scene.add(modelingHelper(this.selectionHighlight));
  }

  private updateTransformGizmo(): void {
    if (this.rendering.mode === 'render') {
      this.transformGizmo.detach();
      return;
    }
    const occurrence = this.getSelected();
    const source = this.sourceContext;
    const scope =
      source && this.module ? contextualToolScope(this.module, source) : source;
    const attach = (bindings: readonly TransformGizmoBinding[]) => {
      // Operation outputs stand in for their tool when no call-site target was
      // produced (e.g. an origin operation on a group expression).
      const name =
        scope?.target.tool?.signature.name ?? scope?.target.operation?.kind;
      const explicit =
        name &&
        [
          'offset',
          'rotate',
          'originOffset',
          'originPoint',
          'originVertex',
          'originCenter',
          'pivot',
          'pivotVertex',
          'pivotPoint',
          'pivotOffset',
          'axisEdge',
          'axisLine',
          'axisOffset',
        ].includes(name);
      this.transformGizmo.attach(
        occurrence!.object,
        bindings,
        explicit && bindings[0] ? bindingTool(bindings[0]) : undefined,
      );
    };
    if (this.pendingSpatialTool) {
      if (
        occurrence?.key === this.pendingSpatialTool.key &&
        scope?.target.id === this.pendingSpatialTool.targetId
      )
        attach(this.pendingSpatialTool.bindings);
      else this.transformGizmo.detach();
      return;
    }
    if (occurrence && scope && this.module) {
      if (scope.target.rotationSelection) {
        this.transformGizmo.attach(
          occurrence.object,
          [],
          ['axisLine', 'axisEdge'].includes(
            scope.target.rotationSelection.selector,
          )
            ? 'rotate-axis'
            : 'rotate-point',
        );
        return;
      }
      const relation = scope.evaluation;
      const selection = relation.relationSpatial?.kind;
      if (
        (relation.constraintId ||
          relation.transformationId ||
          scope.target.relationArray) &&
        relation.relationOwnerNodeId === occurrence.node.nodeId &&
        (!selection || selection === 'rotate' || selection === 'offset') &&
        !relation.operationId
      ) {
        const bindings = transformationBindings(
          this.module,
          occurrence,
          this.renderedOccurrences(),
          this.committedSpatialPreviews,
          this.spatialParameterValues,
          scope,
        );
        attach([...bindings, ...rotationReferenceBindings(bindings)]);
        return;
      }
      const bindings = spatialBindings(
        this.module,
        scope,
        occurrence,
        this.renderedOccurrences(),
        this.committedSpatialPreviews,
        this.spatialParameterValues,
      );
      const modelBindings = modelInsertionBindings(
        this.module,
        scope,
        occurrence,
        this.renderedOccurrences(),
      ).filter(
        binding =>
          !bindings.some(
            existing => bindingTool(existing) === bindingTool(binding),
          ),
      );
      if (bindings.length > 0 || modelBindings.length > 0) {
        attach([
          ...bindings,
          ...modelBindings,
          ...rotationReferenceBindings(bindings),
        ]);
        return;
      }
      if (scope.evaluation.relationSpatial) {
        this.transformGizmo.detach();
        return;
      }
    }
    if (
      (this.topologySelection && !this.topologySelection.positionTool) ||
      !occurrence ||
      occurrence.depth === 0 ||
      !this.hasRelativePositionContext()
    ) {
      this.transformGizmo.detach();
      return;
    }
    const bindings = this.module
      ? transformationBindings(
          this.module,
          occurrence,
          this.renderedOccurrences(),
          this.committedSpatialPreviews,
          this.spatialParameterValues,
        )
      : [];
    attach([...bindings, ...rotationReferenceBindings(bindings)]);
  }

  private applyPreviewTransforms(): void {
    this.requestRender();
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

  /** Visible target and ambient instances in the currently presented scene. */
  renderedOccurrences(): Occurrence[] {
    return [...this.occurrences.values(), ...this.contextOccurrences.values()];
  }

  private previewTranslationFor(occurrence: Occurrence): Vec3 {
    const offset: [number, number, number] = [0, 0, 0];
    for (const transformation of occurrence.node.transformations ?? []) {
      for (const parameter of transformation.parameters) {
        const previewValue = this.parameterPreviews.get(parameter.target.id);
        if (previewValue === undefined || parameter.operation !== 'offset')
          continue;
        const axis = axisIndex(parameter.argument);
        if (axis === undefined) continue;
        const stage = transformation.offsets.find(stage =>
          stage.sourceRefs.some(
            ref =>
              ref.file === parameter.operationRef.file &&
              ref.start === parameter.operationRef.start &&
              ref.end === parameter.operationRef.end,
          ),
        );
        if (!stage) continue;
        const localOffset = new THREE.Vector3();
        localOffset.setComponent(
          axis,
          (previewValue - parameter.target.value) * parameter.sensitivity,
        );
        localOffset.applyQuaternion(
          new THREE.Quaternion(...stage.frame.quaternion),
        );
        offset[0] += localOffset.x;
        offset[1] += localOffset.y;
        offset[2] += localOffset.z;
      }
    }
    return offset;
  }

  private beginSelectionGesture(event: PointerEvent): void {
    if (
      this.rendering.mode === 'render' ||
      !event.isPrimary ||
      event.button !== 0
    ) {
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
    this.requestRender();
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
    );
    if (selected) overlay.add(selected);
    if (selection.hoveredId !== undefined) {
      const hovered = createTopologyHighlight(
        selection.mesh,
        selection.kind,
        new TopologyIdSet([selection.hoveredId]),
        selection.selectedIds.has(selection.hoveredId) ? '#ffad66' : '#63dcff',
      );
      if (hovered) {
        hovered.traverse(object => {
          object.renderOrder = decorationRenderOrder.hover;
        });
        overlay.add(hovered);
      }
    }
    selection.guide.add(overlay);
    this.topologySelectionOverlay = overlay;
  }

  private clearTopologySelection(): void {
    this.requestRender();
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
    if (this.rendering.mode === 'render') return undefined;
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
    if (
      this.renderedViewTarget.kind === 'completion' ||
      this.renderedViewTarget.kind === 'retained'
    )
      return [];
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
    const scope = this.sourceContext;
    return Boolean(
      (scope?.evaluation.operationInput &&
        scope.target.contextTargetIds.length > 0) ||
      (scope?.evaluation.isCollection && scope.evaluation.focusNodeIds),
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
      evaluation.nodeIds.some(id => {
        const node = this.module?.objects.get(id);
        return node && containsNode(node, nodeId);
      }),
    );
    if (evaluationIndex < 0) {
      return;
    }
    this.selectedViewTarget = {kind: 'source', targetId, evaluationIndex};
    this.transientPreviewRestore = undefined;
    this.onNavigateSource(
      target.sourceRef,
      target.evaluations[evaluationIndex].contextId,
    );
  }

  private resize(): void {
    this.rendering.resize();
    this.controls.resize();
    this.refreshTopologyHover();
  }

  /** Coalesce native scene mutations into one frame; idle views do no GPU work. */
  private requestRender = (): void => {
    if (!this.disposed && this.pendingFrame === undefined)
      this.pendingFrame = requestAnimationFrame(this.draw);
  };

  private draw = (time: number): void => {
    this.controls.updateTransition(time);
    this.rendering.updateCameraRange(
      this.controls.focus,
      this.controls.object.position.distanceTo(this.controls.focus),
      this.root,
    );
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
    // Changes made while preparing this frame are already visible. Reactions to
    // the published grid step may change scene resources and need another frame.
    this.pendingFrame = undefined;
    if (this.controls.transitioning) this.requestRender();
    const step = this.rendering.grid.step;
    runInAction(() => {
      this.liveGridStep = step;
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
          renderOrder: decorationRenderOrder.glyph,
        },
      );
      this.impactHighlights.push(highlight);
      this.scene.add(modelingHelper(highlight));
    }
  }

  private clearImpactHighlights(): void {
    this.requestRender();
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
    this.updateTopologySelectionTransform();
  }

  private updateTopologySelectionTransform(): void {
    const selection = this.topologySelection;
    if (!selection) return;
    const occurrence = this.occurrences.get(selection.occurrenceKey);
    if (!occurrence) return;
    occurrence.object.updateWorldMatrix(true, false);
    selection.guide.matrix.multiplyMatrices(
      occurrence.object.matrixWorld,
      selection.localTransform,
    );
    selection.guide.matrixWorldNeedsUpdate = true;
    selection.guide.updateWorldMatrix(true, true);
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
        instance.measurement?.update(camera, viewportHeight);
        instance.corners?.update(camera, viewportWidth, viewportHeight);
      }
    }
  }

  private updateDecorationVisibilities(): void {
    const boundsKeys = new Set<string>();
    const boundsTargets = new Set<THREE.Object3D>();
    for (const instances of this.decorationLayers.values()) {
      for (const instance of instances) {
        if (!instance.bounds) continue;
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
    if (instance.visibility === 'without-topology-selection') {
      instance.object.visible =
        this.topologySelection?.occurrenceKey !== instance.occurrenceKey;
      return;
    }
    if (instance.visibility !== 'without-object-bounds') return;
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
    const occurrence =
      this.occurrences.get(instance.occurrenceKey) ??
      this.contextOccurrences.get(instance.occurrenceKey);
    if (!occurrence) return;
    instance.object.matrix.copy(occurrence.object.matrixWorld);
    const spatial = this.spatialPreviews.get(occurrence.key);
    if (instance.frame === 'operation' && spatial) {
      const delta = new THREE.Matrix4().compose(
        new THREE.Vector3(...spatial.transform.position),
        new THREE.Quaternion(...spatial.transform.quaternion),
        new THREE.Vector3(1, 1, 1),
      );
      instance.object.matrix.multiply(delta.invert());
    }
    instance.object.matrixWorldNeedsUpdate = true;
  }

  private clearAllDecorations(): void {
    for (const owner of [...this.decorationLayers.keys()]) {
      this.clearDecorations(owner);
    }
  }

  private disposeRoot(): void {
    this.requestRender();
    disposeObject(this.root);
  }
}

function containsSource(container: SourceRef, candidate: SourceRef): boolean {
  return (
    container.file === candidate.file &&
    container.start <= candidate.start &&
    candidate.end <= container.end
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
  if (target.kind === 'constraint' || target.kind === 'transformation')
    return 0;
  if (target.kind === 'operation-input') return 1;
  if (target.kind === 'operation-output') return 2;
  return 3;
}

function isRelativePositionContext(target: SourceTarget | undefined): boolean {
  if (target?.kind === 'constraint' || target?.kind === 'transformation')
    return true;
  const role = target?.operation?.role;
  return target?.kind === 'operation-input' && isCompositionInputRole(role);
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
): Readonly<{guide: THREE.Group; pickObject?: THREE.Mesh}> {
  const guide = new THREE.Group();
  guide.name = `${node.name} (selectable ${kind}s)`;
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

function createTopologyDecorationObject(
  decoration: Extract<ViewportDecoration, {kind: 'topology'}>,
): THREE.Object3D {
  const container = new THREE.Group();
  container.name = decoration.id;
  container.userData.decoration = decoration;
  const highlight = createTopologyHighlight(
    decoration.mesh,
    decoration.topologyKind,
    new TopologyIdSet(decoration.ids),
    decoration.appearance.color,
    symbolLineWidth,
  );
  if (highlight) container.add(highlight);
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
      decorationRenderOrder.mark,
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
          decorationRenderOrder.glyph,
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
      surface.renderOrder = decorationRenderOrder.surface;
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
          decorationRenderOrder.glyph,
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
          decorationRenderOrder.mark,
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
          decorationRenderOrder.mark,
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
  // Selected/hovered faces stay in the decoration surface band so inspected
  // sketch geometry above it is not tinted by the fill.
  surface.renderOrder = decorationRenderOrder.surface;
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

function transformCameraPose(
  pose: CameraPose,
  transform: THREE.Matrix4,
): CameraPose {
  return {
    ...pose,
    focus: pose.focus.clone().applyMatrix4(transform),
    orientation: new THREE.Quaternion()
      .setFromRotationMatrix(transform)
      .multiply(pose.orientation),
  };
}
