import {input} from './input.js';
import {timeOffset} from './time-offset.js';
import {
  assembleWire,
  basicFaceExtrusion,
  BoundingBox,
  genericSweep,
  getOC,
  makeBezierCurve,
  makeBSplineApproximation,
  makeCircle,
  makeCylinder,
  makeFace,
  makeHelix,
  makeLine,
  makeSphere,
  makeThreePointArc,
  makeVertex,
  measureShapeLinearProperties,
  measureShapeSurfaceProperties,
  measureShapeVolumeProperties,
  sketchCircle,
  sketchEllipse,
  sketchPolysides,
  sketchRectangle,
  Vector,
  type AnyShape,
  type Edge as ReplicadEdge,
  type Face as ReplicadFace,
  type Vertex as ReplicadVertex,
  type Wire as ReplicadWire,
  type Shape3D,
} from 'replicad';
import {
  cross,
  subtract,
  edgeGeometry,
  faceGeometry,
  transformGeometry,
  type AlignmentGeometry,
} from './alignment-geometry.js';
import {cache, cachedArtifact} from './cached.js';
import {extrudeWithTopology, revolveWithTopology} from './extrude.js';
import {font, googleFont, type Font} from './font.js';
import {
  anchorAnnotation,
  boundsAnnotation,
  captureInspectData,
  dimension,
  isRecordingInspection,
  retainInspectionIdentity,
  type Dimension,
  type DimensionSegment,
  type InspectContext,
  type InspectClosureExecution,
  type InspectResult,
  type PreviewValue,
} from './inspect.js';
import {
  beginKernelOperationEvaluation,
  kernelOperationKey,
  type KernelArtifact,
  type KernelKeyPart,
  type KernelOperationKey,
  type KernelValueLifecycle,
} from './kernel-cache.js';
import {
  castOwnedShape,
  castOwnedShape3D,
  centeredBoxShape,
  ellipsoidShape,
  shapeSubshapes,
  transformShape,
} from './kernel-shapes.js';
import {loftWithTopology, sweepWithTopology} from './loft.js';
import {captureModelMaterial, type ModelMaterialSnapshot} from './material.js';
import {
  axisRotation,
  solveBodies,
  type Body,
  beforeTransformations,
  afterTransformations,
  type BodyAction,
} from './relation-solver.js';
import {estimateRetainedBytes} from './retained-memory.js';
import {shellWithTopology} from './shell.js';
import {wrapFaces, type WrapOptions} from './wrap.js';
import {thickenWithTopology} from './thicken.js';
import {surfaceRotation} from './surface-geometry.js';
import {sketchRegionFace} from './sketch-face.js';
import type {SketchRegion} from './sketch-regions.js';
import {
  addVectors,
  composeTransforms,
  frameFromYAxis,
  identityRigidTransform,
  invertTransform,
  negateVector,
  origin,
  quaternionAxisAngle,
  relativeTransform,
  rotateVector,
  rotation,
  rotationAround,
  translation,
  transformsAreEquivalent,
  type Quaternion,
  type RigidTransform,
  type Vec3,
} from './spatial.js';
import {textGlyphs, textRegionFace, type TextOptions} from './text.js';
import {MeshBasicMaterial, type Material} from 'three';
import {formatTopologyId, type TopologyId} from './topology-id.js';
import {
  inspectShapeTopology,
  type TopologyInspection,
  type TopologyInspectionOptions,
} from './topology-inspection.js';
import {
  assertTopologyId,
  booleanWithTopology,
  chamferEdges,
  filletEdges,
  initialShapeTopology,
  preserveShapeTopology,
  resolveEdgeSelection,
  resolveTopologySelection,
  stableEdgeGroups,
  stableSurfaceGroups,
  stableVertexData,
  topologyChildren,
  topologyEdgeDirections,
  topologySurfaceDirections,
  topologyVertexPoints,
  withTopologyShape,
  type EdgeId,
  type ShapeTopology,
  type SurfaceId,
  type TopologyKind,
  type TopologySelection,
  type VertexId,
} from './topology.js';

import {
  decodeKernelArtifact,
  encodeKernelArtifact,
} from './kernel-artifact-codec.js';
import {
  isSketch,
  isSketchPoint,
  sketch,
  sketchFrame,
  sketchForFrame,
  retainSketchFrame,
} from './sketch.js';

export type {Quaternion, Vec3} from './spatial.js';
export type {EdgeId, SurfaceId, TopologyKind, VertexId} from './topology.js';

export type SourceRef = Readonly<{
  file: string;
  start: number;
  end: number;
}>;

export type ParameterKind = 'length' | 'angle' | 'ratio' | 'count' | 'scalar';

export type ParameterTarget = Readonly<{
  id: string;
  label: string;
  kind: ParameterKind;
  value: number;
  sourceRef: SourceRef;
}>;

export type ParameterUsage = Readonly<{
  operation: string;
  argument: string;
  value: number;
  operationRef: SourceRef;
  expressionRef: SourceRef;
  target: ParameterTarget;
  sensitivity: number;
}>;

export type Transform = Readonly<{
  position: Vec3;
  quaternion: Quaternion;
  scale: Vec3;
}>;

export type ElementKind = 'point' | 'line' | 'face' | 'frame';

export type ElementSnapshot = Readonly<{
  name: string;
  kind: ElementKind;
  transform: Transform;
  bound?: Readonly<{size: readonly [number, number]; facing: 1 | -1}>;
  facing?: 1 | -1;
  direction?: 1 | -1;
  arrows?: readonly RigidTransform[];
  topology?: Readonly<{geometryNodeId: string; transform: Transform}> &
    TopologySelection;
}>;

type DistanceInspectData = Readonly<{
  result: DistanceResult;
  direction?: Vec3;
  axisName?: 'x' | 'y' | 'z';
  references: readonly [AnchorReference, AnchorReference];
  poses: ReadonlyMap<RelationObject, RigidTransform>;
}>;

type CompositionInspectData = Readonly<{
  poses: ReadonlyMap<RelationObject, RigidTransform>;
}>;

type InspectionFrame = Readonly<{
  owner(model: RelationObject): ModelObject | undefined;
  display(model: RelationObject): PreviewValue | undefined;
  positioned(
    value: Anchor,
    reference?: AnchorReference,
    asAnchor?: boolean,
  ): PreviewValue | undefined;
}>;

type RelateInspectData = Readonly<{
  self: RelationObject;
  participants: readonly RelationObject[];
  relations: readonly Relation[];
}>;

type RelateInspectionContext = RelateInspectData &
  Readonly<{
    owns(value: unknown): boolean;
    poses(
      relation?: RelationExpression,
      insertion?: number,
    ): ReadonlyMap<RelationObject, RigidTransform>;
  }>;

export type ConstraintAnchorSnapshot = Readonly<{
  nodeId: string;
  name: string;
  kind: ElementKind;
}>;

export type ConstraintSnapshot = Readonly<{
  id: string;
  source: ConstraintAnchorSnapshot;
  target: ConstraintAnchorSnapshot;
  sourceElement: ElementSnapshot;
  targetElement: ElementSnapshot;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
}> &
  (
    | Readonly<{
        kind: 'on';
        /** Finite source extent in the contact frame, local to the source node. */
        sourceBounds: Readonly<{size: Vec3; transform: Transform}>;
      }>
    | Readonly<{kind: 'align'}>
    | Readonly<{kind: 'coupleRotation'; config: RotationCouplingConfig}>
  );

export type ModelOperationKind =
  | 'sketch'
  | 'box'
  | 'cylinder'
  | 'tube'
  | 'coil'
  | 'sphere'
  | 'ellipsoid'
  | 'frustum'
  | 'regularPrism'
  | 'circle'
  | 'ellipse'
  | 'rectangle'
  | 'regularPolygon'
  | 'point'
  | 'line'
  | 'arc'
  | 'bezier'
  | 'spline'
  | 'loft'
  | 'sketchFace'
  | 'text'
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'wrap'
  | 'thicken'
  | 'primitive'
  | 'material'
  | 'scaled'
  | 'originOffset'
  | 'originVertex'
  | 'originPoint'
  | 'originCenter'
  | 'rotate'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'relate'
  | 'expose'
  | 'group'
  | 'union'
  | 'cut'
  | 'intersect';

export type ModelOperationInputRole =
  | 'source'
  | 'receiver'
  | 'operand'
  | 'tool'
  | 'child'
  | 'collection'
  | 'reference'
  | 'section'
  | 'spine';

export type ModelGeometryKind = 'solid' | 'face' | 'edge' | 'vertex';

export type ModelKind = ModelGeometryKind | 'group';

export type ModelOperationSelectionSnapshot = Readonly<{
  kind: TopologyKind;
  inputNodeId: string;
  ids: readonly TopologyId[];
  /** Input geometry coordinates expressed in the operation output's frame. */
  transform: Transform;
}>;

export type ModelOperationSnapshot = Readonly<{
  id: string;
  siteId?: string;
  execution?: number;
  kind: ModelOperationKind;
  order?: number;
  outputNodeId: string;
  inputs: readonly Readonly<{
    nodeId: string;
    role: ModelOperationInputRole;
    index: number;
  }>[];
  selections: readonly ModelOperationSelectionSnapshot[];
  sourceRef?: SourceRef;
  spatial?: ModelSpatialOperation;
  /** Authored dimensions in the operation output's local geometry frame. */
  dimensions?: Readonly<Record<string, ModelParameterDimension>>;
}>;

export type ModelParameterDimension = Readonly<{
  origin: Vec3;
  vector: Vec3;
}>;

export type RotationReferenceSnapshot = Readonly<{
  offset: Vec3;
  offsetExplicit: boolean;
  explicit: boolean;
  /** Rotation in the displacement frame, including reversed axes. */
  rotation: Vec3;
  /** Reference displacement axes, in the result model's local coordinates. */
  frame: RigidTransform;
}> &
  (
    | Readonly<{kind: 'pivot'; point: Vec3}>
    | Readonly<{kind: 'pivotVertex'; id: VertexId}>
    | Readonly<{kind: 'axisEdge'; id: EdgeId}>
    | Readonly<{
        kind: 'pivotPoint' | 'axisLine';
        nodeId: string;
        name: string;
      }>
  );

/** Local geometry coordinates; vector is the authored coordinates, offset, or angles. */
export type ModelSpatialOperation = Readonly<{
  origin: Vec3;
  vector: Vec3;
  /** Relation edits use self's frame at this authored operation. */
  frame?: RigidTransform;
  rotation?: Vec3;
  axisOnly?: boolean;
  reference?: RotationReferenceSnapshot;
}>;

export type RelationSpatialReference = Readonly<{
  nodeId: string;
  kind:
    | 'pivot'
    | 'pivotVertex'
    | 'pivotPoint'
    | 'axisEdge'
    | 'pivotOffset'
    | 'axisLine'
    | 'axisOffset'
    | 'rotate'
    | 'offset';
  spatial: ModelSpatialOperation;
}>;

export type RelationPreview = Readonly<{
  object: Pick<
    ModelSnapshotObject,
    | 'nodeId'
    | 'compositionTransform'
    | 'constraints'
    | 'transformations'
    | 'relationStages'
  >;
  spatial?: RelationSpatialReference;
}>;

export type RenderMesh = Readonly<{
  /** Tessellation vertices used by the triangle mesh. */
  vertices: Float32Array;
  normals: Float32Array;
  /** Native face UVs normalized to each tessellated face's range. */
  uvs?: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  /** OpenCascade topology vertices, aligned with vertexIds. */
  topologyVertices: Float32Array;
  vertexIds: readonly VertexId[];
  surfaceGroups: readonly Readonly<{
    start: number;
    count: number;
    surfaceId: SurfaceId;
  }>[];
  edgeGroups: readonly Readonly<{
    start: number;
    count: number;
    edgeId: EdgeId;
    /** True for native straight edges, suitable as rotation references. */
    linear?: boolean;
  }>[];
}>;

export type ModelSnapshotObject = Readonly<{
  nodeId: string;
  /** Original author geometry retained in an inspection frame, for tool binding. */
  sourceNodeId?: string;
  name: string;
  /** Effective material, including recursive overrides from enclosing groups. */
  material?: ModelMaterialSnapshot;
  children: readonly ModelSnapshotObject[];
  /** Placement used when this snapshot participates in a composition. */
  compositionTransform: Transform;
  /** Placement in this snapshot tree; a root value uses model-local coordinates. */
  transform: Transform;
  constraints: readonly ConstraintSnapshot[];
  transformations?: readonly TransformationSnapshot[];
  relationStages?: readonly RelationStageSnapshot[];
  elements: readonly ElementSnapshot[];
  origin: Vec3;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
  operation: ModelOperationSnapshot;
}> &
  (
    | Readonly<{kind: ModelKind; mesh?: RenderMesh}>
    | Readonly<{kind: 'reference'; mesh?: never}>
  );

type StoredElement = Readonly<{
  kind: ElementKind;
  transform: RigidTransform;
  whole?: boolean;
  bound?: Readonly<{size: readonly [number, number]; facing: 1 | -1}>;
  facing?: 1 | -1;
  direction?: 1 | -1;
  topology?: StoredTopology;
  parts?: readonly StoredTopology[];
  members?: StoredElements;
}>;

type StoredTopology = Readonly<{
  source: ModelObject;
  selection: TopologySelection;
  transform: RigidTransform;
  scale: number;
}>;

type StoredElements = Readonly<Record<string, StoredElement>>;

type StoredAnchor = StoredElement & Readonly<{name: string}>;

type AnchorReference = StoredAnchor & Readonly<{model: RelationObject}>;

export type ModelElementReference = Readonly<{
  model: RelationObject;
  name: string;
  kind: ElementKind;
  transform: Transform;
  bound?: ElementSnapshot['bound'];
  facing?: 1 | -1;
  direction?: 1 | -1;
}>;

export type ModelTopologyReference = Readonly<{
  model: RelationObject;
  geometry: ModelObject;
  transform: Transform;
}> &
  TopologySelection;

export type ConstraintTraceReference = Readonly<{
  kind: 'constraint';
  constraintId: string;
  source: RelationObject;
  target: RelationObject;
  self?: RelationObject;
}>;

export type RelationTraceReference =
  | ConstraintTraceReference
  | Readonly<{
      kind: 'transformation';
      transformationId: string;
      self?: RelationObject;
    }>;

export type ModelOperationInstrumentation = Readonly<{
  siteId: string;
  execution: number;
  /** Distinguishes operation results produced by the same call execution. */
  outputIndex?: number;
  order: number;
  sourceRef: SourceRef;
  parameters: readonly ParameterUsage[];
}>;

export type ModelObjectRuntimeInfo = Readonly<{
  nodeId: string;
  name: string;
  sourceRefs: readonly SourceRef[];
}>;

type RelationDefinition =
  | (Readonly<{
      source: AnchorReference;
      target: AnchorReference;
    }> &
      ConstraintDefinition)
  | Readonly<{
      kind: 'transformation';
      actions: readonly TransformationAction[];
    }>;
type StoredTransformation = Readonly<{
  id: string;
  kind: 'transformation';
  actions: readonly TransformationAction[];
}>;
export type RelationStageSnapshot = Readonly<{
  constraintIds: readonly string[];
  transformationIds: readonly string[];
  compositionTransform: Transform;
  offsetFrame: Transform;
}>;
export type TransformationSnapshot = Readonly<{
  id: string;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
  offsets: readonly Readonly<{
    value: Vec3;
    frame: Transform;
    sourceRefs: readonly SourceRef[];
  }>[];
  rotations: readonly Readonly<{
    spatial: ModelSpatialOperation;
    sourceRefs: readonly SourceRef[];
  }>[];
  offsetFrame: Transform;
}>;
type StoredPlacement = StoredConstraint | StoredTransformation;

type ConstraintDefinition =
  | Readonly<{kind: 'on'}>
  | Readonly<{kind: 'align'}>
  | Readonly<{kind: 'coupleRotation'; config: RotationCouplingConfig}>;

type StoredConstraint = Readonly<{
  id: string;
  source: RelationReference;
  target: RelationReference;
}> &
  ConstraintDefinition;

// An omitted model refers to relate's self, including after immutable copies.
type RelationReference = StoredAnchor & Readonly<{model?: RelationObject}>;
type PivotSelection = (
  | Readonly<{kind: 'pivot'; point: Vec3}>
  | Readonly<{kind: 'pivotVertex'; id: VertexId}>
  | Readonly<{kind: 'pivotPoint'; point: RelationReference}>
  | Readonly<{kind: 'axisEdge'; id: EdgeId}>
  | Readonly<{kind: 'axisLine'; axis: RelationReference}>
) &
  Readonly<{offset?: Vec3; implicit?: true}>;
type AxisSelection = Extract<PivotSelection, {kind: 'axisLine' | 'axisEdge'}>;
type PointSelection = Exclude<PivotSelection, AxisSelection>;
function isAxisSelection(pivot: PivotSelection): pivot is AxisSelection {
  return pivot.kind === 'axisLine' || pivot.kind === 'axisEdge';
}
function selectionReference(
  pivot: PivotSelection,
): RelationReference | undefined {
  return pivot.kind === 'axisLine'
    ? pivot.axis
    : pivot.kind === 'pivotPoint'
      ? pivot.point
      : undefined;
}
function mapSelectionReference(
  pivot: PivotSelection,
  map: (reference: RelationReference) => RelationReference,
): PivotSelection {
  return pivot.kind === 'axisLine'
    ? {...pivot, axis: map(pivot.axis)}
    : pivot.kind === 'pivotPoint'
      ? {...pivot, point: map(pivot.point)}
      : pivot;
}
type TransformationRotationAction = Readonly<{
  pivot: PivotSelection;
  angles: Vec3 | number;
}>;
type TransformationAction =
  TransformationRotationAction | Readonly<{offset: Vec3}>;
type TransformationSpatialSelection = Readonly<{
  kind: RelationSpatialReference['kind'];
  pivot: PivotSelection;
}>;
type RelateContext = Readonly<{
  self: RelationObject;
  inheritedPlacements: readonly StoredPlacement[];
}>;
let activeRelate: RelateContext | undefined;

type StoredOperationInput = Readonly<{
  model: RelationObject;
  role: ModelOperationInputRole;
  index: number;
}>;

type StoredOperationSelection = Readonly<{
  kind: TopologyKind;
  input: ModelObject;
  ids: readonly TopologyId[];
  transform: RigidTransform;
}>;

type StoredOperation = {
  runtimeId: string;
  kind: ModelOperationKind;
  inputs: StoredOperationInput[];
  selections: StoredOperationSelection[];
  spatial?: ModelSpatialOperation;
  dimensions?: Readonly<Record<string, ModelParameterDimension>>;
};

type ValueTrace = {
  sourceRefs: SourceRef[];
  parameters: ParameterUsage[];
};

type OperationTrace = Omit<ModelOperationInstrumentation, 'parameters'>;

// Geometry and relations are persistent model values. Source provenance belongs
// only to the evaluation that observed them, including models cached by packages.
let valueTraces = new WeakMap<object, ValueTrace>();
let operationTraces = new WeakMap<StoredOperation, OperationTrace>();

/**
 * Start a fresh, serial tooling evaluation without invalidating model geometry.
 * Finish in finally after snapshotting to retain this evaluation's kernel work.
 * An optional cancellation check may throw before any kernel operation starts;
 * complete results survive cancellation, and cleanup removes the check.
 */
export function beginModelEvaluation(checkCancelled?: () => void): () => void {
  valueTraces = new WeakMap();
  operationTraces = new WeakMap();
  const finish = beginKernelOperationEvaluation(checkCancelled);
  return () => {
    finish();
  };
}

/** Inspectors share the kernel but must retain the model's trace and cache scope. */
export function beginModelInspection(checkCancelled?: () => void): () => void {
  return beginKernelOperationEvaluation(checkCancelled, 'inspect');
}

function valueTrace(value: object): ValueTrace {
  let trace = valueTraces.get(value);
  if (!trace) {
    trace = {sourceRefs: [], parameters: []};
    valueTraces.set(value, trace);
  }
  return trace;
}

type BooleanOperation = 'cut' | 'fuse' | 'intersect';

type BooleanEvaluation = Readonly<{
  context: SolveContext;
  geometry: SolidGeometry;
}>;

type ModelObjectInit<Kind extends ModelKind = ModelKind> = Readonly<{
  kind: Kind;
  geometry?: ModelGeometry;
  geometryAnchor?: StoredElement;
  name?: string;
  material?: ModelMaterialSnapshot;
  children?: readonly ModelObject[];
  assembly?: SolveContext;
  placements?: readonly StoredPlacement[];
  elements?: StoredElements;
  sourceRefs?: readonly SourceRef[];
  parameters?: readonly ParameterUsage[];
  operation: StoredOperation;
  meshTolerance?: number;
  nodeId?: string;
}>;

type LocalBounds = readonly [minimum: Vec3, maximum: Vec3];

type ModelGeometryValue = Readonly<{
  shape: AnyShape;
  topology: ShapeTopology;
  localBounds: LocalBounds;
  referenceBasis?: Readonly<{
    shape: AnyShape;
    topology: ShapeTopology;
    transform: RigidTransform;
    scale: number;
  }>;
}>;

type ModelGeometry = KernelArtifact<ModelGeometryValue>;

type SolidGeometry = KernelArtifact<
  ModelGeometryValue & Readonly<{shape: Shape3D}>
>;

type SolveContext = {
  poses: ReadonlyMap<RelationObject, RigidTransform>;
  frame: RigidTransform;
};

function transformSolveContext(
  context: SolveContext,
  transform: RigidTransform,
): SolveContext {
  return {
    frame: composeTransforms(transform, context.frame),
    poses: new Map(
      [...context.poses].map(([model, pose]) => [
        model,
        composeTransforms(transform, pose),
      ]),
    ),
  };
}

const unitScale: Vec3 = [1, 1, 1];
let nextNodeId = 1;
let nextConstraintId = 1;
let nextOperationId = 1;
const combineModels = Symbol('combineModels');
const loftModels = Symbol('loftModels');

const modelElementKinds = {
  solid: 'frame',
  face: 'face',
  edge: 'line',
  vertex: 'point',
  group: 'frame',
} as const satisfies Record<ModelKind, ElementKind>;

const defaultModelNames = {
  solid: 'Solid',
  face: 'Face',
  edge: 'Edge',
  vertex: 'Vertex',
  group: 'Group',
} as const satisfies Record<ModelKind, string>;

const anchorKind = Symbol('anchorKind');
const coordinateFrame = Symbol('coordinateFrame');
const anchorReferenceValue = Symbol('anchorReference');
const modelKind = Symbol('modelKind');
const modelNamedElements = Symbol('modelNamedElements');

export interface Anchor<Kind extends ElementKind = ElementKind> {
  readonly [anchorKind]: Kind;
}

export interface PointAnchor extends Anchor<'point'> {}

/** Fixed-axis angular transmission: self angle = ratio × other angle + phase. */
export type RotationCouplingConfig = Readonly<{
  ratio: number;
  /** Angular datum in degrees; defaults to zero. */
  phase?: number;
}>;

/** A coordinate-system reference, independent of model geometry. */
export interface FrameAnchor extends Anchor<'frame'> {
  readonly [coordinateFrame]: true;
  /** The frame's zero-point reference; it has no model geometry. */
  readonly origin: PointAnchor;
}

export interface LineAnchor extends Anchor<'line'> {
  /** Reverse direction without changing geometry or the reference coordinate axes. */
  reverse(): this;
}

export interface FaceAnchor extends Anchor<'face'> {
  /** Reverse facing without changing geometry, position, or the reference axes. */
  flip(): this;
}

/** Fixed solve-frame direction, or the solved direction of a straight edge/axis. */
export type DistanceAxis = 'x' | 'y' | 'z' | Vec3 | LineAnchor;

const boundKind = Symbol('boundKind');
export interface Bound extends FaceAnchor {
  readonly [boundKind]: true;
}

export interface DirectionalBounds {
  readonly up: Bound;
  readonly down: Bound;
  readonly left: Bound;
  readonly right: Bound;
  readonly front: Bound;
  readonly back: Bound;
}

export interface GeometryQueryCapabilities extends DirectionalBounds {
  /** Local bounding-box center, carried through geometry transforms. */
  readonly center: PointAnchor;
}

export interface Vertex
  extends PointAnchor, GeometryQueryCapabilities, VertexTopologyCapabilities {
  readonly kind: 'vertex';
  readonly id: VertexId;
}

interface LengthMeasurement {
  /** Actual arc length of this finite edge.
   * @code3d.inspect inspectLength
   */
  readonly length: number;
}

interface AreaMeasurement {
  /** Finite surface area; solids include all boundary faces.
   * @code3d.inspect inspectArea
   */
  readonly area: number;
}

interface VolumeMeasurement {
  /** Volume occupied by the solid, excluding cavities.
   * @code3d.inspect inspectVolume
   */
  readonly volume: number;
}

export interface Edge
  extends
    LineAnchor,
    GeometryQueryCapabilities,
    EdgeTopologyCapabilities,
    LengthMeasurement {
  readonly kind: 'edge';
  readonly id: EdgeId;
  readonly start: PointAnchor;
  readonly midpoint: PointAnchor;
  readonly end: PointAnchor;
}

export interface Surface
  extends
    FaceAnchor,
    GeometryQueryCapabilities,
    SurfaceTopologyCapabilities,
    AreaMeasurement {
  readonly kind: 'surface';
  readonly id: SurfaceId;
}

export interface Solid
  extends
    Anchor<'frame'>,
    GeometryQueryCapabilities,
    SurfaceTopologyCapabilities,
    AreaMeasurement,
    VolumeMeasurement {
  readonly kind: 'solid';
}

export type ElementSources = Readonly<Record<string, Anchor>>;
export type NamedElements = Readonly<Record<string, Anchor>>;

export type ExposedValue<Value> = Value extends {
  readonly [modelKind]: infer Kind;
  readonly [modelNamedElements]: infer Elements;
}
  ? (Kind extends 'solid'
      ? Solid
      : Kind extends 'face'
        ? Surface
        : Kind extends 'edge'
          ? Edge
          : Kind extends 'vertex'
            ? Vertex
            : Kind extends 'group'
              ? Anchor<'frame'> & DirectionalBounds
              : Anchor) &
      Elements
  : Value extends Anchor
    ? Value
    : never;

export type ExposedElements<Sources extends ElementSources> = Readonly<{
  [Name in keyof Sources]: ExposedValue<Sources[Name]>;
}>;

export type MergedElements<
  Existing extends NamedElements,
  Added extends NamedElements,
> = Omit<Existing, keyof Added> & Added;

export type ModelElementKind<Kind extends ModelKind> = Kind extends 'face'
  ? 'face'
  : Kind extends 'edge'
    ? 'line'
    : Kind extends 'vertex'
      ? 'point'
      : 'frame';

export type ModelForKind<
  Elements extends NamedElements,
  Kind extends ModelKind,
> = Kind extends 'solid'
  ? SolidModel<Elements>
  : Kind extends 'face'
    ? FaceModel<Elements>
    : Kind extends 'edge'
      ? EdgeModel<Elements>
      : Kind extends 'vertex'
        ? VertexModel<Elements>
        : Kind extends 'group'
          ? GroupModel<Elements>
          : never;

/** Tight axis-aligned bounds in the selected model coordinate frame. */
export type ModelBounds = Readonly<{
  minimum: Vec3;
  maximum: Vec3;
  size: Vec3;
}>;

export interface ModelCapabilities<
  Elements extends NamedElements,
  Kind extends ModelKind,
>
  extends Anchor<ModelElementKind<Kind>>, DirectionalBounds {
  readonly [modelKind]: Kind;
  readonly [modelNamedElements]: Elements;
  /** The same reference as frame.origin; not a point model or geometry center. */
  readonly origin: PointAnchor;
  /** Reference to the model's local zero and XYZ axes, independent of geometry. */
  readonly frame: FrameAnchor;
  /** Measure finite geometry in this model's local frame, or in relativeTo's frame. */
  bounds(relativeTo?: Model): ModelBounds;
  /** Model-origin coordinates in relativeTo's local frame, including placement. */
  position(relativeTo: Model): Vec3;
  /**
   * Place a new value represented by callback self; each constraint must involve it.
   * External model and element references retain their original identity.
   * @code3d.inspect relate.inspectCall
   * @code3d.inspect.context build relate.inspectContext
   * @code3d.inspect.closure build relate.inspectBody
   */
  relate(
    build: (
      self: ModelForKind<Elements, Kind>,
    ) => Relation | readonly Relation[],
  ): ModelForKind<Elements, Kind>;
  /** @code3d.inspect sources expose.inspectSources */
  expose<const Sources extends ElementSources>(
    sources: Sources,
  ): ModelForKind<MergedElements<Elements, ExposedElements<Sources>>, Kind>;
  /**
   * Shift the origin by this displacement: every local point becomes p - d.
   * @code3d.param dx {kind: 'length', default: 0, label: 'Origin ΔX'}
   * @code3d.param dy {kind: 'length', default: 0, label: 'Origin ΔY'}
   * @code3d.param dz {kind: 'length', default: 0, label: 'Origin ΔZ'}
   */
  originOffset(
    dx: number,
    dy: number,
    dz: number,
  ): ModelForKind<Elements, Kind>;
  /** Re-express the model with this point reference at local zero. */
  originPoint(point: PointAnchor): ModelForKind<Elements, Kind>;
  /**
   * Rotate about the current origin, in degrees, about fixed local X, Y, then Z axes.
   * @code3d.param x {kind: 'angle', default: 0, label: 'Rotate X'}
   * @code3d.param y {kind: 'angle', default: 0, label: 'Rotate Y'}
   * @code3d.param z {kind: 'angle', default: 0, label: 'Rotate Z'}
   */
  rotate(x: number, y: number, z: number): ModelForKind<Elements, Kind>;
  /**
   * Return a value with its entire material replaced, including every group descendant.
   * Capture a Three.js material at assignment, or use a CSS color for the default material.
   */
  material(material: Material | string): ModelForKind<Elements, Kind>;
}

export interface GeometryCapabilities<
  Elements extends NamedElements,
  Kind extends ModelGeometryKind,
> extends GeometryQueryCapabilities {
  /** Re-express the model with its current local bounding-box center at zero. */
  originCenter(): ModelForKind<Elements, Kind>;
  /**
   * Re-express the model with the selected vertex at local zero.
   * @code3d.param id {kind: 'vertex', label: 'Origin vertex'}
   */
  originVertex(id: VertexId): ModelForKind<Elements, Kind>;
  /** @code3d.param factor {kind: 'ratio', default: 1, label: 'Scale'} */
  scaled(factor: number): ModelForKind<Elements, Kind>;
}

export interface VertexTopologyCapabilities {
  /**
   * @code3d.param id {kind: 'vertex', label: 'Vertex'}
   * @code3d.inspect inspectTopologyReference
   */
  vertex(id: VertexId): Vertex;
  /**
   * @code3d.param ids {kind: 'vertex', label: 'Vertices', actions: [{label: 'Use all', action: 'remove-argument'}]}
   * @code3d.inspect inspectTopologyReference
   */
  vertices(ids?: readonly VertexId[]): readonly Vertex[];
}

export interface EdgeTopologyCapabilities extends VertexTopologyCapabilities {
  /**
   * @code3d.param id {kind: 'edge', label: 'Edge'}
   * @code3d.inspect inspectTopologyReference
   */
  edge(id: EdgeId): Edge;
  /**
   * @code3d.param ids {kind: 'edge', label: 'Edges', actions: [{label: 'Use all', action: 'remove-argument'}]}
   * @code3d.inspect inspectTopologyReference
   */
  edges(ids?: readonly EdgeId[]): readonly Edge[];
}

export interface SurfaceTopologyCapabilities extends EdgeTopologyCapabilities {
  /**
   * @code3d.param id {kind: 'surface', label: 'Surface'}
   * @code3d.inspect inspectTopologyReference
   */
  surface(id: SurfaceId): Surface;
  /**
   * @code3d.param ids {kind: 'surface', label: 'Surfaces', actions: [{label: 'Use all', action: 'remove-argument'}]}
   * @code3d.inspect inspectTopologyReference
   */
  surfaces(ids?: readonly SurfaceId[]): readonly Surface[];
}

export interface SolidModificationCapabilities<Elements extends NamedElements> {
  /** Subtracts all tools in one boolean operation, equivalent to cut(stock, tools). */
  /**
   * @code3d.inspect this cut.inspectReceiver
   * @code3d.inspect tools cut.inspectMethodTools
   */
  cut(tools: readonly SolidModel<{}>[]): SolidModel;
  /**
   * @code3d.param radius {kind: 'length', default: 1, label: 'Fillet radius', constraints: {exclusiveMin: 0}}
   * @code3d.param edgeIds {kind: 'edge', actions: [{label: 'Use all', action: 'remove-argument'}]}
   */
  fillet(radius: number, edgeIds?: readonly EdgeId[]): SolidModel<Elements>;
  /**
   * @code3d.param distance {kind: 'length', default: 1, label: 'Chamfer distance', constraints: {exclusiveMin: 0}}
   * @code3d.param edgeIds {kind: 'edge', actions: [{label: 'Use all', action: 'remove-argument'}]}
   */
  chamfer(distance: number, edgeIds?: readonly EdgeId[]): SolidModel<Elements>;
  /**
   * Hollow a solid with uniform walls. Positive thickness offsets inward;
   * negative thickness offsets outward. Selected surfaces become openings.
   * Omit the selection, or use [], for a fully enclosed cavity.
   * @code3d.param thickness {kind: 'length', default: 1, label: 'Wall thickness'}
   * @code3d.param removedSurfaceIds {kind: 'surface', label: 'Openings', actions: [{label: 'Close all openings', action: 'remove-argument'}]}
   */
  shell(
    thickness: number,
    removedSurfaceIds?: readonly SurfaceId[],
  ): SolidModel<Elements>;
}

export type Model<Elements extends NamedElements = {}> = ModelCapabilities<
  Elements,
  ModelKind
> &
  Elements;

export type GroupModel<Elements extends NamedElements = {}> = ModelCapabilities<
  Elements,
  'group'
> &
  Elements;

export type VertexModel<Elements extends NamedElements = {}> =
  ModelCapabilities<Elements, 'vertex'> &
    GeometryCapabilities<Elements, 'vertex'> &
    VertexTopologyCapabilities &
    Elements;

export type EdgeModel<Elements extends NamedElements = CurveElements> =
  ModelCapabilities<Elements, 'edge'> &
    GeometryCapabilities<Elements, 'edge'> &
    EdgeTopologyCapabilities &
    LengthMeasurement & {reverse(): Edge} & Elements;

export type FaceModel<Elements extends NamedElements = PlanarElements> =
  ModelCapabilities<Elements, 'face'> &
    GeometryCapabilities<Elements, 'face'> &
    SurfaceTopologyCapabilities &
    AreaMeasurement & {
      flip(): Surface;
      /**
       * @code3d.inspect this thicken.inspectMethod
       * @code3d.inspect thickness thicken.inspectMethod
       * @code3d.param thickness {kind: 'length', default: 1, label: 'Thickness'}
       */
      thicken(thickness: number): SolidModel;
      /**
       * Extrudes along the face's local plane normal. Signed distance; no recentering.
       * @code3d.inspect this extrude.inspectMethod
       * @code3d.inspect distance extrude.inspectMethod
       * @code3d.param distance {kind: 'length', default: 10, label: 'Extrusion distance'}
       */
      extrude(distance: number): SolidModel;
      /**
       * Rotate this face about a straight directed axis.
       * @code3d.inspect axis revolve.inspectMethodAxis
       * @code3d.inspect config revolve.inspectMethodProfile
       * @code3d.param config.angle {kind: 'angle', default: 360, label: 'Revolution angle'}
       * @code3d.param config.advance {kind: 'length', default: 0, label: 'Axial advance'}
       */
      revolve(axis: LineAnchor, config: RevolveConfig): SolidModel;
      /**
       * Sweep this face along an open curve beginning at its local origin.
       * @code3d.inspect this sweep.inspectMethodProfile
       * @code3d.inspect spine sweep.inspectMethodSpine
       */
      sweep(spine: EdgeModel<{}>): SolidModel;
    } & Elements;

/** Core parameters for rotational and screw-motion solids. */
export type RevolveConfig = Readonly<{
  angle: number;
  advance?: number;
}>;

export type SolidModel<Elements extends NamedElements = CanonicalElements> =
  ModelCapabilities<Elements, 'solid'> &
    GeometryCapabilities<Elements, 'solid'> &
    SurfaceTopologyCapabilities &
    SolidModificationCapabilities<Elements> &
    AreaMeasurement &
    VolumeMeasurement &
    Elements;

type RuntimeModel<
  Elements extends NamedElements,
  Kind extends ModelKind,
> = ModelObject<Elements, Kind> & Elements;

export type CanonicalElements = Readonly<{
  center: PointAnchor;
  axis: LineAnchor;
}>;

export type PlanarElements = Readonly<{
  center: PointAnchor;
  plane: FaceAnchor;
}>;

export type CurveElements = Readonly<{
  start: PointAnchor;
  midpoint: PointAnchor;
  end: PointAnchor;
}>;

class ModelAnchor<
  Kind extends ElementKind = ElementKind,
> implements Anchor<Kind> {
  declare readonly [anchorKind]: Kind;
  readonly elementKind: Kind;

  readonly [anchorReferenceValue]: AnchorReference;

  constructor(reference: AnchorReference) {
    this[anchorReferenceValue] = reference;
    this.elementKind = this[anchorReferenceValue].kind as Kind;
    for (const [name, member] of Object.entries(reference.members ?? {})) {
      const pointMember = ['center', 'start', 'midpoint', 'end'].includes(name);
      if (
        name in this &&
        !pointMember &&
        !(name === 'id' && reference.topology?.selection.kind === 'solid')
      ) {
        throw new Error(
          `The exposed member ${name} conflicts with the topology API.`,
        );
      }
      Object.defineProperty(this, name, {
        value: modelAnchor(
          reference.model,
          `${reference.name}.${name}`,
          member,
        ),
      });
    }
  }

  get up(): Bound {
    return directionalBound(this[anchorReferenceValue], 'up');
  }
  get down(): Bound {
    return directionalBound(this[anchorReferenceValue], 'down');
  }
  get left(): Bound {
    return directionalBound(this[anchorReferenceValue], 'left');
  }
  get right(): Bound {
    return directionalBound(this[anchorReferenceValue], 'right');
  }
  get front(): Bound {
    return directionalBound(this[anchorReferenceValue], 'front');
  }
  get back(): Bound {
    return directionalBound(this[anchorReferenceValue], 'back');
  }

  flip(): this {
    const ref = this[anchorReferenceValue];
    const facing = -(ref.bound?.facing ?? ref.facing ?? 1) as 1 | -1;
    return modelAnchor(ref.model, ref.name, {
      ...ref,
      facing,
      bound: ref.bound ? {...ref.bound, facing} : undefined,
    }) as this;
  }

  reverse(): this {
    const ref = this[anchorReferenceValue];
    return modelAnchor(ref.model, ref.name, {
      ...ref,
      direction: -(ref.direction ?? 1) as 1 | -1,
    }) as this;
  }
}

class ModelFrameAnchor extends ModelAnchor<'frame'> implements FrameAnchor {
  readonly [coordinateFrame] = true;
  readonly origin: PointAnchor;

  constructor(reference: AnchorReference) {
    super(reference);
    this.origin = modelAnchor(reference.model, `${reference.name}.origin`, {
      kind: 'point',
      transform: reference.transform,
    });
  }
}

class ModelTopologyElement extends ModelAnchor {
  get kind(): TopologySelection['kind'] {
    return this.#topology.selection.kind;
  }
  get id(): TopologyId | undefined {
    const selection = this.#topology.selection;
    return selection.kind === 'solid' ? undefined : selection.id;
  }
  get #topology(): StoredTopology {
    return this[anchorReferenceValue].topology!;
  }

  get center(): PointAnchor {
    const geometry = this.#topology.source[modelGeometry]()!;
    return this.#pointAnchor(
      'center',
      topologyCenter(geometry, this.#topology.selection),
    );
  }

  /** @code3d.inspect inspectLength */
  get length(): number {
    return measureFiniteGeometry(this, 'length');
  }

  /** @code3d.inspect inspectArea */
  get area(): number {
    return measureFiniteGeometry(this, 'area');
  }

  /** @code3d.inspect inspectVolume */
  get volume(): number {
    return measureFiniteGeometry(this, 'volume');
  }

  get start(): PointAnchor {
    return this.#curvePoint('start', 0);
  }
  get midpoint(): PointAnchor {
    return this.#curvePoint('midpoint', 0.5);
  }
  get end(): PointAnchor {
    return this.#curvePoint('end', 1);
  }

  #curvePoint(name: string, parameter: number): PointAnchor {
    const geometry = this.#topology.source[modelGeometry]()!.value;
    const basis = geometry.referenceBasis;
    const element = withTopologyShape(
      basis?.shape ?? geometry.shape,
      basis?.topology ?? geometry.topology,
      this.#topology.selection,
      shape => curveAnchor(shape as ReplicadEdge, parameter),
    );
    return this.#pointAnchor(
      name,
      basis ? topologyTransform(basis, element.transform) : element.transform,
    );
  }

  #pointAnchor(name: string, transform: RigidTransform): PointAnchor {
    return modelAnchor(
      this[anchorReferenceValue].model,
      `${this[anchorReferenceValue].name}.${name}`,
      {
        kind: 'point',
        transform: topologyTransform(this.#topology, transform),
      },
    ) as PointAnchor;
  }

  vertex(id: VertexId): Vertex {
    return this.vertices([id])[0];
  }
  vertices(ids?: readonly VertexId[]): readonly Vertex[] {
    return this.#select('vertex', ids) as unknown as readonly Vertex[];
  }
  edge(id: EdgeId): Edge {
    return this.edges([id])[0];
  }
  edges(ids?: readonly EdgeId[]): readonly Edge[] {
    return this.#select('edge', ids) as unknown as readonly Edge[];
  }
  surface(id: SurfaceId): Surface {
    return this.surfaces([id])[0];
  }
  surfaces(ids?: readonly SurfaceId[]): readonly Surface[] {
    return this.#select('surface', ids) as unknown as readonly Surface[];
  }

  #select(
    kind: TopologyKind,
    ids?: readonly TopologyId[],
  ): readonly ModelTopologyElement[] {
    const geometry = this.#topology.source[modelGeometry]()!.value;
    const selected = topologyChildren(
      geometry.shape,
      geometry.topology,
      this.#topology.selection,
      kind,
      ids,
    );
    return topologyReferences(
      this[anchorReferenceValue].model,
      `${this[anchorReferenceValue].name}.`,
      this.#topology,
      kind,
      selected,
    );
  }
}

const topologyElementKinds = {
  solid: 'frame',
  vertex: 'point',
  edge: 'line',
  surface: 'face',
} as const satisfies Record<TopologySelection['kind'], ElementKind>;

export function modelElementReference(
  value: unknown,
): ModelElementReference | undefined {
  if (!(value instanceof ModelAnchor)) return undefined;
  return {
    model: value[anchorReferenceValue].model,
    name: value[anchorReferenceValue].name,
    kind: value[anchorReferenceValue].kind,
    transform: toTransform(value[anchorReferenceValue].transform),
    bound: value[anchorReferenceValue].bound,
    facing: value[anchorReferenceValue].facing ?? 1,
    direction: value[anchorReferenceValue].direction ?? 1,
  };
}

export function modelTopologyReference(
  value: unknown,
): ModelTopologyReference | undefined {
  if (!(value instanceof ModelTopologyElement)) return undefined;
  const topology = value[anchorReferenceValue].topology!;
  return {
    model: value[anchorReferenceValue].model,
    geometry: topology.source,
    transform: {
      ...topology.transform,
      scale: [topology.scale, topology.scale, topology.scale],
    },
    ...topology.selection,
  };
}

export function modelTopologyIds(
  value: unknown,
  kind: TopologyKind,
): readonly TopologyId[] | undefined {
  const topology =
    value instanceof ModelTopologyElement
      ? value[anchorReferenceValue].topology
      : undefined;
  const source = isModelObject(value)
    ? value
    : value instanceof RelationExpression
      ? value.self()
      : topology?.source;
  const geometry = isModelObject(source)
    ? source[modelGeometry]()?.value
    : undefined;
  if (!geometry) return undefined;
  return topologyChildren(
    geometry.shape,
    geometry.topology,
    topology?.selection ?? {kind: 'solid'},
    kind,
  );
}

/** Snapshot the actual referenced geometry, including an exposed group's parts. */
export function previewAnchorReference(
  value: unknown,
  direction?: 'none' | 'forward' | 'both',
):
  | Readonly<{
      model: RelationObject;
      geometries: readonly ModelObject[];
      elements: readonly ElementSnapshot[];
    }>
  | undefined {
  if (!(value instanceof ModelAnchor) && !(value instanceof ModelObject))
    return;
  const reference =
    value instanceof ModelObject
      ? {...value.exposedElement(), name: 'geometry', model: value}
      : value[anchorReferenceValue];
  const parts = reference.topology ? [reference.topology] : reference.parts;
  const snapshot = (element: StoredAnchor): readonly ElementSnapshot[] =>
    direction && direction !== 'none'
      ? [reference.model.previewElement(element, direction)]
      : snapshotElements({[reference.name]: element});
  return {
    model: reference.model,
    geometries: parts?.map(part => part.source) ?? [],
    elements: parts?.length
      ? parts.flatMap(part =>
          snapshot({
            ...reference,
            topology: part,
            members: undefined,
          }),
        )
      : snapshot({...reference, members: undefined}),
  };
}

/** Traceable placement values, including unfinished pivot and axis selections. */
export abstract class RelationExpression {
  protected constructor(
    protected readonly definition: RelationDefinition,
    protected readonly context: RelateContext | undefined,
    protected readonly relationId: string,
    previous?: RelationExpression,
    protected readonly spatialOperation?: TransformationSpatialSelection,
  ) {
    valueTraces.set(this, {
      sourceRefs: [...(previous ? valueTrace(previous).sourceRefs : [])],
      parameters: [...(previous ? valueTrace(previous).parameters : [])],
    });
  }
  /** @internal */
  attachSource(sourceRef: SourceRef): void {
    const refs = valueTrace(this).sourceRefs;
    if (
      !refs.some(
        ref =>
          ref.file === sourceRef.file &&
          ref.start === sourceRef.start &&
          ref.end === sourceRef.end,
      )
    )
      refs.push(sourceRef);
  }
  /** @internal */
  attachParameters(parameters: readonly ParameterUsage[]): void {
    appendUniqueParameters(valueTrace(this).parameters, parameters);
  }
  /** @internal */
  self(): RelationObject | undefined {
    return this.context?.self;
  }
  /** @internal */
  traceReference(): RelationTraceReference {
    if (this.definition.kind === 'transformation')
      return {
        kind: 'transformation',
        transformationId: this.relationId,
        self: this.context?.self,
      };
    return {
      kind: 'constraint',
      constraintId: this.relationId,
      source: this.definition.source.model,
      target: this.definition.target.model,
      self: this.context?.self,
    };
  }
  /** @internal */
  storeFor(model: RelationObject): StoredPlacement {
    const bind = (reference: RelationReference): RelationReference => ({
      ...reference,
      model: reference.model === model ? undefined : reference.model,
    });
    const definition = this.definition;
    if (
      definition.kind !== 'transformation' &&
      definition.source.model !== model &&
      definition.target.model !== model
    )
      throw new Error(
        'The constraint returned by relate() must involve self (the callback parameter). External model references keep their original identity.',
      );
    const stored: StoredPlacement =
      definition.kind === 'transformation'
        ? {
            kind: 'transformation',
            id: this.relationId,
            actions: definition.actions.map(action => {
              const storedAction = {
                ...action,
                ...('pivot' in action
                  ? {
                      pivot: mapSelectionReference(action.pivot, bind),
                    }
                  : {}),
              };
              valueTraces.set(storedAction, {
                sourceRefs: [...valueTrace(action).sourceRefs],
                parameters: [...valueTrace(action).parameters],
              });
              return storedAction;
            }),
          }
        : {
            ...definition,
            id: this.relationId,
            source: bind(definition.source),
            target: bind(definition.target),
          };
    valueTraces.set(stored, {
      sourceRefs: [...valueTrace(this).sourceRefs],
      parameters: [...valueTrace(this).parameters],
    });
    return stored;
  }
  /** @internal */
  preview(
    preceding: readonly RelationExpression[] = [],
  ): RelationPreview | undefined {
    if (!this.context) return undefined;
    const pivot = this.spatialOperation?.pivot;
    const selection = pivot
      ? {
          ...this.spatialOperation!,
          pivot: mapSelectionReference(pivot, reference => ({
            ...reference,
            model:
              reference.model === this.context!.self
                ? undefined
                : reference.model,
          })),
        }
      : this.spatialOperation;
    return this.context.self[previewRelation](
      this.storeFor(this.context.self),
      selection,
      preceding,
    );
  }
  /** @internal */
  continuationArguments(): [
    RelationDefinition,
    RelateContext | undefined,
    string,
    RelationExpression,
  ] {
    return [this.definition, this.context, this.relationId, this];
  }
}

export class Constraint extends RelationExpression {
  declare protected readonly definition: Exclude<
    RelationDefinition,
    {kind: 'transformation'}
  >;
  private constructor(
    definition: Exclude<RelationDefinition, {kind: 'transformation'}>,
  ) {
    super(definition, activeRelate, `constraint-${nextConstraintId++}`);
  }
  /** @internal */
  static create(
    source: AnchorReference,
    target: AnchorReference,
    kind: 'on' | 'align' = 'on',
  ): Constraint {
    if (kind === 'on')
      source.model[referenceBounds](source, identityRigidTransform);
    else if (
      (source.kind === 'frame' || target.kind === 'frame') &&
      (source.kind !== 'frame' ||
        target.kind !== 'frame' ||
        source.whole ||
        target.whole ||
        source.topology ||
        target.topology ||
        source.parts ||
        target.parts)
    )
      throw new Error(
        'align() requires compatible geometry or two coordinate frame references; select .frame on a model.',
      );
    return new Constraint({kind, source, target});
  }

  /** @internal */
  static coupleRotation(
    source: AnchorReference,
    target: AnchorReference,
    config: RotationCouplingConfig,
  ): Constraint {
    if (
      !Number.isFinite(config.ratio) ||
      config.ratio === 0 ||
      !Number.isFinite(config.phase ?? 0)
    )
      throw new Error(
        'Rotation coupling requires a finite nonzero ratio and a finite phase.',
      );
    return new Constraint({
      kind: 'coupleRotation',
      source,
      target,
      config: {...config},
    });
  }
}

/**
 * Translate the whole current model onto the directed target bound.
 * @code3d.inspect on.inspect
 * @code3d.inspect target on.inspect
 */
export function on(target: Bound): Constraint;
/**
 * Translate the selected source geometry's matching bound onto the target bound.
 * @code3d.inspect on.inspect
 * @code3d.inspect source on.inspect
 * @code3d.inspect target on.inspect
 */
export function on(source: Anchor, target: Bound): Constraint;
export function on(source: Anchor, target?: Bound): Constraint {
  if (arguments.length === 1) {
    if (!activeRelate)
      throw new Error('on(target) must be called inside a relate callback.');
    target = source as Bound;
    source = requireModelObject(
      activeRelate.self,
      'on(target) requires a current model with finite geometry.',
    );
  }
  return Constraint.create(anchorReference(source), boundReference(target!));
}

/**
 * Align underlying geometry while retaining unconstrained degrees of freedom.
 * @code3d.inspect align.inspect
 * @code3d.inspect source align.inspect
 * @code3d.inspect target align.inspect
 */
export function align(
  source: Anchor<'point' | 'line' | 'face'>,
  target: Anchor<'point' | 'line' | 'face'>,
): Constraint;
/**
 * Coincide the origins and all axes of two coordinate frames.
 * @code3d.inspect align.inspect
 * @code3d.inspect source align.inspect
 * @code3d.inspect target align.inspect
 */
export function align(source: FrameAnchor, target: FrameAnchor): Constraint;
export function align(source: Anchor, target: Anchor): Constraint {
  return Constraint.create(
    anchorReference(source),
    anchorReference(target),
    'align',
  );
}

/**
 * Couple relate's current model to another model using each model's own axis:
 * selfAngle = ratio * otherAngle + phase.
 * @code3d.tool
 * @code3d.inspect coupleRotation.inspect
 * @code3d.inspect other coupleRotation.inspect
 */
export function coupleRotation(
  other: Model<Readonly<{axis: LineAnchor}>>,
  config: RotationCouplingConfig,
): Constraint {
  if (!activeRelate)
    throw new Error(
      'coupleRotation() must be called inside a relate callback.',
    );
  return Constraint.coupleRotation(
    straightAxisReference(
      modelRotationAxis(activeRelate.self),
      'coupleRotation()',
    ),
    straightAxisReference(modelRotationAxis(other), 'coupleRotation()'),
    config,
  );
}

function modelRotationAxis(value: unknown): LineAnchor {
  const model = requireModelObject(
    value,
    'coupleRotation() requires a model with an axis.',
  );
  if (!('axis' in model))
    throw new Error('coupleRotation() requires each model to have an axis.');
  return model.axis as LineAnchor;
}

/** @internal */
export namespace coupleRotation {
  export function inspect(
    [other]: [Model<Readonly<{axis: LineAnchor}>>],
    context: InspectContext<Constraint>,
  ): InspectResult | undefined {
    const data = relate.context(context);
    return data && context.return
      ? ModelObject.inspectConstraint(
          data,
          context.return,
          modelRotationAxis(data.self),
          other.axis,
        )
      : undefined;
  }
}

/** One completed relative placement step. Array order composes transformations. */
export class Transformation extends RelationExpression {
  declare protected readonly definition: Extract<
    RelationDefinition,
    {kind: 'transformation'}
  >;
  /** @internal */
  constructor(action: TransformationAction, previous?: RelationExpression) {
    const args = previous?.continuationArguments();
    super(
      {kind: 'transformation', actions: [action]},
      args ? args[1] : activeRelate,
      args?.[2] ?? `transformation-${nextConstraintId++}`,
      previous,
      'pivot' in action ? {kind: 'rotate', pivot: action.pivot} : undefined,
    );
    valueTraces.set(action, valueTrace(this));
  }
}

/** Carries the reference selection until its independent rotation is complete. */
class TransformationRotation extends RelationExpression {
  constructor() {
    super(
      {kind: 'transformation', actions: []},
      activeRelate,
      `transformation-${nextConstraintId++}`,
    );
  }
  withRotation(
    pivot: PivotSelection,
    angles: Vec3 | number,
    previous: RelationExpression,
  ): Transformation {
    assertFiniteVector(
      'rotate',
      typeof angles === 'number' ? [angles, 0, 0] : angles,
    );
    return new Transformation({pivot, angles}, previous);
  }
}

function rotationPointReference(point: PointAnchor): AnchorReference {
  const reference = anchorReference(point);
  if (reference.kind !== 'point')
    throw new Error('pivotPoint() requires a point reference.');
  return reference;
}

function straightAxisReference(
  axis: LineAnchor,
  operation = 'axisLine()',
): AnchorReference {
  const reference = anchorReference(axis);
  if (reference.kind !== 'line')
    throw new Error(`${operation} requires an axis or straight edge.`);
  const geometry =
    reference.topology?.source[modelGeometry]()?.value ??
    (reference.whole && isModelObject(reference.model)
      ? reference.model[modelGeometry]()?.value
      : undefined);
  if (geometry) {
    const straight = reference.topology
      ? withTopologyShape(
          geometry.shape,
          geometry.topology,
          reference.topology.selection,
          shape => (shape as ReplicadEdge).geomType === 'LINE',
        )
      : (geometry.shape as ReplicadEdge).geomType === 'LINE';
    if (!straight)
      throw new Error(
        `${operation} requires a straight axis; curved edges do not define one axis.`,
      );
  }
  return reference;
}

export type Relation = Constraint | Transformation;

export class PivotRotation extends RelationExpression {
  /** @internal */
  constructor(
    protected readonly chain: TransformationRotation,
    protected readonly selection: PointSelection,
    previous?: RelationExpression,
  ) {
    super(...(previous ?? chain).continuationArguments(), {
      kind: selection.offset ? 'pivotOffset' : selection.kind,
      pivot: selection,
    });
  }
  /**
   * @code3d.inspect relate.inspectRelation
   * @code3d.param x {kind: 'angle', default: 0, label: 'Rotate X'}
   * @code3d.param y {kind: 'angle', default: 0, label: 'Rotate Y'}
   * @code3d.param z {kind: 'angle', default: 0, label: 'Rotate Z'}
   */
  rotate(x: number, y: number, z: number): Transformation;
  rotate(x = 0, y = 0, z = 0): Transformation {
    return this.chain.withRotation(this.selection, [x, y, z], this);
  }
}

export class PivotChain extends PivotRotation {
  /**
   * Offset the selected pivot along self's local axes, retaining its reference.
   * @code3d.inspect relate.inspectRelation
   * @code3d.param x {kind: 'length', default: 0, label: 'Pivot ΔX'}
   * @code3d.param y {kind: 'length', default: 0, label: 'Pivot ΔY'}
   * @code3d.param z {kind: 'length', default: 0, label: 'Pivot ΔZ'}
   */
  pivotOffset(x: number, y: number, z: number): PivotRotation;
  pivotOffset(x = 0, y = 0, z = 0): PivotRotation {
    assertFiniteVector('pivotOffset', [x, y, z]);
    return new PivotRotation(
      this.chain,
      {...this.selection, offset: [x, y, z]},
      this,
    );
  }
}

export class AxisRotation extends RelationExpression {
  /** @internal */
  constructor(
    protected readonly chain: TransformationRotation,
    protected readonly selection: AxisSelection,
    previous?: RelationExpression,
  ) {
    super(...(previous ?? chain).continuationArguments(), {
      kind: selection.offset ? 'axisOffset' : selection.kind,
      pivot: selection,
    });
  }
  /**
   * @code3d.inspect relate.inspectRelation
   * @code3d.param angle {kind: 'angle', default: 0, label: 'Rotate'}
   */
  rotate(angle: number): Transformation;
  rotate(angle = 0): Transformation {
    return this.chain.withRotation(this.selection, angle, this);
  }
}

export class AxisChain extends AxisRotation {
  /**
   * Offset the selected axis in its reference frame, retaining its direction.
   * @code3d.inspect relate.inspectRelation
   * @code3d.param x {kind: 'length', default: 0, label: 'Axis ΔX'}
   * @code3d.param y {kind: 'length', default: 0, label: 'Axis ΔY'}
   * @code3d.param z {kind: 'length', default: 0, label: 'Axis ΔZ'}
   */
  axisOffset(x: number, y: number, z: number): AxisRotation;
  axisOffset(x = 0, y = 0, z = 0): AxisRotation {
    assertFiniteVector('axisOffset', [x, y, z]);
    return new AxisRotation(
      this.chain,
      {...this.selection, offset: [x, y, z]},
      this,
    );
  }
}

function selectedAxis(
  axis: RelationReference,
  offset: Vec3 | undefined,
): RigidTransform {
  return composeTransforms(axis.transform, translation(offset ?? origin));
}

/**
 * Move the joint result along the fixed axes of its composition.
 * @code3d.inspect relate.inspectRelation
 * @code3d.param x {kind: 'length', default: 0, label: 'ΔX'}
 * @code3d.param y {kind: 'length', default: 0, label: 'ΔY'}
 * @code3d.param z {kind: 'length', default: 0, label: 'ΔZ'}
 */
export function offset(x: number, y: number, z: number): Transformation;
export function offset(x = 0, y = 0, z = 0): Transformation {
  assertFiniteVector('offset', [x, y, z]);
  return new Transformation({offset: [x, y, z]});
}
/**
 * Rotate about self's current origin and local X, Y, then Z axes.
 * @code3d.inspect relate.inspectRelation
 * @code3d.param x {kind: 'angle', default: 0, label: 'Rotate X'}
 * @code3d.param y {kind: 'angle', default: 0, label: 'Rotate Y'}
 * @code3d.param z {kind: 'angle', default: 0, label: 'Rotate Z'}
 */
export function rotate(x: number, y: number, z: number): Transformation;
export function rotate(x = 0, y = 0, z = 0): Transformation {
  assertFiniteVector('rotate', [x, y, z]);
  return new Transformation({
    pivot: {kind: 'pivot', point: origin, implicit: true},
    angles: [x, y, z],
  });
}
/**
 * Select a pivot in self's local coordinates for the next rotation.
 * @code3d.inspect relate.inspectRelation
 * @code3d.param x {kind: 'length', default: 0, label: 'Pivot X'}
 * @code3d.param y {kind: 'length', default: 0, label: 'Pivot Y'}
 * @code3d.param z {kind: 'length', default: 0, label: 'Pivot Z'}
 */
export function pivot([x, y, z]: Vec3): PivotChain;
export function pivot([x = 0, y = 0, z = 0]: Vec3 = origin): PivotChain {
  assertFiniteVector('pivot', [x, y, z]);
  return new PivotChain(new TransformationRotation(), {
    kind: 'pivot',
    point: [x, y, z],
  });
}
/**
 * @code3d.inspect relate.inspectRelation
 * @code3d.param id {kind: 'vertex', label: 'Pivot vertex'}
 */
export function pivotVertex(id: VertexId): PivotChain {
  assertTopologyId('vertex', id);
  return new PivotChain(new TransformationRotation(), {
    kind: 'pivotVertex',
    id,
  });
}
/**
 * Select a point reference as the center; rotation axes remain self local.
 * @code3d.tool
 * @code3d.inspect relate.inspectRelation
 */
export function pivotPoint(point: PointAnchor): PivotChain {
  return new PivotChain(new TransformationRotation(), {
    kind: 'pivotPoint',
    point: rotationPointReference(point),
  });
}
/**
 * @code3d.inspect relate.inspectRelation
 * @code3d.param id {kind: 'edge', label: 'Rotation edge'}
 */
export function axisEdge(id: EdgeId): AxisChain {
  assertTopologyId('edge', id);
  return new AxisChain(new TransformationRotation(), {
    kind: 'axisEdge',
    id,
  });
}
/**
 * Select a positioned axis in the composition for the next rotation.
 * @code3d.inspect relate.inspectRelation
 * @code3d.tool
 */
export function axisLine(axis: LineAnchor): AxisChain {
  return new AxisChain(new TransformationRotation(), {
    kind: 'axisLine',
    axis: straightAxisReference(axis),
  });
}

const modelGeometry = Symbol('modelGeometry');
const referenceBounds = Symbol('referenceBounds');
const referenceBoundsParts = Symbol('referenceBoundsParts');
const modelSnapshotQueries = Symbol('modelSnapshotQueries');
const previewRelation = Symbol('previewRelation');
const modelData = new WeakMap<ModelObject, ReadonlyMap<symbol, unknown>>();

/** Associate package data with a newly constructed model value. */
export function setModelData<Value>(
  model: Model,
  key: symbol,
  value: Value,
): void {
  const object = requireModelObject(
    model,
    'Model data requires a model value.',
  );
  modelData.set(
    object,
    new Map([...(modelData.get(object) ?? []), [key, value]]),
  );
}

/** Read package data retained by relation and material copies. */
export function getModelData<Value>(
  model: Model,
  key: symbol,
): Value | undefined {
  const object = requireModelObject(
    model,
    'Model data requires a model value.',
  );
  return modelData.get(object)?.get(key) as Value | undefined;
}

type RelationObjectInit = Readonly<{
  nodeId?: string;
  placements?: readonly StoredPlacement[];
  sourceRefs?: readonly SourceRef[];
  parameters?: readonly ParameterUsage[];
}>;

/** A local reference frame and its relations, independent of finite geometry. */
export abstract class RelationObject {
  readonly nodeId: string;
  /** @internal */
  abstract readonly name: string;
  protected placements: StoredPlacement[];

  protected get initialPose(): RigidTransform {
    return identityRigidTransform;
  }

  protected get constraints(): StoredConstraint[] {
    return this.placements.filter(
      (value): value is StoredConstraint => value.kind !== 'transformation',
    );
  }

  protected constructor(init: RelationObjectInit = {}) {
    this.nodeId = init.nodeId ?? `node-${nextNodeId++}`;
    this.placements = [...(init.placements ?? [])];
    valueTraces.set(this, {
      sourceRefs: [...(init.sourceRefs ?? [])],
      parameters: [...(init.parameters ?? [])],
    });
  }

  get sourceRefs(): SourceRef[] {
    return valueTrace(this).sourceRefs;
  }

  get parameters(): ParameterUsage[] {
    return valueTrace(this).parameters;
  }

  protected abstract copyRelations(init: RelationObjectInit): RelationObject;

  protected edgeReference(_id: EdgeId): RelationReference {
    throw new Error(
      'axisEdge() requires model topology. Use axisLine(lineRef) for a line reference.',
    );
  }
  private rotationAxis(pivot: AxisSelection): RelationReference {
    return pivot.kind === 'axisLine'
      ? pivot.axis
      : this.edgeReference(pivot.id);
  }
  private rotationPoint(pivot: PointSelection): Vec3 {
    return pivot.kind === 'pivot'
      ? pivot.point
      : pivot.kind === 'pivotVertex'
        ? this.vertexPosition(pivot.id)
        : pivot.point.transform.position;
  }

  protected vertexPosition(_id: VertexId): Vec3 {
    throw new Error(
      'pivotVertex() requires model topology, not a sketch reference frame. Use pivot([x, y, z]) instead.',
    );
  }

  /** @internal */
  abstract relatedObjects(): readonly RelationObject[];
  /** @internal */
  abstract toSnapshot(
    meshCache?: Map<AnyShape, RenderMesh>,
  ): ModelSnapshotObject;
  /** @internal */
  abstract attachOperationTrace(
    siteId: string,
    execution: number,
    order: number,
    sourceRef: SourceRef,
    outputIndex?: number,
  ): void;

  /** Store relations only after the complete callback has returned. */
  protected addRelations(
    build: () => Relation | readonly Relation[],
  ): readonly RelationObject[] {
    const previous = activeRelate;
    activeRelate = {self: this, inheritedPlacements: this.placements};
    let built: Relation | readonly Relation[];
    try {
      built = build();
    } finally {
      activeRelate = previous;
    }
    const relations: readonly Relation[] = Array.isArray(built)
      ? built
      : [built as Relation];
    const stored = relations.map(constraint => {
      if (
        !(constraint instanceof Constraint) &&
        !(constraint instanceof Transformation)
      )
        throw new Error(
          'relate() requires a completed Constraint or Transformation; finish the pivot or axis selector with rotate().',
        );
      return constraint.storeFor(this);
    });
    this.placements = [...this.placements, ...stored];
    const references = uniqueModels(stored.flatMap(constraintReferences));
    if (isRecordingInspection())
      captureInspectData({
        self: this,
        participants: uniqueModels([this, ...references]),
        relations: [...relations],
      } satisfies RelateInspectData);
    return references;
  }

  /** @internal Continuous constraints solve together; transformations cut the ordered prefix. */
  inspectionPoses(
    relation?: RelationExpression,
    insertion?: number,
  ): ReadonlyMap<RelationObject, RigidTransform> {
    if (insertion !== undefined) {
      const placements = this.placements.slice(0, insertion);
      if (placements.at(-1)?.kind !== 'transformation')
        while (
          placements.length < this.placements.length &&
          this.placements[placements.length].kind !== 'transformation'
        )
          placements.push(this.placements[placements.length]);
      return RelationObject.createSolveContext(
        [this],
        new Map([[this, placements]]),
      ).poses;
    }
    if (!relation) return RelationObject.createSolveContext([this]).poses;
    const reference = relation.traceReference();
    const id =
      reference.kind === 'constraint'
        ? reference.constraintId
        : reference.transformationId;
    const index = this.placements.findIndex(value => value.id === id);
    if (index < 0)
      throw new Error(
        'The inspected relation was not consumed by this relate call.',
      );
    let end = index + 1;
    if (this.placements[index].kind !== 'transformation')
      while (
        end < this.placements.length &&
        this.placements[end].kind !== 'transformation'
      )
        end++;
    return RelationObject.createSolveContext(
      [this],
      new Map([[this, this.placements.slice(0, end)]]),
    ).poses;
  }

  /** @internal Exact finite support and references in an already solved inspection stage. */
  inspectionConstraint(
    relation: RelationExpression,
    poses: ReadonlyMap<RelationObject, RigidTransform>,
  ) {
    const reference = relation.traceReference();
    if (reference.kind !== 'constraint') return undefined;
    const constraint = this.placements.find(
      value => value.id === reference.constraintId,
    );
    if (!constraint || constraint.kind === 'transformation') return undefined;
    return {
      source: constraint.source.model ?? this,
      target: constraint.target.model ?? this,
      snapshot: this.constraintSnapshot(constraint, {
        poses,
        frame: identityRigidTransform,
      }),
    };
  }

  [referenceBounds](
    reference: StoredAnchor,
    transform: RigidTransform,
  ): LocalBounds {
    if (reference.bound) {
      const frame = composeTransforms(transform, reference.transform);
      const [x, z] = reference.bound.size;
      return pointBounds(
        [-1, 1].flatMap(a =>
          [-1, 1].map(
            b =>
              composeTransforms(
                frame,
                translation([(a * x) / 2, 0, (b * z) / 2]),
              ).position,
          ),
        ),
      );
    }
    if (reference.kind === 'point') {
      const point = composeTransforms(transform, reference.transform).position;
      return [point, point];
    }
    throw new Error(
      `The reference ${reference.name} has no finite geometry. Select a model, vertex, edge, or surface for on().`,
    );
  }

  protected alignmentGeometry(reference: StoredAnchor): AlignmentGeometry {
    if (reference.kind === 'point')
      return {kind: 'point', point: reference.transform.position};
    const direction = rotateVector(
      [
        0,
        reference.kind === 'line'
          ? (reference.direction ?? 1)
          : (reference.facing ?? reference.bound?.facing ?? 1),
        0,
      ],
      reference.transform.quaternion,
    );
    return reference.kind === 'line'
      ? {kind: 'line', point: reference.transform.position, direction}
      : {kind: 'plane', point: reference.transform.position, normal: direction};
  }

  /** @internal */
  attachSource(sourceRef: SourceRef): void {
    const previous = this.sourceRefs.at(-1);
    if (
      previous?.file !== sourceRef.file ||
      previous.start !== sourceRef.start ||
      previous.end !== sourceRef.end
    ) {
      this.sourceRefs.push(sourceRef);
    }
  }

  /** @internal */
  attachParameters(parameters: readonly ParameterUsage[]): void {
    appendUniqueParameters(this.parameters, parameters);
  }

  solvePose(context: SolveContext): RigidTransform {
    return context.poses.get(this)!;
  }

  /** @internal Snapshot a reference and its authored curve directions. */
  previewElement(
    reference: StoredAnchor,
    direction: 'forward' | 'both' = 'forward',
  ): ElementSnapshot {
    const element = reference;
    const topology = element.topology;
    let arrows: readonly RigidTransform[] | undefined;
    if (reference.kind === 'line' && topology) {
      const geometry = topology.source[modelGeometry]()!.value;
      arrows = (direction === 'both' ? [1, -1] : [1]).map(sign =>
        withTopologyShape(
          geometry.shape,
          geometry.topology,
          topology.selection,
          shape => {
            const edge = shape as ReplicadEdge;
            const facing = (reference.direction ?? 1) * sign;
            const position = facing === 1 ? 1 : 0;
            const point = edge.pointAt(position),
              tangent = edge.tangentAt(position);
            try {
              return topologyTransform(
                topology,
                frameFromYAxis(
                  point.toTuple(),
                  tangent.toTuple().map(v => v * facing) as unknown as Vec3,
                ),
              );
            } finally {
              point.delete();
              tangent.delete();
            }
          },
        ),
      );
    }
    return {
      ...snapshotElements({[reference.name]: element})[0],
      arrows,
    };
  }

  private bodyActions(
    constraint: StoredTransformation,
    indices: Map<RelationObject, number>,
  ): BodyAction[] {
    return constraint.actions.map(action => {
      if ('offset' in action) return {offset: action.offset};
      const {pivot, angles} = action;
      if (isAxisSelection(pivot)) {
        const axis = this.rotationAxis(pivot);
        return axis.model
          ? {
              body: indices.get(axis.model)!,
              axis: selectedAxis(axis, pivot.offset),
              angle: (angles as number) * (axis.direction ?? 1),
            }
          : {
              axis: selectedAxis(axis, pivot.offset),
              angle: (angles as number) * (axis.direction ?? 1),
              local: axisRotation(
                selectedAxis(axis, pivot.offset),
                (angles as number) * (axis.direction ?? 1),
              ),
            };
      }
      if (pivot.kind === 'pivotPoint' && pivot.point.model)
        return {
          body: indices.get(pivot.point.model)!,
          point: pivot.point.transform.position,
          rotation: rotationAround(origin, angles as Vec3).quaternion,
          angles: angles as Vec3,
          displacement: pivot.offset ?? origin,
        };
      const frame = translation(
        addVectors(this.rotationPoint(pivot), pivot.offset ?? origin),
      );
      return {
        angles: angles as Vec3,
        local: composeTransforms(
          composeTransforms(frame, rotationAround(origin, angles as Vec3)),
          invertTransform(frame),
        ),
      };
    });
  }

  /** @internal */
  [previewRelation](
    constraint: StoredPlacement | undefined,
    selection: TransformationSpatialSelection | undefined,
    preceding: readonly RelationExpression[] = [],
    inheritedPlacements?: readonly StoredPlacement[],
  ): RelationPreview {
    // Keep inherited and sibling relations in the solve. The selected step
    // limits the placement prefix; geometry and node identity stay shared.
    let placements = [...(inheritedPlacements ?? this.placements)];
    const index = placements.findIndex(value => value.id === constraint?.id);
    if (index < 0) {
      placements.push(...preceding.map(value => value.storeFor(this)));
      if (constraint) placements.push(constraint);
    } else if (constraint) {
      placements[index] = constraint;
      let end = index + 1;
      if (constraint.kind !== 'transformation')
        while (
          end < placements.length &&
          placements[end].kind !== 'transformation'
        )
          end++;
      placements = placements.slice(0, end);
    }
    const owner = this.copyRelations({
      nodeId: this.nodeId,
      placements,
    });
    const context = RelationObject.createSolveContext([
      owner,
      ...(selection && selectionReference(selection.pivot)?.model
        ? [selectionReference(selection.pivot)!.model!]
        : []),
    ]);
    return {
      object: {
        nodeId: this.nodeId,
        compositionTransform: toTransform(owner.solvePose(context)),
        constraints: owner.constraints.map(value =>
          owner.constraintSnapshot(value, context),
        ),
        transformations: owner.transformationSnapshots(context),
        relationStages: owner.relationStageSnapshots(context),
      },
      spatial:
        selection && constraint?.kind === 'transformation'
          ? owner.relationSpatial(constraint, selection, context)
          : constraint?.kind === 'transformation' &&
              constraint.actions.at(-1) &&
              'offset' in constraint.actions.at(-1)!
            ? owner.transformationOffsetSpatial(constraint, context)
            : undefined,
    };
  }

  private relationSpatial(
    constraint: StoredTransformation,
    selection: TransformationSpatialSelection,
    context: SolveContext,
    actionIndex?: number,
  ): RelationSpatialReference {
    context = this.placementStageContext(constraint, context);
    const models = [...context.poses.keys()];
    const actions = this.placementActions(constraint, context);
    const stage =
      actionIndex ??
      (selection.kind === 'rotate'
        ? constraint.actions.length -
          1 -
          [...constraint.actions]
            .reverse()
            .findIndex(action => 'angles' in action)
        : actions.length);
    const finalPose = this.solvePose(context);
    const following = this.followingActions(constraint, context);
    const before = beforeTransformations(
      beforeTransformations(
        finalPose,
        {actions: following},
        models.map(model => model.solvePose(context)),
      ),
      {
        actions: actions.slice(stage),
      },
      models.map(model => model.solvePose(context)),
    );
    const pivot = selection.pivot;
    const axis = isAxisSelection(pivot) ? this.rotationAxis(pivot) : undefined;
    let frame: RigidTransform;
    if (axis) {
      frame = composeTransforms(
        axis.model ? axis.model.solvePose(context) : before,
        (axis.direction ?? 1) === 1
          ? selectedAxis(axis, pivot.offset)
          : composeTransforms(
              selectedAxis(axis, pivot.offset),
              rotation([1, 0, 0, 0]),
            ),
      );
    } else if (pivot.kind === 'pivotPoint' && pivot.point.model) {
      const center = composeTransforms(
        pivot.point.model.solvePose(context),
        pivot.point.transform,
      ).position;
      frame = {
        position: addVectors(
          center,
          rotateVector(pivot.offset ?? origin, before.quaternion),
        ),
        quaternion: before.quaternion,
      };
    } else {
      const local = translation(
        addVectors(
          this.rotationPoint(pivot as PointSelection),
          pivot.offset ?? origin,
        ),
      );
      frame = composeTransforms(before, local);
    }
    const selected = constraint.actions[stage];
    const angles = selected && 'angles' in selected ? selected.angles : origin;
    const rotationVector: Vec3 =
      typeof angles === 'number' ? [0, angles, 0] : angles;
    // Later world-space actions move the earlier rotation's effective frame.
    // Later self-local actions already follow that rotation.
    const poses = models.map(model => model.solvePose(context));
    let actionPose = afterTransformations(
      before,
      {actions: actions.slice(stage, stage + 1)},
      poses,
    );
    const remainder = [...actions.slice(stage + 1), ...following];
    for (const action of remainder) {
      const next = afterTransformations(
        actionPose,
        {
          actions: [action],
        },
        poses,
      );
      if ('body' in action)
        frame = composeTransforms(
          composeTransforms(next, invertTransform(actionPose)),
          frame,
        );
      else if ('offset' in action) {
        frame = {
          ...frame,
          position: addVectors(
            frame.position,
            addVectors(next.position, negateVector(actionPose.position)),
          ),
        };
      }
      actionPose = next;
    }
    const localFrame = relativeTransform(frame, finalPose);
    return {
      nodeId: this.nodeId,
      kind: selection.kind,
      spatial: {
        origin: localFrame.position,
        vector:
          selection.kind === 'rotate'
            ? rotationVector
            : selection.kind === 'pivotOffset' ||
                selection.kind === 'axisOffset'
              ? (pivot.offset ?? origin)
              : pivot.kind === 'pivot'
                ? pivot.point
                : origin,
        frame: localFrame,
        rotation: rotationVector,
        axisOnly: isAxisSelection(pivot),
        reference: {
          ...(pivot.kind === 'axisEdge' || pivot.kind === 'pivotVertex'
            ? {kind: pivot.kind, id: pivot.id}
            : pivot.kind === 'axisLine' || pivot.kind === 'pivotPoint'
              ? {
                  kind: pivot.kind,
                  nodeId:
                    selectionReference(pivot)!.model?.nodeId ?? this.nodeId,
                  name: selectionReference(pivot)!.name,
                }
              : {kind: pivot.kind, point: pivot.point}),
          offset: pivot.offset ?? origin,
          offsetExplicit: pivot.offset !== undefined,
          explicit: !pivot.implicit,
          rotation:
            axis && (axis.direction ?? 1) !== 1
              ? [0, -rotationVector[1], 0]
              : rotationVector,
          frame:
            axis && (axis.direction ?? 1) !== 1
              ? composeTransforms(localFrame, rotation([1, 0, 0, 0]))
              : localFrame,
        },
      },
    };
  }

  private placementActions(
    value: StoredTransformation,
    context: SolveContext,
  ): BodyAction[] {
    const indices = new Map(
      [...context.poses.keys()].map((model, i) => [model, i]),
    );
    return this.bodyActions(value, indices).map(action =>
      'offset' in action
        ? {offset: rotateVector(action.offset, context.frame.quaternion)}
        : action,
    );
  }

  /** Pose at the end of this segment; later constraints have their own input pose. */
  private placementStageContext(
    placement: StoredPlacement,
    context: SolveContext,
  ): SolveContext {
    const index = this.placements.indexOf(placement);
    let end = index + 1;
    if (placement.kind !== 'transformation')
      while (
        end < this.placements.length &&
        this.placements[end].kind !== 'transformation'
      )
        end++;
    while (
      end < this.placements.length &&
      this.placements[end].kind === 'transformation'
    )
      end++;
    if (end >= this.placements.length) return context;
    return transformSolveContext(
      RelationObject.createSolveContext(
        [this],
        new Map([[this, this.placements.slice(0, end)]]),
      ),
      context.frame,
    );
  }

  private followingActions(
    placement: StoredPlacement,
    context: SolveContext,
  ): BodyAction[] {
    let start = this.placements.indexOf(placement) + 1;
    if (placement.kind !== 'transformation')
      while (
        start < this.placements.length &&
        this.placements[start].kind !== 'transformation'
      )
        start++;
    const values: StoredTransformation[] = [];
    while (
      start < this.placements.length &&
      this.placements[start].kind === 'transformation'
    )
      values.push(this.placements[start++] as StoredTransformation);
    return values.flatMap(value => this.placementActions(value, context));
  }

  protected relationStageSnapshots(
    context: SolveContext,
  ): readonly RelationStageSnapshot[] | undefined {
    if (!this.placements.length) return undefined;
    const stages: RelationStageSnapshot[] = [];
    let start = 0;
    while (start < this.placements.length) {
      let end = start;
      while (
        end < this.placements.length &&
        this.placements[end].kind !== 'transformation'
      )
        end++;
      while (
        end < this.placements.length &&
        this.placements[end].kind === 'transformation'
      )
        end++;
      const values = this.placements.slice(start, end);
      const stage = this.placementStageContext(values[0], context);
      stages.push({
        constraintIds: values
          .filter(value => value.kind !== 'transformation')
          .map(value => value.id),
        transformationIds: values
          .filter(value => value.kind === 'transformation')
          .map(value => value.id),
        compositionTransform: toTransform(this.solvePose(stage)),
        offsetFrame: toTransform(stage.frame),
      });
      start = end;
    }
    return stages;
  }

  protected transformationSnapshots(
    context: SolveContext,
  ): readonly TransformationSnapshot[] | undefined {
    const values = this.placements.filter(
      (value): value is StoredTransformation => value.kind === 'transformation',
    );
    if (!values.length) return undefined;
    return values.map(value =>
      this.transformationSnapshot(
        value,
        this.placementStageContext(value, context),
      ),
    );
  }

  private followingReferenceFrame(
    frame: RigidTransform,
    actions: readonly BodyAction[],
    context: SolveContext,
  ): RigidTransform {
    const models = [...context.poses.keys()];
    const poses = models.map(model => model.solvePose(context));
    let pose = beforeTransformations(this.solvePose(context), {actions}, poses);
    for (const action of actions) {
      const next = afterTransformations(pose, {actions: [action]}, poses);
      if ('body' in action)
        frame = composeTransforms(
          composeTransforms(next, invertTransform(pose)),
          frame,
        );
      pose = next;
    }
    return frame;
  }

  private transformationSnapshot(
    value: StoredTransformation,
    context: SolveContext,
  ): TransformationSnapshot {
    const models = [...context.poses.keys()];
    const actions = this.placementActions(value, context);
    const following = this.followingActions(value, context);
    const offsets = value.actions.flatMap((action, index) => {
      if (!('offset' in action)) return [];
      const frame = this.followingReferenceFrame(
        context.frame,
        [...actions.slice(index + 1), ...following],
        context,
      );
      return [
        {
          value: action.offset,
          frame: toTransform(frame),
          sourceRefs: valueTrace(action).sourceRefs,
        },
      ];
    });
    const rotations = value.actions.flatMap((action, index) =>
      'pivot' in action
        ? [
            {
              spatial: this.relationSpatial(
                value,
                {kind: 'rotate', pivot: action.pivot},
                context,
                index,
              ).spatial,
              sourceRefs: valueTrace(action).sourceRefs,
            },
          ]
        : [],
    );
    return {
      id: value.id,
      offsets,
      rotations,
      offsetFrame: toTransform(context.frame),
      sourceRefs: [...valueTrace(value).sourceRefs],
      parameters: [...valueTrace(value).parameters],
    };
  }

  private transformationOffsetSpatial(
    value: StoredTransformation,
    context: SolveContext,
  ): RelationSpatialReference {
    const offset = this.transformationSnapshot(value, context).offsets.at(-1)!;
    const local = relativeTransform(
      {...offset.frame, position: this.solvePose(context).position},
      this.solvePose(context),
    );
    return {
      nodeId: this.nodeId,
      kind: 'offset',
      spatial: {origin, vector: offset.value, frame: local},
    };
  }

  static createSolveContext(
    roots: readonly RelationObject[],
    overrides = new Map<RelationObject, readonly StoredPlacement[]>(),
  ): SolveContext {
    const models: RelationObject[] = [];
    const indices = new Map<RelationObject, number>();
    const collect = (model: RelationObject): void => {
      if (indices.has(model)) return;
      indices.set(model, models.length);
      models.push(model);
      (overrides.get(model) ?? model.placements)
        .flatMap(constraintReferences)
        .forEach(collect);
    };
    roots.forEach(collect);
    const programs = models.map(model => {
      const placements = overrides.get(model) ?? model.placements;
      let last = placements.length - 1;
      while (last >= 0 && placements[last].kind === 'transformation') last--;
      let start = last;
      while (start > 0 && placements[start - 1].kind !== 'transformation')
        start--;
      const initial =
        start > 0
          ? RelationObject.createSolveContext(
              [model],
              new Map(overrides).set(model, placements.slice(0, start)),
            ).poses.get(model)!
          : model.initialPose;
      return {
        initial,
        constraints: placements
          .slice(Math.max(0, start), last + 1)
          .filter(
            (value): value is StoredConstraint =>
              value.kind !== 'transformation',
          ),
        transformations: placements
          .slice(last + 1)
          .filter(
            (value): value is StoredTransformation =>
              value.kind === 'transformation',
          )
          .flatMap(value => model.bodyActions(value, indices)),
      };
    });
    const bodyRelation = (
      model: RelationObject,
      constraint: StoredConstraint,
    ): Body['relations'][number] =>
      constraint.kind === 'coupleRotation'
        ? {
            kind: 'coupleRotation',
            id: constraint.id,
            ...constraint.config,
            source: {
              body: indices.get(constraint.source.model ?? model)!,
              transform: constraint.source.transform,
              direction: constraint.source.direction ?? 1,
            },
            target: {
              body: indices.get(constraint.target.model ?? model)!,
              transform: constraint.target.transform,
              direction: constraint.target.direction ?? 1,
            },
          }
        : constraint.kind === 'align'
          ? constraint.source.kind === 'frame'
            ? {
                kind: 'frame',
                id: constraint.id,
                source: {
                  body: indices.get(constraint.source.model ?? model)!,
                  transform: constraint.source.transform,
                },
                target: {
                  body: indices.get(constraint.target.model ?? model)!,
                  transform: constraint.target.transform,
                },
              }
            : {
                kind: 'align',
                id: constraint.id,
                source: {
                  body: indices.get(constraint.source.model ?? model)!,
                  geometry: (
                    constraint.source.model ?? model
                  ).alignmentGeometry(constraint.source),
                  transform: constraint.source.transform,
                },
                target: {
                  body: indices.get(constraint.target.model ?? model)!,
                  geometry: (
                    constraint.target.model ?? model
                  ).alignmentGeometry(constraint.target),
                  transform: constraint.target.transform,
                },
              }
          : {
              kind: 'on',
              id: constraint.id,
              source: {
                body: indices.get(constraint.source.model ?? model)!,
                key: constraint.source.name,
                bounds: (orientation: Quaternion) =>
                  (constraint.source.model ?? model)[referenceBounds](
                    constraint.source,
                    rotation(orientation),
                  ),
              },
              target: {
                body: indices.get(constraint.target.model ?? model)!,
                transform: constraint.target.transform,
                facing: constraint.target.bound!.facing,
              },
            };
    const poses = solveBodies(
      models.map((model, index): Body => ({
        initial: programs[index].initial,
        transformations: programs[index].transformations,
        name: model.name,
        relations: programs[index].constraints.map(constraint =>
          bodyRelation(model, constraint),
        ),
        rotationInitial: model.initialPose,
        rotationProgram: () =>
          (overrides.get(model) ?? model.placements).flatMap(
            (placement): (Body['relations'][number] | BodyAction)[] =>
              placement.kind === 'transformation'
                ? model.bodyActions(placement, indices)
                : [bodyRelation(model, placement)],
          ),
      })),
    );
    return {
      poses: new Map(models.map((model, index) => [model, poses[index]])),
      frame: identityRigidTransform,
    };
  }

  protected constraintSnapshot(
    constraint: StoredConstraint,
    context: SolveContext,
  ): ConstraintSnapshot {
    const source = constraint.source.model ?? this;
    const target = constraint.target.model ?? this;
    const sourcePose = source.solvePose(context);
    const contactFrame = composeTransforms(
      target.solvePose(context),
      constraint.target.transform,
    );
    if (constraint.kind !== 'on') {
      return {
        ...constraint,
        id: constraint.id,
        source: anchorSnapshot(source, constraint.source),
        target: anchorSnapshot(target, constraint.target),
        sourceElement: source.previewElement(constraint.source),
        targetElement: target.previewElement(constraint.target),
        sourceRefs: [...valueTrace(constraint).sourceRefs],
        parameters: [...valueTrace(constraint).parameters],
      };
    }
    const orientation = composeTransforms(
      invertTransform(rotation(contactFrame.quaternion)),
      rotation(sourcePose.quaternion),
    ).quaternion;
    const bounds = source[referenceBounds](
      constraint.source,
      rotation(orientation),
    );
    const center: Vec3 = [
      (bounds[0][0] + bounds[1][0]) / 2,
      bounds[constraint.target.bound!.facing === 1 ? 0 : 1][1],
      (bounds[0][2] + bounds[1][2]) / 2,
    ];
    const sourceFrame = relativeTransform(
      {
        position: addVectors(
          sourcePose.position,
          rotateVector(center, contactFrame.quaternion),
        ),
        quaternion: contactFrame.quaternion,
      },
      sourcePose,
    );
    const sourceSize: Vec3 = [
      bounds[1][0] - bounds[0][0],
      bounds[1][1] - bounds[0][1],
      bounds[1][2] - bounds[0][2],
    ];
    return {
      id: constraint.id,
      kind: constraint.kind,
      source: anchorSnapshot(source, constraint.source),
      target: anchorSnapshot(target, constraint.target),
      sourceBounds: {
        size: sourceSize,
        transform: toTransform(
          composeTransforms(sourceFrame, {
            position: [
              0,
              (constraint.target.bound!.facing * sourceSize[1]) / 2,
              0,
            ],
            quaternion: [0, 0, 0, 1],
          }),
        ),
      },
      sourceElement: {
        name: `${constraint.source.name}:bound`,
        kind: 'face',
        transform: toTransform(sourceFrame),
        bound: {
          size: [sourceSize[0], sourceSize[2]],
          facing: constraint.target.bound!.facing === 1 ? -1 : 1,
        },
      },
      targetElement: {
        name: constraint.target.name,
        kind: 'face',
        transform: toTransform(constraint.target.transform),
        bound: constraint.target.bound,
      },
      sourceRefs: [...valueTrace(constraint).sourceRefs],
      parameters: [...valueTrace(constraint).parameters],
    };
  }
}

/** Plane-only spatial value used by sketches before a B-Rep face exists. */
export class SketchFrame extends RelationObject {
  readonly name = 'Sketch';
  readonly plane: FaceAnchor;
  private readonly source?: SketchFrame;
  private readonly operation = storedOperation('sketch');

  constructor(
    source?: SketchFrame,
    init: RelationObjectInit = {},
    private readonly retainedPose?: RigidTransform,
  ) {
    super({
      placements: source?.placements,
      sourceRefs: source?.sourceRefs,
      parameters: source?.parameters,
      ...init,
    });
    this.source = source;
    this.plane = modelAnchor(this, 'plane', {
      kind: 'face',
      transform: identityRigidTransform,
    }) as FaceAnchor;
  }

  protected override get initialPose(): RigidTransform {
    return (
      this.retainedPose ?? this.source?.initialPose ?? identityRigidTransform
    );
  }

  /** Snapshot the plane's placement without retaining its mutable relation program. */
  retained(pose: RigidTransform): SketchFrame {
    return new SketchFrame(undefined, {sourceRefs: this.sourceRefs}, pose);
  }

  protected copyRelations(init: RelationObjectInit): SketchFrame {
    return new SketchFrame(this, init);
  }

  relatedObjects(): readonly RelationObject[] {
    return [
      ...(this.source ? [this.source] : []),
      ...this.placements.flatMap(constraintReferences),
    ];
  }

  attachOperationTrace(
    siteId: string,
    execution: number,
    order: number,
    sourceRef: SourceRef,
    outputIndex = 0,
  ): void {
    if (!operationTraces.has(this.operation))
      operationTraces.set(this.operation, {
        siteId,
        execution,
        order,
        sourceRef,
        outputIndex,
      });
  }

  toSnapshot(): ModelSnapshotObject {
    const {siteId, execution, order, sourceRef} =
      operationTraces.get(this.operation) ?? {};
    return {
      ...this.snapshot(),
      kind: 'reference',
      name: this.name,
      children: [],
      transform: toTransform(identityRigidTransform),
      elements: snapshotElements({
        plane: {kind: 'face', transform: identityRigidTransform},
      }),
      origin,
      sourceRefs: [...this.sourceRefs],
      parameters: [...this.parameters],
      operation: {
        id: storedOperationId(this.operation),
        siteId,
        execution,
        order,
        sourceRef,
        kind: 'sketch',
        outputNodeId: this.nodeId,
        inputs: this.relatedObjects().map((model, index) => ({
          nodeId: model.nodeId,
          role: 'reference',
          index,
        })),
        selections: [],
      },
    };
  }

  relate(
    build: (frame: SketchFrame) => Relation | readonly Relation[],
  ): SketchFrame {
    const related = new SketchFrame(this);
    related.addRelations(() => build(related));
    return related;
  }

  face(region: SketchRegion): FaceModel {
    return sketchFaceModel(region, this.placements, this);
  }

  snapshot(): RelationPreview['object'] {
    const context = RelationObject.createSolveContext([this]);
    return {
      nodeId: this.nodeId,
      compositionTransform: toTransform(this.solvePose(context)),
      constraints: this.constraints.map(constraint =>
        this.constraintSnapshot(constraint, context),
      ),
      transformations: this.transformationSnapshots(context),
      relationStages: this.relationStageSnapshots(context),
    };
  }

  /** Related finite models, expressed in this sketch's local editing plane. */
  context(): readonly Readonly<{nodeId: string; transform: Transform}>[] {
    const context = RelationObject.createSolveContext([this]);
    const frame = this.solvePose(context);
    return [...context.poses].flatMap(([object, pose]) =>
      object instanceof ModelObject
        ? [
            {
              nodeId: object.nodeId,
              transform: toTransform(relativeTransform(pose, frame)),
            },
          ]
        : [],
    );
  }
}

export class ModelObject<
  Elements extends NamedElements = {},
  Kind extends ModelKind = ModelKind,
>
  extends RelationObject
  implements Anchor<ModelElementKind<Kind>>
{
  declare readonly [anchorKind]: ModelElementKind<Kind>;
  declare readonly [modelKind]: Kind;
  declare readonly [modelNamedElements]: Elements;
  /** @internal */
  readonly elementKind: ModelElementKind<Kind>;
  /** @internal */
  readonly kind: Kind;
  /** @internal */
  readonly name: string;
  /** @internal */
  private readonly materialSnapshot?: ModelMaterialSnapshot;
  /** @internal */
  readonly children: readonly ModelObject[];
  private readonly geometry?: ModelGeometry;
  private readonly assembly?: SolveContext;
  private readonly meshTolerance: number;
  private readonly geometryAnchor: StoredElement;
  private readonly elements: StoredElements;
  private readonly operation: StoredOperation;
  #frame?: FrameAnchor;

  /** @internal */
  [modelGeometry](): ModelGeometry | undefined {
    return this.geometry;
  }

  private constructor(init: ModelObjectInit<Kind>) {
    super(init);
    if (init.kind !== 'group' && !init.geometry) {
      throw new Error(
        'A geometric model object must contain an OpenCascade shape.',
      );
    }
    this.kind = init.kind;
    this.elementKind = modelElementKinds[
      init.kind
    ] as unknown as ModelElementKind<Kind>;
    this.geometry = init.geometry;
    this.geometryAnchor = init.geometryAnchor ?? {
      kind: this.elementKind,
      transform: identityRigidTransform,
    };
    this.meshTolerance = init.meshTolerance ?? 0.2;
    this.name = init.name ?? defaultModelNames[init.kind];
    this.materialSnapshot = init.material;
    this.children = init.children ?? [];
    this.assembly =
      init.assembly ??
      (this.kind === 'group'
        ? ModelObject.createAssembly(this.children)
        : undefined);
    this.operation = init.operation;
    const elements =
      init.elements ??
      (this.kind === 'solid' && this.geometry
        ? solidElements(this.geometry.value.localBounds)
        : {});
    this.elements = this.geometry
      ? {
          center: {
            kind: 'point',
            transform: translation(
              boundsCenter(this.geometry.value.localBounds),
            ),
          },
          ...elements,
        }
      : elements;
    for (const [name, element] of Object.entries(this.elements)) {
      if (name in this) {
        throw new Error(
          `The element name ${name} conflicts with the model API.`,
        );
      }
      Object.defineProperty(this, name, {
        value: modelAnchor(this, name, element),
      });
    }
  }

  /** @internal */
  static create<
    Elements extends NamedElements = {},
    Kind extends ModelKind = ModelKind,
  >(init: ModelObjectInit<Kind>): ModelObject<Elements, Kind> {
    return new ModelObject<Elements, Kind>(init);
  }

  /** @code3d.inspect inspectLength */
  get length(): number {
    return measureFiniteGeometry(this, 'length');
  }

  /** @code3d.inspect inspectArea */
  get area(): number {
    return measureFiniteGeometry(this, 'area');
  }

  /** @code3d.inspect inspectVolume */
  get volume(): number {
    return measureFiniteGeometry(this, 'volume');
  }

  get origin(): PointAnchor {
    return this.frame.origin;
  }

  get frame(): FrameAnchor {
    return (this.#frame ??= new ModelFrameAnchor({
      model: this,
      name: 'frame',
      kind: 'frame',
      transform: identityRigidTransform,
    }));
  }

  get up(): Bound {
    return directionalBound(this.relationAnchorReference(), 'up');
  }
  get down(): Bound {
    return directionalBound(this.relationAnchorReference(), 'down');
  }
  get left(): Bound {
    return directionalBound(this.relationAnchorReference(), 'left');
  }
  get right(): Bound {
    return directionalBound(this.relationAnchorReference(), 'right');
  }
  get front(): Bound {
    return directionalBound(this.relationAnchorReference(), 'front');
  }
  get back(): Bound {
    return directionalBound(this.relationAnchorReference(), 'back');
  }

  /** @internal */
  relationAnchorReference(): AnchorReference {
    return {model: this, name: 'geometry', ...this.geometryAnchor, whole: true};
  }

  reverse(): Edge {
    return this.edges()[0].reverse();
  }
  flip(): Surface {
    return this.surfaces()[0].flip();
  }

  relate(
    build: (
      self: RuntimeModel<Elements, Kind>,
    ) => Relation | readonly Relation[],
  ): RuntimeModel<Elements, Kind> {
    const operation = storedOperation('relate', [
      {model: this, role: 'source', index: 0},
    ]);
    const related = this.copy({}, operation);
    const references = related.addRelations(() => build(related));
    operation.inputs.push(
      ...references.map((model, index) => ({
        model,
        role: 'reference' as const,
        index,
      })),
    );
    return related;
  }

  expose<const Sources extends ElementSources>(
    sources: Sources,
  ): RuntimeModel<MergedElements<Elements, ExposedElements<Sources>>, Kind> {
    const entries = Object.entries(sources);
    captureInspectData(entries);
    const elements = this.localElements(entries.map(([, source]) => source));
    const exposed = Object.fromEntries(
      entries.map(([name], index) => [name, elements[index]]),
    );
    const references = entries.map(
      ([, source]) => anchorReference(source).model,
    );
    const operation = storedOperation('expose', [
      {model: this, role: 'source', index: 0},
      ...uniqueModels(references)
        .filter(model => model !== this)
        .map((model, index) => ({
          model,
          role: 'reference' as const,
          index,
        })),
    ]);
    return this.copy(
      {elements: {...this.elements, ...exposed}},
      operation,
    ) as unknown as RuntimeModel<
      MergedElements<Elements, ExposedElements<Sources>>,
      Kind
    >;
  }

  /**
   * Measure finite geometry in this model's local frame, or in relativeTo's frame.
   * An explicit reference includes solved placement and nested group occurrences.
   * Empty groups have no finite bounds.
   */
  bounds(relativeTo?: Model): ModelBounds {
    const target =
      relativeTo === undefined
        ? this
        : requireModelObject(relativeTo, 'bounds requires a reference model.');
    const transform = target.localFrames([this])[0];
    const [minimum, maximum] = this[referenceBounds](
      this.relationAnchorReference(),
      transform,
    );
    return {
      minimum,
      maximum,
      size: [
        maximum[0] - minimum[0],
        maximum[1] - minimum[1],
        maximum[2] - minimum[2],
      ],
    };
  }

  /**
   * Model-origin coordinates in relativeTo's local frame, including placement.
   * This model's origin in its own frame is always [0, 0, 0], even for point models.
   */
  position(relativeTo: Model): Vec3 {
    const target = requireModelObject(
      relativeTo,
      'position requires a reference model.',
    );
    return target.localFrames([this])[0].position;
  }

  /** Resolve source frames without losing nested occurrence positions. */
  private localFrames(sources: readonly RelationObject[]): RigidTransform[] {
    const members = this.memberPoses();
    const external = sources.filter(model => !members.has(model));
    const context = external.length
      ? ModelObject.createSolveContext([this, ...external])
      : undefined;
    return sources.map(source => {
      const memberPose = members.get(source);
      if (memberPose === null)
        throw new Error(
          "The point or element belongs to multiple occurrences. Expose it through the intended child model's named reference.",
        );
      return (
        memberPose ??
        relativeTransform(source.solvePose(context!), this.solvePose(context!))
      );
    });
  }

  /** Resolve both own and occurrence references into this model's local frame. */
  private localElements(sources: readonly Anchor[]): StoredElement[] {
    const references = sources.map(anchorReference);
    const transforms = this.localFrames(
      references.map(reference => reference.model),
    );
    return sources.map((source, index) => {
      const {kind, transform, topology, parts, members, bound, facing} =
        source instanceof ModelObject
          ? source.exposedElement()
          : references[index];
      return transformElement(
        {kind, transform, topology, parts, members, bound, facing},
        transforms[index],
      );
    });
  }

  vertex(id: VertexId): Vertex {
    return this.vertices([id])[0];
  }
  vertices(ids?: readonly VertexId[]): readonly Vertex[] {
    return this.selectTopology('vertex', ids) as unknown as readonly Vertex[];
  }
  edge(id: EdgeId): Edge {
    return this.edges([id])[0];
  }
  edges(ids?: readonly EdgeId[]): readonly Edge[] {
    return this.selectTopology('edge', ids) as unknown as readonly Edge[];
  }
  surface(id: SurfaceId): Surface {
    return this.surfaces([id])[0];
  }
  surfaces(ids?: readonly SurfaceId[]): readonly Surface[] {
    return this.selectTopology('surface', ids) as unknown as readonly Surface[];
  }

  private selectTopology(
    kind: TopologyKind,
    ids?: readonly TopologyId[],
  ): readonly ModelTopologyElement[] {
    const geometry = this.requireGeometry().value;
    const selected = topologyChildren(
      geometry.shape,
      geometry.topology,
      {kind: 'solid'},
      kind,
      ids,
    );
    return topologyReferences(
      this,
      '',
      {source: this, transform: identityRigidTransform, scale: 1},
      kind,
      selected,
    );
  }

  /** @internal */
  exposedElement(): StoredElement {
    if (this.kind === 'group')
      return {
        ...this.geometryAnchor,
        parts: this.geometryParts(),
        members: this.elements,
      };
    const geometry = this.requireGeometry().value;
    const kind = (
      this.kind === 'face' ? 'surface' : this.kind
    ) as TopologySelection['kind'];
    const selection: TopologySelection =
      kind === 'solid'
        ? {kind}
        : {
            kind,
            id: geometry.topology[
              kind === 'surface'
                ? 'surfaces'
                : kind === 'edge'
                  ? 'edges'
                  : 'vertices'
            ].ids[0],
          };
    const context = {
      source: this,
      transform: identityRigidTransform,
      scale: 1,
    };
    const anchor =
      selection.kind === 'solid'
        ? this.geometryAnchor
        : topologyReferences(this, '', context, selection.kind, [
            selection.id,
          ])[0][anchorReferenceValue];
    return {
      kind: anchor.kind,
      transform: anchor.transform,
      members: this.elements,
      topology: {
        ...context,
        selection,
      },
    };
  }

  material(material: Material | string): RuntimeModel<Elements, Kind> {
    return this.copy(
      {material: captureModelMaterial(material)},
      storedOperation('material', [{model: this, role: 'source', index: 0}]),
    );
  }

  originOffset(
    dx: number,
    dy: number,
    dz: number,
  ): RuntimeModel<Elements, Kind>;
  originOffset(dx = 0, dy = 0, dz = 0): RuntimeModel<Elements, Kind> {
    const offset: Vec3 = [dx, dy, dz];
    assertFiniteVector('originOffset', offset);
    return this.withOrigin(offset, {kind: 'originOffset'});
  }

  originPoint(point: PointAnchor): RuntimeModel<Elements, Kind> {
    const reference = anchorReference(point);
    if (reference.kind !== 'point')
      throw new Error('originPoint() requires a point reference.');
    const [element] = this.localElements([point]);
    return this.withOrigin(element.transform.position, {
      kind: 'originPoint',
      model: reference.model,
    });
  }

  originVertex(id: VertexId): RuntimeModel<Elements, Kind> {
    const geometry = this.requireGeometry().value;
    const [{position}] = topologyVertexPoints(
      geometry.shape,
      geometry.topology.vertices,
      [id],
    );
    return this.withOrigin(position, {kind: 'originVertex', id});
  }

  originCenter(): RuntimeModel<Elements, Kind> {
    const position = boundsCenter(this.requireGeometry().value.localBounds);
    return this.withOrigin(position, {kind: 'originCenter'});
  }

  /** Resolve an array as one layout in the first member's frame, retaining its shape kinds. */
  static centerOrigins(models: readonly ModelObject[]): readonly ModelObject[] {
    if (models.length === 0) return [];
    if (models.length === 1) return [models[0].originCenter()];
    const context = this.createAssembly(models);
    const center = boundsCenter(
      combineBounds(
        models.map(model => {
          model.requireGeometry();
          return model[referenceBounds](
            model.relationAnchorReference(),
            model.solvePose(context),
          );
        }),
      ),
    );
    const shift = translation(negateVector(center));
    const results: ModelObject[] = [];
    try {
      for (const model of models) {
        const operation = storedOperation(
          'originCenter',
          models.map((input, index) => ({
            model: input,
            role: input === model ? 'source' : 'operand',
            index,
          })),
        );
        operation.spatial = {origin, vector: center};
        results.push(
          model.transformed(
            composeTransforms(shift, model.solvePose(context)),
            operation,
            [],
          ),
        );
      }
      return results;
    } catch (error) {
      disposeModelObjects(results);
      throw error;
    }
  }

  private withOrigin(
    offset: Vec3,
    selection:
      | {kind: 'originOffset' | 'originCenter'}
      | {kind: 'originVertex'; id: VertexId}
      | {kind: 'originPoint'; model: RelationObject},
  ): RuntimeModel<Elements, Kind> {
    const transform = translation(negateVector(offset));
    const operation = storedOperation(selection.kind, [
      {model: this, role: 'source', index: 0},
    ]);
    if (selection.kind === 'originPoint' && selection.model !== this)
      operation.inputs.push({
        model: selection.model,
        role: 'reference',
        index: 0,
      });
    operation.spatial = {origin, vector: offset};
    if (selection.kind === 'originVertex') {
      operation.selections.push({
        kind: 'vertex',
        input: this,
        ids: [selection.id],
        transform,
      });
    }
    return this.transformed(transform, operation);
  }

  rotate(x: number, y: number, z: number): RuntimeModel<Elements, Kind>;
  rotate(x = 0, y = 0, z = 0): RuntimeModel<Elements, Kind> {
    const angles: Vec3 = [x, y, z];
    assertFiniteVector('rotate', angles);
    const operation = storedOperation('rotate', [
      {model: this, role: 'source', index: 0},
    ]);
    operation.spatial = {origin, vector: angles};
    return this.transformed(rotationAround(origin, angles), operation);
  }

  private transformed(
    transform: RigidTransform,
    operation: StoredOperation,
    placements?: readonly StoredPlacement[],
  ): RuntimeModel<Elements, Kind> {
    const overrides: Partial<ModelObjectInit<Kind>> = {
      geometryAnchor: transformElement(this.geometryAnchor, transform),
      elements: Object.fromEntries(
        Object.entries(this.elements).map(([name, element]) => [
          name,
          transformElement(element, transform),
        ]),
      ),
      placements:
        placements ??
        this.mapConstraintGeometry(
          element => transformElement(element, transform),
          point => composeTransforms(transform, translation(point)).position,
        ),
    };
    if (this.assembly)
      return this.copy(
        {
          ...overrides,
          assembly: transformSolveContext(this.assembly, transform),
        },
        operation,
      );
    const source = this.requireGeometry();
    const geometry = evaluateModelGeometry(
      'transform',
      [transform.position, transform.quaternion],
      [source],
      () => {
        const shape = shapeWithTransform(source.value.shape, transform);
        try {
          return {
            shape,
            topology: preserveShapeTopology(shape, source.value.topology),
            referenceBasis: transformedReferenceBasis(source, transform, 1),
          };
        } catch (error) {
          shape.delete();
          throw error;
        }
      },
    );
    return this.copyWithGeometry(geometry, overrides, operation);
  }

  private mapConstraintGeometry(
    mapElement: (element: StoredElement) => StoredElement,
    mapPoint: (point: Vec3) => Vec3,
  ): StoredPlacement[] {
    const mapReference = (reference: RelationReference): RelationReference =>
      reference.model ? reference : {...reference, ...mapElement(reference)};
    const zero = mapPoint(origin);
    const mapVector = (vector: Vec3): Vec3 =>
      mapPoint(vector).map(
        (value, index) => value - zero[index],
      ) as unknown as Vec3;
    const scale = Math.hypot(...mapVector([1, 0, 0]));
    return this.placements.map(constraint => {
      const mapped: StoredPlacement = {
        ...constraint,
        ...(constraint.kind === 'transformation'
          ? {}
          : {
              source: mapReference(constraint.source),
              target: mapReference(constraint.target),
            }),
        ...(constraint.kind === 'transformation'
          ? {
              actions: constraint.actions.map(action => {
                if ('offset' in action) return action;
                const mappedAction = {
                  ...action,
                  pivot:
                    action.pivot.kind === 'pivot'
                      ? {...action.pivot, point: mapPoint(action.pivot.point)}
                      : mapSelectionReference(action.pivot, mapReference),
                };
                if (action.pivot.offset) {
                  mappedAction.pivot = {
                    ...mappedAction.pivot,
                    offset: isAxisSelection(action.pivot)
                      ? selectionReference(action.pivot)?.model
                        ? action.pivot.offset
                        : (action.pivot.offset.map(
                            value => value * scale,
                          ) as unknown as Vec3)
                      : mapVector(action.pivot.offset),
                  };
                }
                valueTraces.set(mappedAction, valueTrace(action));
                return mappedAction;
              }),
            }
          : {}),
      };
      valueTraces.set(mapped, valueTrace(constraint));
      return mapped;
    });
  }

  scaled(factor: number): RuntimeModel<Elements, Kind>;
  scaled(factor = 1): RuntimeModel<Elements, Kind> {
    assertPositive('scale', factor);
    const source = this.requireGeometry();
    const geometry = evaluateModelGeometry('scaled', [factor], [source], () => {
      const shape = shapeWithScale(source.value.shape, factor);
      try {
        return {
          shape,
          topology: preserveShapeTopology(shape, source.value.topology),
          referenceBasis: transformedReferenceBasis(
            source,
            identityRigidTransform,
            factor,
          ),
        };
      } catch (error) {
        shape.delete();
        throw error;
      }
    });
    return this.copyWithGeometry(
      geometry,
      {
        geometryAnchor: scaleElement(this.geometryAnchor, factor),
        elements: scaleElements(this.elements, factor),
        placements: this.mapConstraintGeometry(
          element => scaleElement(element, factor),
          point => scaleFrame(translation(point), factor).position,
        ),
      },
      storedOperation('scaled', [{model: this, role: 'source', index: 0}]),
    );
  }

  /** @internal Wrap the batch in the first profile's resolved coordinate frame. */
  static wrapProfiles(
    profiles: readonly ModelObject<{}, 'face'>[],
    target: Surface | FaceModel<{}>,
    options: WrapOptions,
  ): readonly FaceModel<{}>[] {
    if (!profiles.length) return [];
    const tolerance = options.tolerance ?? 0.001;
    assertPositive('wrap tolerance', tolerance);
    const first = profiles[0],
      source = first.requireGeometry();
    if ((source.value.shape as ReplicadFace).geomType !== 'PLANE')
      throw new Error('wrap requires planar source profiles.');
    let reference = anchorReference(target);
    if (reference.whole && isModelObject(reference.model))
      reference = {
        ...reference,
        ...reference.model.exposedElement(),
        whole: false,
      };
    const topology = reference.topology;
    if (!topology || topology.selection.kind !== 'surface')
      throw new Error('wrap requires one finite target surface.');
    const context = this.createSolveContext([...profiles, reference.model]);
    this.recordCompositionInspection(context, []);
    const pose = first.solvePose(context);
    const frame = first.geometryAnchor.transform;
    const sources = profiles.map(profile => profile.requireGeometry());
    const transforms = profiles.map(profile =>
      composeTransforms(
        invertTransform(frame),
        relativeTransform(profile.solvePose(context), pose),
      ),
    );
    const targetTransform = composeTransforms(
      invertTransform(frame),
      relativeTransform(
        composeTransforms(
          reference.model.solvePose(context),
          topology.transform,
        ),
        pose,
      ),
    );
    const targetGeometry = topology.source.requireGeometry();
    const combined = evaluateModelGeometry(
      'wrap',
      [
        transforms.map(t => [t.position, t.quaternion]),
        targetTransform.position,
        targetTransform.quaternion,
        topology.selection.id,
        topology.scale,
        reference.facing ?? 1,
        tolerance,
      ],
      [...sources, targetGeometry],
      () => {
        const faces: ReplicadFace[] = [];
        try {
          sources.forEach((s, i) =>
            faces.push(
              shapeWithTransform(s.value.shape as ReplicadFace, transforms[i]),
            ),
          );
          return withTransformedGeometry(
            targetGeometry.value,
            {
              transform: targetTransform,
              scale: topology.scale,
              selection: topology.selection,
            },
            selected => {
              let face = selected as ReplicadFace;
              if (reference.facing === -1)
                face = castOwnedShape(
                  selected.wrapped.Reversed(),
                ) as ReplicadFace;
              try {
                const wrapped = wrapFaces(faces, face, tolerance);
                try {
                  return {shape: shapeWithTransform(wrapped, frame)};
                } finally {
                  wrapped.delete();
                }
              } finally {
                if (face !== selected) face.delete();
              }
            },
          );
        } finally {
          faces.forEach(face => face.delete());
        }
      },
    );
    const outputs: ModelObject<{}, 'face'>[] = [];
    try {
      for (const id of combined.value.topology.surfaces.ids) {
        const geometry = evaluateModelGeometry(
          'wrap-face',
          [id],
          [combined],
          () =>
            withTopologyShape(
              combined.value.shape,
              combined.value.topology,
              {kind: 'surface', id},
              shape => ({shape: shape.clone()}),
            ),
        );
        const planar =
          (geometry.value.shape as ReplicadFace).geomType === 'PLANE'
            ? (faceGeometry(geometry.value.shape as ReplicadFace, 1) as Extract<
                AlignmentGeometry,
                {kind: 'plane'}
              >)
            : undefined;
        const result = ModelObject.create<{}, 'face'>({
          kind: 'face',
          name: 'Wrap',
          geometry,
          geometryAnchor: {
            kind: 'face',
            transform: planar
              ? composeTransforms(
                  {
                    position: planar.point,
                    quaternion: surfaceRotation(
                      rotateVector([0, 1, 0], frame.quaternion),
                      planar.normal,
                    ),
                  },
                  {position: [0, 0, 0], quaternion: frame.quaternion},
                )
              : identityRigidTransform,
          },
          material: first.materialSnapshot,
          placements: first.placements,
          sourceRefs: [
            ...profiles.flatMap(profile => profile.sourceRefs),
            ...reference.model.sourceRefs,
          ],
          parameters: uniqueParameters([
            ...profiles.flatMap(profile => profile.allParameters()),
            ...topology.source.allParameters(),
          ]),
          meshTolerance: Math.min(
            ...profiles.map(profile => profile.meshTolerance),
            topology.source.meshTolerance,
          ),
          operation: storedOperation('wrap', [
            ...profiles.map((model, index) => ({
              model,
              role: 'section' as const,
              index,
            })),
            {model: reference.model, role: 'reference', index: profiles.length},
          ]),
        });
        outputs.push(result);
      }
      this.recordCompositionInspection(
        context,
        outputs.map(result => [result, first]),
      );
      return outputs as unknown as readonly FaceModel<{}>[];
    } finally {
      combined.value.shape.delete();
    }
  }

  thicken(this: ModelObject<Elements, 'face'>, thickness = 1): SolidModel {
    if (!Number.isFinite(thickness) || thickness === 0)
      throw new Error('thicken thickness must be finite and non-zero.');
    ModelObject.recordFaceResults([this], []);
    const source = this.requireGeometry();
    const geometry = evaluateSolidGeometry(
      'thicken',
      [thickness],
      [source],
      () =>
        thickenWithTopology(
          {
            shape: source.value.shape,
            topology: source.value.topology,
            namespace: 1,
          },
          thickness,
        ),
    );
    const result = ModelObject.create<CanonicalElements, 'solid'>({
      kind: 'solid',
      name: 'Thicken',
      geometry,
      material: this.materialSnapshot,
      placements: this.placements,
      sourceRefs: this.sourceRefs,
      parameters: this.allParameters(),
      meshTolerance: this.meshTolerance,
      operation: storedOperation('thicken', [
        {model: this, role: 'receiver', index: 0},
      ]),
    });
    ModelObject.recordFaceResults([this], [result]);
    return result as unknown as SolidModel;
  }

  extrude(this: ModelObject<Elements, 'face'>, distance: number): SolidModel;
  extrude(this: ModelObject<Elements, 'face'>, distance = 10): SolidModel {
    if (this.kind !== 'face')
      throw new Error('extrude requires a single face model.');
    ModelObject.recordFaceResults([this], []);
    if (!Number.isFinite(distance) || distance === 0)
      throw new Error('Extrusion distance must be finite and non-zero.');
    const source = this.requireGeometry();
    if ((source.value.shape as ReplicadFace).geomType !== 'PLANE')
      throw new Error(
        'extrude requires a planar face; use thicken for curved faces.',
      );
    const planar = faceGeometry(
      source.value.shape as ReplicadFace,
      1,
    ) as Extract<AlignmentGeometry, {kind: 'plane'}>;
    const direction = planar.normal.map(
      value => value * distance,
    ) as unknown as Vec3;
    const geometry = evaluateSolidGeometry(
      'extrude',
      [direction],
      [source],
      () =>
        extrudeWithTopology(
          {
            shape: source.value.shape,
            topology: source.value.topology,
            namespace: 1,
          },
          direction,
        ),
    );
    const result = ModelObject.create<CanonicalElements, 'solid'>({
      kind: 'solid',
      name: 'Extrude',
      geometry,
      material: this.materialSnapshot,
      placements: this.placements,
      sourceRefs: this.sourceRefs,
      parameters: this.allParameters(),
      meshTolerance: this.meshTolerance,
      operation: storedOperation(
        'extrude',
        [{model: this, role: 'receiver', index: 0}],
        {
          dimensions: {
            distance: {
              origin: this.elements.center.transform.position,
              vector: direction,
            },
          },
        },
      ),
    });
    ModelObject.recordFaceResults([this], [result]);
    return result as unknown as SolidModel;
  }

  revolve(
    this: ModelObject<Elements, 'face'>,
    axis: LineAnchor,
    config: RevolveConfig = {angle: 360},
  ): SolidModel {
    if (this.kind !== 'face')
      throw new Error('revolve requires a single face model.');
    if (
      (this.requireGeometry().value.shape as ReplicadFace).geomType !== 'PLANE'
    )
      throw new Error('revolve requires a planar face.');
    const {angle = 360, advance = 0} = config;
    if (!Number.isFinite(angle) || angle === 0)
      throw new Error('Revolution angle must be finite and non-zero.');
    if (!Number.isFinite(advance))
      throw new Error('Revolution advance must be finite.');
    if (advance === 0 && Math.abs(angle) > 360)
      throw new Error('A revolution without advance cannot exceed one turn.');
    const axisReference = straightAxisReference(axis, 'revolve() axis');
    const context = ModelObject.createSolveContext([this, axisReference.model]);
    const facePose = this.solvePose(context);
    const axisFrame = relativeTransform(
      composeTransforms(
        axisReference.model.solvePose(context),
        axisReference.transform,
      ),
      facePose,
    );
    const direction = rotateVector(
      [0, axisReference.direction ?? 1, 0],
      axisFrame.quaternion,
    );
    const source = this.requireGeometry();
    const axisModel = isModelObject(axisReference.model)
      ? axisReference.model
      : undefined;
    ModelObject.recordCompositionInspection(context, []);
    const geometry = evaluateSolidGeometry(
      'revolve',
      [axisFrame.position, direction, angle, advance],
      [source],
      () =>
        revolveWithTopology(
          {
            shape: source.value.shape,
            topology: source.value.topology,
            namespace: 1,
          },
          axisFrame.position,
          direction,
          angle,
          advance,
        ),
    );
    const result = ModelObject.create<CanonicalElements, 'solid'>({
      kind: 'solid',
      name: 'Revolve',
      geometry,
      material: this.materialSnapshot,
      placements: this.placements,
      sourceRefs: [...this.sourceRefs, ...(axisModel?.sourceRefs ?? [])],
      parameters: uniqueParameters([
        ...this.allParameters(),
        ...(axisModel?.allParameters() ?? []),
      ]),
      meshTolerance: this.meshTolerance,
      operation: storedOperation('revolve', [
        {model: this, role: 'receiver', index: 0},
        ...(axisModel
          ? [{model: axisModel, role: 'reference' as const, index: 1}]
          : []),
      ]),
    });
    ModelObject.recordCompositionInspection(context, [[result, this]]);
    return result as unknown as SolidModel;
  }

  sweep(this: ModelObject<Elements, 'face'>, spine: EdgeModel<{}>): SolidModel {
    if (this.kind !== 'face')
      throw new Error('sweep requires a single face model.');
    const path = requireModelKind(
      spine,
      'edge',
      'sweep requires an edge model as its spine.',
    );
    const context = ModelObject.createSolveContext([this, path]);
    const profilePose = this.solvePose(context);
    const pathTransform = relativeTransform(
      path.solvePose(context),
      profilePose,
    );
    const source = this.requireGeometry();
    const pathGeometry = path.requireGeometry();
    if ((source.value.shape as ReplicadFace).geomType !== 'PLANE')
      throw new Error('sweep requires a planar face.');
    const planar = faceGeometry(
      source.value.shape as ReplicadFace,
      1,
    ) as Extract<AlignmentGeometry, {kind: 'plane'}>;
    const normal = planar.normal;
    ModelObject.recordCompositionInspection(context, []);
    const geometry = evaluateSolidGeometry(
      'sweep',
      [pathTransform.position, pathTransform.quaternion, normal],
      [source, pathGeometry],
      () => {
        const positionedPath = shapeWithTransform(
          pathGeometry.value.shape as ReplicadEdge,
          pathTransform,
        );
        try {
          return sweepWithTopology(
            {
              shape: source.value.shape,
              topology: source.value.topology,
              namespace: 1,
            },
            positionedPath,
            normal,
          );
        } finally {
          positionedPath.delete();
        }
      },
    );
    const result = ModelObject.create<CanonicalElements, 'solid'>({
      kind: 'solid',
      name: 'Sweep',
      geometry,
      material: this.materialSnapshot,
      placements: this.placements,
      sourceRefs: [...this.sourceRefs, ...path.sourceRefs],
      parameters: uniqueParameters([
        ...this.allParameters(),
        ...path.allParameters(),
      ]),
      meshTolerance: Math.min(this.meshTolerance, path.meshTolerance),
      operation: storedOperation('sweep', [
        {model: this, role: 'receiver', index: 0},
        {model: path, role: 'spine', index: 1},
      ]),
    });
    ModelObject.recordCompositionInspection(context, [[result, this]]);
    return result as unknown as SolidModel;
  }

  cut(
    this: ModelObject<Elements, 'solid'>,
    tools: readonly SolidModel<{}>[],
  ): SolidModel {
    return cut(this as unknown as SolidModel<{}>, tools);
  }

  fillet(
    this: ModelObject<Elements, 'solid'>,
    radius: number,
    edgeIds?: readonly EdgeId[],
  ): SolidModel<Elements>;
  fillet(
    this: ModelObject<Elements, 'solid'>,
    radius = 1,
    edgeIds?: readonly EdgeId[],
  ): SolidModel<Elements> {
    assertPositive('radius', radius);
    const source = this.requireSolidGeometry();
    const selectedEdgeIds = resolveEdgeSelection(
      source.value.topology.edges,
      edgeIds,
    );
    const geometry = evaluateSolidGeometry(
      'fillet',
      [radius, selectedEdgeIds],
      [source],
      () => {
        const result = filletEdges(
          source.value.shape,
          source.value.topology,
          radius,
          selectedEdgeIds,
        );
        return {shape: result.shape, topology: result.topology};
      },
    );
    return this.copyWithGeometry(
      geometry,
      {},
      storedOperation('fillet', [{model: this, role: 'source', index: 0}], {
        selections: [
          {
            kind: 'edge',
            input: this,
            ids: selectedEdgeIds,
            transform: identityRigidTransform,
          },
        ],
      }),
    ) as unknown as SolidModel<Elements>;
  }

  chamfer(
    this: ModelObject<Elements, 'solid'>,
    distance: number,
    edgeIds?: readonly EdgeId[],
  ): SolidModel<Elements>;
  chamfer(
    this: ModelObject<Elements, 'solid'>,
    distance = 1,
    edgeIds?: readonly EdgeId[],
  ): SolidModel<Elements> {
    assertPositive('distance', distance);
    const source = this.requireSolidGeometry();
    const selectedEdgeIds = resolveEdgeSelection(
      source.value.topology.edges,
      edgeIds,
    );
    const geometry = evaluateSolidGeometry(
      'chamfer',
      [distance, selectedEdgeIds],
      [source],
      () => {
        const result = chamferEdges(
          source.value.shape,
          source.value.topology,
          distance,
          selectedEdgeIds,
        );
        return {shape: result.shape, topology: result.topology};
      },
    );
    return this.copyWithGeometry(
      geometry,
      {},
      storedOperation('chamfer', [{model: this, role: 'source', index: 0}], {
        selections: [
          {
            kind: 'edge',
            input: this,
            ids: selectedEdgeIds,
            transform: identityRigidTransform,
          },
        ],
      }),
    ) as unknown as SolidModel<Elements>;
  }

  shell(
    this: ModelObject<Elements, 'solid'>,
    thickness: number,
    removedSurfaceIds?: readonly SurfaceId[],
  ): SolidModel<Elements>;
  shell(
    this: ModelObject<Elements, 'solid'>,
    thickness = 1,
    removedSurfaceIds: readonly SurfaceId[] = [],
  ): SolidModel<Elements> {
    if (!Number.isFinite(thickness) || thickness === 0) {
      throw new Error('thickness must be a nonzero finite number.');
    }
    const source = this.requireSolidGeometry();
    const selectedIds = resolveTopologySelection(
      'surface',
      source.value.topology.surfaces,
      removedSurfaceIds,
    );
    const geometry = evaluateSolidGeometry(
      'shell',
      [thickness, selectedIds],
      [source],
      () =>
        shellWithTopology(
          source.value.shape,
          source.value.topology,
          thickness,
          selectedIds,
        ),
    );
    return this.copyWithGeometry(
      geometry,
      {},
      storedOperation('shell', [{model: this, role: 'source', index: 0}], {
        selections: [
          {
            kind: 'surface',
            input: this,
            ids: selectedIds,
            transform: identityRigidTransform,
          },
        ],
      }),
    ) as unknown as SolidModel<Elements>;
  }

  /** @internal */
  attachOperationTrace(
    siteId: string,
    execution: number,
    order: number,
    sourceRef: SourceRef,
    outputIndex = 0,
  ): void {
    if (operationTraces.has(this.operation)) {
      return;
    }
    operationTraces.set(this.operation, {
      siteId,
      execution,
      order,
      sourceRef,
      outputIndex,
    });
  }

  /** @internal */
  relatedObjects(): readonly RelationObject[] {
    return [
      ...this.children,
      ...this.operation.inputs.map(input => input.model),
      ...this.placements.flatMap(constraintReferences),
    ];
  }

  /** @internal */
  toSnapshot(
    meshCache: Map<AnyShape, RenderMesh> = new Map(),
  ): ModelSnapshotObject {
    const solveContext = ModelObject.createSolveContext([this]);
    return this.snapshotNode(meshCache, solveContext);
  }

  private snapshotNode(
    meshCache: Map<AnyShape, RenderMesh>,
    solveContext: SolveContext,
    inComposition = false,
    overrideMaterial?: ModelMaterialSnapshot,
  ): ModelSnapshotObject {
    const material = overrideMaterial ?? this.materialSnapshot;
    const pose = this.solvePose(solveContext);
    const constraints = this.constraints.map(constraint =>
      this.constraintSnapshot(constraint, solveContext),
    );
    const parameters = uniqueParameters([
      ...this.parameters,
      ...this.placements.flatMap(
        constraint => valueTrace(constraint).parameters,
      ),
    ]);
    const common = {
      nodeId: this.nodeId,
      sourceNodeId: ModelObject.inspectionSources.get(this)?.nodeId,
      kind: this.kind,
      name: this.name,
      material,
      compositionTransform: toTransform(pose),
      transform: toTransform(inComposition ? pose : identityRigidTransform),
      constraints,
      transformations: this.transformationSnapshots(solveContext),
      relationStages: this.relationStageSnapshots(solveContext),
      origin,
      elements: snapshotElements({
        ...this.elements,
        ...(this.geometry || this.children.length
          ? Object.fromEntries(
              Object.keys(boundDirections).map(direction => [
                direction,
                anchorReference(this[direction as keyof DirectionalBounds]),
              ]),
            )
          : {}),
      }),
      sourceRefs: [...this.sourceRefs],
      parameters,
      operation: this.operationSnapshot(),
    } as const;

    if (this.kind === 'group') {
      const childContext = this.assembly!;
      return {
        ...common,
        children: this.children.map(child =>
          child.snapshotNode(meshCache, childContext, true, material),
        ),
      };
    }

    const geometry = this.requireGeometry();
    return {
      ...common,
      children: [],
      mesh: renderMesh(
        geometry,
        geometry.value.shape,
        meshCache,
        this.meshTolerance,
        geometry.value.topology,
      ),
    };
  }

  /** @internal */
  disposeShape(disposed: Set<AnyShape>): void {
    const shapes = [
      ...(this.geometry ? [this.geometry.value.shape] : []),
      ...(this.geometry?.value.referenceBasis
        ? [this.geometry.value.referenceBasis.shape]
        : []),
    ];
    for (const shape of shapes) {
      if (!disposed.has(shape)) {
        disposed.add(shape);
        shape.delete();
      }
    }
    this.children.forEach(child => child.disposeShape(disposed));
  }

  /** @internal */
  [loftModels](
    this: ModelObject<Elements, 'face'>,
    others: readonly ModelObject<{}, 'face'>[],
    spine: ModelObject<{}, 'edge'> | undefined,
    ruled: boolean,
  ): SolidModel {
    const sections: readonly ModelObject<{}, 'face'>[] = [this, ...others];
    const solveContext = ModelObject.createSolveContext([
      ...sections,
      ...(spine ? [spine] : []),
    ]);
    const resultPose = this.solvePose(solveContext);
    ModelObject.recordCompositionInspection(solveContext, []);
    const sectionInputs = sections.map(section => ({
      model: section,
      geometry: section.requireGeometry(),
      transform: relativeTransform(section.solvePose(solveContext), resultPose),
    }));
    const spineInput = spine
      ? {
          model: spine,
          geometry: spine.requireGeometry(),
          transform: relativeTransform(
            spine.solvePose(solveContext),
            resultPose,
          ),
        }
      : undefined;
    const geometry = evaluateSolidGeometry(
      spine ? 'spine-loft' : 'loft',
      [
        ruled,
        sectionInputs.map(input => [
          input.transform.position,
          input.transform.quaternion,
        ]),
        spineInput
          ? [spineInput.transform.position, spineInput.transform.quaternion]
          : null,
      ],
      [
        ...sectionInputs.map(input => input.geometry),
        ...(spineInput ? [spineInput.geometry] : []),
      ],
      () => buildLoftGeometry(sectionInputs, spineInput, ruled),
    );
    const inputs = [...sections, ...(spine ? [spine] : [])];
    const result = ModelObject.create<CanonicalElements, 'solid'>({
      kind: 'solid',
      name: 'Loft',
      geometry,
      material: this.materialSnapshot,
      placements: this.placements,
      sourceRefs: inputs.flatMap(input => input.sourceRefs),
      parameters: uniqueParameters(
        inputs.flatMap(input => input.allParameters()),
      ),
      meshTolerance: Math.min(...inputs.map(input => input.meshTolerance)),
      operation: storedOperation('loft', [
        {model: this, role: 'receiver', index: 0},
        ...others.map((model, index) => ({
          model,
          role: 'section' as const,
          index: index + 1,
        })),
        ...(spine
          ? [{model: spine, role: 'spine' as const, index: sections.length}]
          : []),
      ]),
    });
    ModelObject.recordCompositionInspection(solveContext, [[result, this]]);
    return result as unknown as SolidModel;
  }

  /** @internal */
  [combineModels](
    this: ModelObject<Elements, 'solid'>,
    operation: BooleanOperation,
    others: readonly ModelObject<{}, 'solid'>[],
    context?: SolveContext,
  ): SolidModel {
    const evaluation = this.evaluateBoolean(operation, others, context);
    let transferred = false;
    try {
      const combined = ModelObject.create<CanonicalElements, 'solid'>({
        kind: 'solid',
        geometryAnchor: this.geometryAnchor,
        geometry: evaluation.geometry,
        name: this.name,
        material: this.materialSnapshot,
        placements: this.placements,
        sourceRefs: [this, ...others].flatMap(model => model.sourceRefs),
        parameters: uniqueParameters(
          [this, ...others].flatMap(model => model.allParameters()),
        ),
        meshTolerance: Math.min(
          this.meshTolerance,
          ...others.map(model => model.meshTolerance),
        ),
        operation: storedOperation(operation === 'fuse' ? 'union' : operation, [
          {model: this, role: 'receiver', index: 0},
          ...others.map((model, index) => ({
            model,
            role:
              operation === 'cut' ? ('tool' as const) : ('operand' as const),
            index: index + 1,
          })),
        ]),
      });
      transferred = true;
      ModelObject.recordCompositionInspection(evaluation.context, [
        [combined, this],
      ]);
      return combined as unknown as SolidModel;
    } finally {
      if (!transferred) {
        disposeModelGeometryValue(evaluation.geometry.value);
      }
    }
  }

  private evaluateBoolean(
    this: ModelObject<Elements, 'solid'>,
    operation: BooleanOperation,
    others: readonly ModelObject<{}, 'solid'>[],
    solveContext = ModelObject.createSolveContext([this, ...others]),
  ): BooleanEvaluation {
    const targetPose = this.solvePose(solveContext);
    ModelObject.recordCompositionInspection(solveContext, []);
    let geometry = this.requireSolidGeometry();
    let temporaryGeometry: SolidGeometry | undefined;
    let evaluated = false;
    try {
      for (const [otherIndex, other] of others.entries()) {
        const otherGeometry = other.requireSolidGeometry();
        const transform = relativeTransform(
          other.solvePose(solveContext),
          targetPose,
        );
        const operand = evaluateKernelShape(
          'transform',
          [transform.position, transform.quaternion],
          [otherGeometry],
          () => shapeWithTransform(otherGeometry.value.shape, transform),
        );
        try {
          const nextGeometry = evaluateSolidGeometry(
            `boolean-${operation}`,
            [otherIndex],
            [geometry, operand],
            () => {
              const result = booleanWithTopology(
                {
                  shape: geometry.value.shape,
                  topology: geometry.value.topology,
                  namespace: otherIndex === 0 ? 1 : 'intermediate',
                },
                {
                  shape: operand.value,
                  topology: otherGeometry.value.topology,
                  namespace: otherIndex + 2,
                },
                operation,
              );
              return {shape: result.shape, topology: result.topology};
            },
          );
          temporaryGeometry?.value.shape.delete();
          temporaryGeometry = nextGeometry;
          geometry = nextGeometry;
        } finally {
          operand.value.delete();
        }
      }
      evaluated = true;
      return {geometry, context: solveContext};
    } finally {
      if (!evaluated) {
        temporaryGeometry?.value.shape.delete();
      }
    }
  }

  private allParameters(): ParameterUsage[] {
    return uniqueParameters([
      ...this.parameters,
      ...this.placements.flatMap(
        constraint => valueTrace(constraint).parameters,
      ),
    ]);
  }

  private memberPoses(): Map<RelationObject, RigidTransform | null> {
    const members = new Map<RelationObject, RigidTransform | null>([
      [this, identityRigidTransform],
    ]);
    if (this.children.length) {
      const context = this.assembly!;
      for (const child of this.children) {
        const pose = child.solvePose(context);
        for (const [member, localPose] of child.memberPoses()) {
          members.set(
            member,
            members.has(member) || localPose === null
              ? null
              : composeTransforms(pose, localPose),
          );
        }
      }
    }
    return members;
  }

  /** Finite members in this value's saved local assembly, without re-solving children. */
  private geometryParts(transform = identityRigidTransform): StoredTopology[] {
    if (this.geometry)
      return [{source: this, selection: {kind: 'solid'}, transform, scale: 1}];
    return this.children.flatMap(child =>
      child.geometryParts(
        composeTransforms(transform, child.solvePose(this.assembly!)),
      ),
    );
  }

  /** @internal */
  static distance(a: Anchor, b: Anchor, axis?: DistanceAxis): number {
    const left = anchorReference(a),
      right = anchorReference(b);
    const axisReference =
      axis !== undefined && typeof axis !== 'string' && !Array.isArray(axis)
        ? straightAxisReference(axis as LineAnchor, 'distance() axis')
        : undefined;
    const context = ModelObject.createSolveContext([
      left.model,
      right.model,
      ...(axisReference ? [axisReference.model] : []),
    ]);
    const topologyParts = (reference: AnchorReference) =>
      reference.topology
        ? [reference.topology]
        : (reference.parts ??
          (reference.whole && reference.model instanceof ModelObject
            ? reference.model.geometryParts()
            : undefined));
    const parts = (reference: AnchorReference): DistancePart[] => {
      const pose = reference.model.solvePose(context);
      const frame = composeTransforms(pose, reference.transform);
      if (reference.kind === 'point') return [{points: [frame.position]}];
      const topology = topologyParts(reference);
      if (topology)
        return topology.map(part => ({
          geometry: part.source.requireGeometry(),
          selection: part.selection,
          scale: part.scale,
          transform: composeTransforms(pose, part.transform),
        }));
      if (reference.bound) {
        const [x, z] = reference.bound.size;
        const corners: Vec3[] =
          x === 0 && z === 0
            ? [origin]
            : x === 0
              ? [
                  [0, 0, -z / 2],
                  [0, 0, z / 2],
                ]
              : z === 0
                ? [
                    [-x / 2, 0, 0],
                    [x / 2, 0, 0],
                  ]
                : [
                    [-x / 2, 0, -z / 2],
                    [x / 2, 0, -z / 2],
                    [x / 2, 0, z / 2],
                    [-x / 2, 0, z / 2],
                  ];
        return [
          {
            points: corners.map(
              point => composeTransforms(frame, translation(point)).position,
            ),
          },
        ];
      }
      throw new Error(
        'distance() requires finite geometry or a point; select an edge or face instead of an infinite axis or plane.',
      );
    };
    const first = parts(left),
      second = parts(right);
    if (!first.length || !second.length)
      throw new Error('distance() cannot measure an empty group.');
    const record = (result: DistanceResult, direction?: Vec3): number => {
      if (isRecordingInspection()) {
        captureInspectData({
          result,
          direction,
          axisName: typeof axis === 'string' ? axis : undefined,
          references: [left, right],
          poses: new Map(context.poses),
        } satisfies DistanceInspectData);
      }
      return result.value;
    };
    if (axis === undefined) {
      let result: DistanceResult | undefined;
      for (const a of first)
        for (const b of second) {
          const candidate =
            'points' in a &&
            a.points.length === 1 &&
            'points' in b &&
            b.points.length === 1
              ? {
                  value: Math.hypot(
                    ...a.points[0].map((value, i) => value - b.points[0][i]),
                  ),
                  start: a.points[0],
                  end: b.points[0],
                }
              : distanceBetweenParts(a, b).value;
          if (!result || candidate.value < result.value) result = candidate;
          if (result.value === 0) return record(result);
        }
      return record(result!);
    }
    const direction = axisReference
      ? rotateVector(
          [0, 1, 0],
          composeTransforms(
            axisReference.model.solvePose(context),
            axisReference.transform,
          ).quaternion,
        )
      : typeof axis === 'string'
        ? distanceAxes[axis]
        : (axis as Vec3);
    assertFiniteVector('distance() axis', direction);
    const magnitude = Math.hypot(...direction);
    if (magnitude === 0) throw new Error('distance() axis must be non-zero.');
    const normalized = direction.map(
      value => value / magnitude,
    ) as unknown as Vec3;
    const project = invertTransform(frameFromYAxis(origin, normalized));
    const projectedBounds = (parts: DistancePart[]): LocalBounds => {
      const bounds = parts.map(part => {
        if ('points' in part)
          return pointBounds(
            part.points.map(
              point => composeTransforms(project, translation(point)).position,
            ),
          );
        return evaluateSnapshotQuery(
          boundsQuery(
            part.geometry,
            composeTransforms(project, part.transform),
            part.selection,
            part.scale,
          ),
        ) as LocalBounds;
      });
      return [
        [0, 1, 2].map(i =>
          Math.min(...bounds.map(value => value[0][i])),
        ) as unknown as Vec3,
        [0, 1, 2].map(i =>
          Math.max(...bounds.map(value => value[1][i])),
        ) as unknown as Vec3,
      ];
    };
    const aBounds = projectedBounds(first),
      bBounds = projectedBounds(second);
    const [aMin, aMax] = [aBounds[0][1], aBounds[1][1]],
      [bMin, bMax] = [bBounds[0][1], bBounds[1][1]];
    const overlap = (Math.max(aMin, bMin) + Math.min(aMax, bMax)) / 2;
    const [start, end] =
      bMin > aMax
        ? [aMax, bMin]
        : aMin > bMax
          ? [aMin, bMax]
          : [overlap, overlap];
    // Place the axis-parallel dimension within the shared transverse bounds.
    // A point inside the other operand's projection then anchors the line at
    // that point. Disjoint bounds use the midpoint of their nearest limits;
    // projected endpoints remain reference positions for general geometry.
    const center = [0, 1, 2].map(
      i =>
        (Math.max(aBounds[0][i], bBounds[0][i]) +
          Math.min(aBounds[1][i], bBounds[1][i])) /
        2,
    );
    const unproject = invertTransform(project);
    const at = (y: number) =>
      composeTransforms(unproject, translation([center[0], y, center[2]]))
        .position;
    return record(
      {
        value: Math.max(0, bMin - aMax, aMin - bMax),
        start: at(start),
        end: at(end),
      },
      normalized,
    );
  }

  private static readonly inspectionSources = new WeakMap<
    ModelObject,
    ModelObject
  >();

  private static readonly inspectionFrames = new WeakMap<
    ReadonlyMap<RelationObject, RigidTransform>,
    InspectionFrame
  >();

  /** Retain identities across focus changes; the call owns the saved frame's lifetime. */
  private static inspectionFrame(
    poses: ReadonlyMap<RelationObject, RigidTransform>,
  ): InspectionFrame {
    const retained = this.inspectionFrames.get(poses);
    if (retained) return retained;
    // Detach placement programs; geometry and saved child assembly poses are
    // immutable. In particular relate self may acquire more relations after
    // the measurement, which must not enter this scene.
    const detached = new Map<ModelObject, ModelObject>();
    const detachElement = (element: StoredElement): StoredElement => ({
      ...element,
      topology: element.topology && {
        ...element.topology,
        source: detach(element.topology.source),
      },
      parts: element.parts?.map(part => ({
        ...part,
        source: detach(part.source),
      })),
      members:
        element.members &&
        Object.fromEntries(
          Object.entries(element.members).map(([name, member]) => [
            name,
            detachElement(member),
          ]),
        ),
    });
    const detach = (model: ModelObject): ModelObject => {
      const previous = detached.get(model);
      if (previous) return previous;
      const children = model.children.map(detach);
      const value = model.copy(
        {
          placements: [],
          children,
          assembly: model.assembly && {
            frame: model.assembly.frame,
            poses: new Map(
              model.children.map((child, index) => [
                children[index],
                model.assembly!.poses.get(child)!,
              ]),
            ),
          },
        },
        storedOperation(model.operation.kind),
      ) as ModelObject;
      detached.set(model, value);
      this.inspectionSources.set(value, model);
      return value;
    };
    const owners = new Map<RelationObject, ModelObject>();
    const owner = (model: RelationObject): ModelObject | undefined => {
      const existing = owners.get(model);
      if (existing) return existing;
      const pose = poses.get(model);
      if (!pose) return undefined;
      const child = model instanceof ModelObject ? detach(model) : undefined;
      const value = ModelObject.create({
        kind: 'group',
        name: model.name,
        children: child ? [child] : [],
        assembly: {
          frame: identityRigidTransform,
          poses: new Map(child ? [[child, pose]] : []),
        },
        operation: storedOperation('group'),
        sourceRefs: model.sourceRefs,
      });
      retainInspectionIdentity(value, model);
      owners.set(model, value);
      return value;
    };
    const positionedValues = new Map<Anchor, PreviewValue>();
    const positionedAnchors = new Map<Anchor, PreviewValue>();
    const positioned = (
      value: Anchor,
      reference = anchorReference(value),
      asAnchor = false,
    ): PreviewValue | undefined => {
      const values = asAnchor ? positionedAnchors : positionedValues;
      const previous = values.get(value);
      if (previous) return previous;
      if (asAnchor && value instanceof ModelObject)
        reference = {...reference, ...value.exposedElement(), whole: false};
      const model = owner(reference.model);
      if (!model) return undefined;
      const result =
        value instanceof ModelObject && !asAnchor
          ? (model as unknown as Model)
          : retainInspectionIdentity(
              modelAnchor(
                model,
                reference.name,
                transformElement(
                  detachElement(reference),
                  poses.get(reference.model)!,
                ),
              ),
              value,
            );
      values.set(value, result);
      return result;
    };
    const sketches = new Map<SketchFrame, PreviewValue>();
    const display = (model: RelationObject): PreviewValue | undefined => {
      if (!(model instanceof SketchFrame))
        return owner(model) as unknown as Model | undefined;
      let value = sketches.get(model);
      const pose = poses.get(model);
      if (!value && pose) {
        value = retainSketchFrame(sketchForFrame(model), pose);
        sketches.set(model, value);
      }
      return value;
    };
    const frame = {owner, positioned, display};
    this.inspectionFrames.set(poses, frame);
    return frame;
  }

  /** @internal Preserve each batch result's matching input placement. */
  static recordFaceResults(
    faces: readonly ModelObject[],
    results: readonly ModelObject[],
  ): void {
    if (!isRecordingInspection()) return;
    const context = this.createSolveContext(faces);
    this.recordCompositionInspection(
      context,
      results.map((result, index) => [result, faces[index]]),
    );
  }

  private static readonly dimensionSegments = new WeakMap<
    ModelObject,
    Map<string, readonly DimensionSegment[]>
  >();

  /** @internal Describe complete straight edges in the actual model geometry. */
  static inspectDimension(
    model: Model,
    parameter: string,
    value: number,
    owner = model,
    transform = identityRigidTransform,
    axisLabel?: string,
  ): Dimension {
    const object = model as unknown as ModelObject;
    let dimensions = this.dimensionSegments.get(object);
    if (!dimensions)
      this.dimensionSegments.set(object, (dimensions = new Map()));
    let segments = dimensions.get(parameter);
    if (!segments) {
      const definition = object.operation.dimensions![parameter];
      const length = Math.hypot(...definition.vector);
      const edges = shapeSubshapes(
        object.requireGeometry().value.shape,
        'edge',
      );
      try {
        segments = edges.flatMap(edge => {
          if (edge.geomType !== 'LINE') return [];
          const first = edge.pointAt(0),
            last = edge.pointAt(1);
          try {
            const start = first.toTuple(),
              end = last.toTuple();
            const delta = subtract(end, start);
            return Math.abs(Math.hypot(...delta) - length) <= length * 1e-5 &&
              Math.hypot(...cross(delta, definition.vector)) <=
                length * length * 1e-5
              ? [{start, end}]
              : [];
          } finally {
            first.delete();
            last.delete();
          }
        });
      } finally {
        edges.forEach(edge => edge.delete());
      }
      if (!segments.length)
        segments = [
          {
            start: definition.origin,
            end: addVectors(definition.origin, definition.vector),
          },
        ];
      dimensions.set(parameter, segments);
    }
    return dimension({
      owner,
      value,
      axisLabel,
      candidates: segments.map(segment => ({
        start: composeTransforms(transform, translation(segment.start))
          .position,
        end: composeTransforms(transform, translation(segment.end)).position,
      })),
    });
  }

  /** @internal Input and distance parameters choose their respective roles. */
  static inspectExtrude(
    faces: readonly FaceModel<{}>[],
    results: readonly SolidModel[],
    distance: number,
    parameter: string | undefined,
    data: CompositionInspectData,
  ): InspectResult {
    const input = parameter !== 'distance';
    const scene = this.inspectComposition(
      data,
      input ? results : faces,
      input ? faces : results,
    );
    if (input) return scene;
    const frame = this.inspectionFrame(data.poses);
    return {
      ...scene,
      target: [
        ...scene.target!,
        ...results.map(result =>
          this.inspectDimension(
            result,
            'distance',
            distance,
            frame.positioned(result) as Model,
            data.poses.get(result as unknown as ModelObject)!,
          ),
        ),
      ],
    };
  }

  private static recordCompositionInspection(
    context: SolveContext,
    results: readonly (readonly [ModelObject, ModelObject])[],
  ): void {
    if (!isRecordingInspection()) return;
    const poses = new Map(context.poses);
    for (const [result, input] of results)
      poses.set(result, input.solvePose(context));
    captureInspectData({poses} satisfies CompositionInspectData);
  }

  /** @internal Return ordinary values in the original operation's common frame. */
  static inspectComposition(
    data: CompositionInspectData,
    ambient: readonly Anchor[],
    target: readonly Anchor[],
  ): InspectResult {
    const frame = this.inspectionFrame(data.poses);
    return {
      ambient: ambient.map(value => frame.positioned(value)!),
      target: target.map(value => frame.positioned(value)!),
    };
  }

  /** @internal */
  static recordRevolve(
    profile: ModelObject,
    axis: LineAnchor,
    result?: ModelObject,
  ): void {
    if (!isRecordingInspection()) return;
    const reference = straightAxisReference(axis, 'revolve() axis');
    const context = this.createSolveContext([profile, reference.model]);
    this.recordCompositionInspection(
      context,
      result ? [[result, profile]] : [],
    );
  }

  /** @internal */
  static inspectRevolve(
    profile: FaceModel<{}>,
    axis: LineAnchor,
    result: SolidModel | undefined,
    data: CompositionInspectData,
    focus: 'profile' | 'axis',
  ): InspectResult {
    const frame = this.inspectionFrame(data.poses);
    const shownProfile = frame.positioned(profile)!;
    const shownAxis = anchorAnnotation(frame.positioned(axis)! as LineAnchor, {
      direction: 'forward',
    });
    const shownResult = result ? frame.positioned(result)! : undefined;
    return focus === 'axis'
      ? {
          ambient: [shownProfile, ...(shownResult ? [shownResult] : [])],
          target: [shownAxis],
        }
      : {
          ambient: [shownAxis, ...(shownResult ? [shownResult] : [])],
          target: [shownProfile],
        };
  }

  /** @internal Derive the focused cut volume using the original solved operands. */
  static inspectCutTools(
    stock: SolidModel<{}>,
    tools: readonly SolidModel<{}>[],
    focused: readonly SolidModel<{}>[],
    data: CompositionInspectData,
  ): InspectResult {
    const selected = new Set(focused);
    const scene = this.inspectComposition(
      data,
      [stock, ...tools.filter(tool => !selected.has(tool))],
      tools.filter(tool => selected.has(tool)),
    );
    if (!focused.length) return scene;
    const operands = focused as unknown as readonly ModelObject<{}, 'solid'>[];
    const poses = new Map(data.poses);
    const context = {poses, frame: identityRigidTransform};
    const tool =
      operands.length === 1
        ? operands[0]
        : (operands[0][combineModels](
            'fuse',
            operands.slice(1),
            context,
          ) as unknown as ModelObject<{}, 'solid'>);
    poses.set(tool, poses.get(operands[0])!);
    const body = stock as unknown as ModelObject<{}, 'solid'>;
    let region: SolidModel;
    try {
      region = body[combineModels]('intersect', [tool], context).material(
        inspectionRegionMaterial('#ffad4d'),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          'The inputs have no common solid volume. Adjust their positions or dimensions so they overlap.'
      )
        return scene;
      throw error;
    }
    const model = region as unknown as ModelObject;
    const frame = this.inspectionFrame(new Map([[model, poses.get(body)!]]));
    return {...scene, target: [...scene.target!, frame.positioned(region)!]};
  }

  /** @internal References use expose's recorded values and receiver-local frame. */
  static inspectExposed(
    receiver: Model,
    result: Model,
    entries: readonly (readonly [string, Anchor])[],
  ): InspectResult {
    const owner = receiver as unknown as ModelObject;
    const exposed = result as unknown as ModelObject;
    return {
      ambient: [receiver],
      target: entries.map(([name, source]) =>
        retainInspectionIdentity(
          modelAnchor(owner, name, exposed.elements[name]),
          source,
        ),
      ),
    };
  }

  /** @internal Inspect members in this group's already solved assembly frame. */
  static inspectGroup(result: GroupModel): InspectResult {
    const model = result as unknown as ModelObject;
    const frame = this.inspectionFrame(model.assembly!.poses);
    return {
      target: model.children.map(child =>
        frame.positioned(child as unknown as Model)!,
      ),
    };
  }

  /** @internal Ordinary preview values retain the measured frame without re-solving. */
  static inspectDistance(
    [a, b]: readonly [Anchor, Anchor, DistanceAxis?],
    context: InspectContext<number, unknown, DistanceInspectData | undefined>,
  ): InspectResult | undefined {
    const data = context.data;
    if (!data) return undefined;
    const {owner, positioned} = this.inspectionFrame(data.poses);
    const operands = [a, b].map((value, index) =>
      positioned(value, data.references[index]),
    );
    const focused = context.focused.values.flatMap(value => {
      if (!(value instanceof ModelObject) && !(value instanceof ModelAnchor))
        return [];
      const placed = positioned(value);
      return placed ? [placed] : [];
    });
    const selectedModels = new Set(
      context.focused.values.filter(value => value instanceof ModelObject),
    );
    const target = operands.flatMap((value, index) =>
      value &&
      (!context.focused.parameter ||
        !([a, b][index] instanceof ModelObject) ||
        selectedModels.has([a, b][index] as ModelObject))
        ? [value]
        : [],
    );
    target.push(...focused.filter(value => !target.includes(value)));
    const first = owner(data.references[0].model);
    if (!first) return undefined;
    target.push(
      dimension({
        owner: first as unknown as Model,
        start: data.result.start,
        end: data.result.end,
        value: data.result.value,
        axisLabel:
          data.axisName?.toUpperCase() ?? (data.direction ? 'axis' : undefined),
      }),
    );
    const targets = new Set(target);
    return {
      target: [...targets].map(value =>
        value instanceof ModelAnchor && !focused.includes(value)
          ? anchorAnnotation(value, {direction: 'none'})
          : value,
      ),
      ambient: [...data.poses.keys()].flatMap(model => {
        const value = owner(model) as unknown as Model | undefined;
        return value && !targets.has(value) ? [value] : [];
      }),
    };
  }

  /** @internal Render only actual participants in the appropriate relation stage. */
  static inspectRelate(
    data: RelateInspectionContext,
    focus: unknown,
    values: readonly PreviewValue[],
    insertion?: number,
  ): InspectResult {
    const poses = data.poses(
      focus instanceof RelationExpression ? focus : undefined,
      insertion,
    );
    const frame = this.inspectionFrame(poses);
    const selected = values.flatMap<PreviewValue>(value => {
      if (isSketch(value) || isSketchPoint(value)) {
        if (!data.owns(value)) return [];
        const original = isSketch(value) ? value : value.sketch;
        const source = sketchFrame(original);
        const placed = frame.display(source);
        if (!placed || !isSketch(placed)) return [];
        return [
          isSketch(value)
            ? placed
            : retainInspectionIdentity(placed.point(value.id), value),
        ];
      }
      if (!(value instanceof ModelObject) && !(value instanceof ModelAnchor))
        return [];
      if (!data.owns(value)) return [];
      const reference = anchorReference(value);
      const result = frame.positioned(value, reference);
      return result ? [result] : [];
    });
    const target = selected.length ? selected : [frame.display(data.self)!];
    const targets = new Set(target);
    return {
      target,
      ambient: data.participants.flatMap(model => {
        const value = frame.display(model);
        return value && !targets.has(value) ? [value] : [];
      }),
    };
  }

  /** @internal Relation markers use explicit anchor and finite-range annotations. */
  static inspectConstraint(
    data: RelateInspectionContext,
    relation: RelationExpression,
    sourceValue: Anchor,
    targetValue: Anchor,
    focusSelf = false,
  ): InspectResult | undefined {
    if (!data.owns(relation)) return undefined;
    const poses = data.poses(relation);
    const constraint = data.self.inspectionConstraint(relation, poses);
    if (!constraint) return undefined;
    const frame = this.inspectionFrame(poses);
    const sourceOwner = frame.owner(constraint.source);
    const targetOwner = frame.owner(constraint.target);
    if (!sourceOwner || !targetOwner) return undefined;
    const {snapshot} = constraint;
    const anchor = (
      owner: ModelObject,
      model: RelationObject,
      element: ElementSnapshot,
      identity: Anchor,
    ) =>
      retainInspectionIdentity(
        modelAnchor(owner, element.name, {
          kind: element.kind,
          transform: composeTransforms(poses.get(model)!, element.transform),
          bound: element.bound,
        }),
        identity,
      );
    const source =
      snapshot.kind === 'on'
        ? anchor(
            sourceOwner,
            constraint.source,
            snapshot.sourceElement,
            sourceValue,
          )
        : (frame.positioned(
            sourceValue,
            {...anchorReference(sourceValue), model: constraint.source},
            true,
          ) as Anchor);
    const target =
      snapshot.kind === 'on'
        ? anchor(
            targetOwner,
            constraint.target,
            snapshot.targetElement,
            targetValue,
          )
        : (frame.positioned(
            targetValue,
            {...anchorReference(targetValue), model: constraint.target},
            true,
          ) as Anchor);
    const extent =
      snapshot.kind === 'on'
        ? retainInspectionIdentity(
            boundsAnnotation({
              owner: sourceOwner as unknown as Model,
              size: snapshot.sourceBounds.size,
              frame: composeTransforms(
                poses.get(constraint.source)!,
                snapshot.sourceBounds.transform,
              ),
            }),
            sourceValue,
          )
        : undefined;
    const owners = new Set([sourceOwner, targetOwner]);
    return {
      focused: focusSelf
        ? [
            frame.display(data.self)!,
            constraint.source === data.self ? source : target,
            ...(constraint.source === data.self && extent ? [extent] : []),
          ]
        : undefined,
      target: [
        ...[...new Set([constraint.source, constraint.target])].map(model =>
          frame.display(model)!,
        ),
        anchorAnnotation(source, {direction: 'forward'}),
        anchorAnnotation(target, {direction: 'forward'}),
        ...(extent ? [extent] : []),
      ],
      ambient: data.participants.flatMap(model => {
        const value = frame.display(model);
        return value && !owners.has(frame.owner(model)!) ? [value] : [];
      }),
    };
  }

  /** Bounds of the selected finite geometry after a rigid transform. */
  private [referenceBoundsParts](
    reference: StoredAnchor,
    transform: RigidTransform,
  ): ({bounds: LocalBounds} | SnapshotQueryInput)[] {
    if (reference.bound)
      return [{bounds: super[referenceBounds](reference, transform)}];
    if (reference.whole) {
      if (this.geometry) {
        const bounds = axisAlignedBounds(
          this.geometry.value.localBounds,
          transform,
        );
        return [bounds ? {bounds} : boundsQuery(this.geometry, transform)];
      }
      const context = this.assembly!;
      return this.children.flatMap(child =>
        child[referenceBoundsParts](
          child.relationAnchorReference(),
          composeTransforms(transform, child.solvePose(context)),
        ),
      );
    }
    if (reference.topology) {
      const topology = reference.topology;
      return [
        boundsQuery(
          topology.source.requireGeometry(),
          composeTransforms(transform, topology.transform),
          topology.selection,
          topology.scale,
        ),
      ];
    }
    if (reference.parts)
      return reference.parts.map(part =>
        boundsQuery(
          part.source.requireGeometry(),
          composeTransforms(transform, part.transform),
          part.selection,
          part.scale,
        ),
      );
    return [{bounds: super[referenceBounds](reference, transform)}];
  }

  /** Bounds of the selected finite geometry after a rigid transform. */
  override [referenceBounds](
    reference: StoredAnchor,
    transform: RigidTransform,
  ): LocalBounds {
    const bounds = this[referenceBoundsParts](reference, transform).map(part =>
      'bounds' in part
        ? part.bounds
        : (evaluateSnapshotQuery(part) as LocalBounds),
    );
    return bounds.length === 1 ? bounds[0] : combineBounds(bounds);
  }

  /** Pure query collection: it never substitutes geometry or runs author code. */
  [modelSnapshotQueries](): SnapshotQueryInput[] {
    const result: SnapshotQueryInput[] = [];
    if (this.geometry || this.children.length) {
      for (const direction of Object.values(boundDirections)) {
        const transform = invertTransform(
          rotation(frameFromYAxis(origin, direction).quaternion),
        );
        for (const part of this[referenceBoundsParts](
          this.relationAnchorReference(),
          transform,
        ))
          if (!('bounds' in part)) result.push(part);
      }
    }
    if (this.geometry)
      result.push(
        meshQuery(
          this.geometry,
          this.geometry.value.shape,
          this.meshTolerance,
          this.geometry.value.topology,
        ),
      );
    return result;
  }

  protected override alignmentGeometry(
    reference: StoredAnchor,
  ): AlignmentGeometry {
    if (reference.kind === 'point')
      return {
        kind: 'point',
        point: reference.whole
          ? (this.requireGeometry().value.shape as ReplicadVertex).asTuple()
          : reference.transform.position,
      };
    const read = (shape: AnyShape) =>
      reference.kind === 'line'
        ? edgeGeometry(shape as ReplicadEdge, reference.direction ?? 1)
        : faceGeometry(
            shape as ReplicadFace,
            reference.facing ?? reference.bound?.facing ?? 1,
          );
    if (reference.topology) {
      const topology = reference.topology,
        geometry = topology.source.requireGeometry().value;
      return withTopologyShape(
        geometry.shape,
        geometry.topology,
        topology.selection,
        shape => {
          const scaled =
            topology.scale === 1
              ? shape
              : shapeWithScale(shape, topology.scale);
          try {
            return transformGeometry(read(scaled), topology.transform);
          } finally {
            if (scaled !== shape) scaled.delete();
          }
        },
      );
    }
    if (reference.whole) return read(this.requireGeometry().value.shape);
    return super.alignmentGeometry(reference);
  }

  override previewElement(
    reference: StoredAnchor,
    direction: 'forward' | 'both' = 'forward',
  ): ElementSnapshot {
    return super.previewElement(
      reference.whole
        ? {
            ...this.exposedElement(),
            name: reference.name,
            direction: reference.direction,
            facing: reference.facing,
          }
        : reference,
      direction,
    );
  }

  protected override edgeReference(id: EdgeId): RelationReference {
    return {...straightAxisReference(this.edge(id)), model: undefined};
  }

  protected override vertexPosition(id: VertexId): Vec3 {
    return anchorReference(this.vertex(id)).transform.position;
  }

  protected copyRelations(init: RelationObjectInit): ModelObject {
    return this.copy(init, this.operation);
  }

  /** Fix the assembly frame once in the first member's solved local coordinates. */
  private static createAssembly(
    children: readonly ModelObject[],
  ): SolveContext {
    const context = ModelObject.createSolveContext(children);
    return children.length
      ? transformSolveContext(
          context,
          invertTransform(children[0].solvePose(context)),
        )
      : context;
  }

  private requireGeometry(): ModelGeometry {
    if (!this.geometry) {
      throw new Error(
        'This operation requires geometry and cannot act on a group.',
      );
    }
    return this.geometry;
  }

  private requireSolidGeometry(): SolidGeometry {
    if (this.kind !== 'solid') {
      throw new Error('This operation requires a solid model.');
    }
    return this.requireGeometry() as SolidGeometry;
  }

  private operationSnapshot(): ModelOperationSnapshot {
    const {kind, inputs, selections} = this.operation;
    const {siteId, execution, order, sourceRef} =
      operationTraces.get(this.operation) ?? {};
    return {
      id: storedOperationId(this.operation),
      siteId,
      execution,
      kind,
      order,
      outputNodeId: this.nodeId,
      inputs: inputs.map(({model, role, index}) => ({
        nodeId: model.nodeId,
        role,
        index,
      })),
      selections: selections.map(selection => ({
        kind: selection.kind,
        inputNodeId: selection.input.nodeId,
        ids: [...selection.ids],
        transform: toTransform(selection.transform),
      })),
      sourceRef,
      spatial: this.operation.spatial,
      dimensions: this.operation.dimensions,
    };
  }

  private copyWithGeometry(
    geometry: ModelGeometry,
    overrides: Partial<ModelObjectInit<Kind>>,
    operation: StoredOperation,
  ): RuntimeModel<Elements, Kind> {
    try {
      return this.copy({...overrides, geometry}, operation);
    } catch (error) {
      disposeModelGeometryValue(geometry.value);
      throw error;
    }
  }

  private copy(
    overrides: Partial<ModelObjectInit<Kind>>,
    operation: StoredOperation,
  ): RuntimeModel<Elements, Kind> {
    const result = ModelObject.create<Elements, Kind>({
      kind: this.kind,
      geometry: this.geometry,
      geometryAnchor: this.geometryAnchor,
      name: this.name,
      material: this.materialSnapshot,
      children: this.children,
      assembly: this.assembly,
      placements: this.placements,
      elements: this.elements,
      sourceRefs: this.sourceRefs,
      parameters: this.parameters,
      meshTolerance: this.meshTolerance,
      operation,
      ...overrides,
    }) as RuntimeModel<Elements, Kind>;
    if (operation.kind === 'relate' || operation.kind === 'material') {
      const data = modelData.get(this);
      if (data) modelData.set(result, data);
    }
    return result;
  }
}

/** @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}} */
export function circle(radius: number): FaceModel;
export function circle(radius = 5): FaceModel {
  assertPositive('radius', radius);
  return planarFaceModel('circle', 'Circle', [radius], () =>
    sketchCircle(radius, {plane: 'XZ'}),
  );
}

/**
 * @code3d.param xRadius {kind: 'length', default: 5, label: 'X radius', constraints: {exclusiveMin: 0}}
 * @code3d.param zRadius {kind: 'length', default: 3, label: 'Z radius', constraints: {exclusiveMin: 0}}
 */
export function ellipse(xRadius: number, zRadius: number): FaceModel;
export function ellipse(xRadius = 5, zRadius = 3): FaceModel {
  assertPositive('xRadius', xRadius);
  assertPositive('zRadius', zRadius);
  return planarFaceModel('ellipse', 'Ellipse', [xRadius, zRadius], () =>
    sketchEllipse(xRadius, zRadius, {plane: 'XZ'}),
  );
}

/**
 * @code3d.param x {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 * @code3d.param z {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function rectangle(x: number, z: number): FaceModel;
export function rectangle(x = 10, z = 10): FaceModel {
  assertPositive('x', x);
  assertPositive('z', z);
  return planarFaceModel('rectangle', 'Rectangle', [x, z], () =>
    sketchRectangle(x, z, {plane: 'XZ'}),
  );
}

/**
 * @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}}
 * @code3d.param sides {kind: 'count', default: 6, constraints: {min: 3}}
 * @code3d.param rotation {kind: 'angle', default: 0}
 */
export function regularPolygon(
  radius: number,
  sides: number,
  rotation?: number,
): FaceModel;
export function regularPolygon(radius = 5, sides = 6, rotation = 0): FaceModel {
  assertPositive('radius', radius);
  if (!Number.isInteger(sides) || sides < 3) {
    throw new Error('sides must be an integer greater than or equal to 3.');
  }
  if (!Number.isFinite(rotation)) {
    throw new Error('rotation must be a finite number.');
  }
  return planarFaceModel(
    'regularPolygon',
    `${sides}-sided polygon`,
    [radius, sides, rotation],
    () => sketchPolysides(radius, sides, 0, {plane: 'XZ'}),
    face =>
      rotation === 0 ? face : face.rotate(rotation, toPoint(origin), [0, 1, 0]),
  );
}

/**
 * @code3d.param x {kind: 'length', label: 'X'}
 * @code3d.param y {kind: 'length', label: 'Y'}
 * @code3d.param z {kind: 'length', label: 'Z'}
 */
export function point([x, y, z]: Vec3 = origin): VertexModel {
  const position: Vec3 = [x, y, z];
  assertFiniteVector('point', position);
  const geometry = evaluateModelGeometry('point', [position], [], () => ({
    shape: makeVertex(toPoint(position)),
  }));
  return ModelObject.create<{}, 'vertex'>({
    kind: 'vertex',
    name: 'Point',
    geometry,
    geometryAnchor: {kind: 'point', transform: translation(position)},
    operation: storedOperation('point'),
  }) as unknown as VertexModel;
}

/**
 * @code3d.param x {kind: 'length', label: 'End X'}
 * @code3d.param y {kind: 'length', label: 'End Y'}
 * @code3d.param z {kind: 'length', label: 'End Z'}
 */
export function line([x, y, z]: Vec3): EdgeModel;
/**
 * @code3d.param startX {kind: 'length', label: 'Start X'}
 * @code3d.param startY {kind: 'length', label: 'Start Y'}
 * @code3d.param startZ {kind: 'length', label: 'Start Z'}
 * @code3d.param endX {kind: 'length', label: 'End X'}
 * @code3d.param endY {kind: 'length', label: 'End Y'}
 * @code3d.param endZ {kind: 'length', label: 'End Z'}
 */
export function line(
  [startX, startY, startZ]: Vec3,
  [endX, endY, endZ]: Vec3,
): EdgeModel;
export function line(startOrEnd: Vec3, end?: Vec3): EdgeModel {
  const start = end ? startOrEnd : origin;
  end ??= startOrEnd;
  assertCurvePoints('line', [start, end], 2);
  return curveModel('line', 'Line', [start, end], () =>
    makeLine(toPoint(start), toPoint(end)),
  );
}

export function arc(start: Vec3, middle: Vec3, end: Vec3): EdgeModel {
  assertCurvePoints('arc', [start, middle, end], 3);
  return curveModel('arc', 'Arc', [start, middle, end], () =>
    makeThreePointArc(toPoint(start), toPoint(middle), toPoint(end)),
  );
}

export function bezier(points: readonly Vec3[]): EdgeModel {
  assertCurvePoints('bezier', points, 2);
  return curveModel('bezier', 'Bezier curve', points, () =>
    makeBezierCurve(points.map(toPoint)),
  );
}

export function spline(points: readonly Vec3[]): EdgeModel {
  assertCurvePoints('spline', points, 2);
  return curveModel('spline', 'Spline', points, () =>
    makeBSplineApproximation(points.map(toPoint)),
  );
}

export type LoftOptions = Readonly<{
  spine?: EdgeModel<{}>;
  ruled?: boolean;
}>;

/**
 * @code3d.inspect sections loft.inspectSections
 * @code3d.inspect spine loft.inspectSpine
 */
export function loft(
  sections: readonly FaceModel<{}>[],
  {spine, ruled = false}: LoftOptions = {},
): SolidModel {
  if (sections.length < 2) {
    throw new Error('loft requires at least two planar sections.');
  }
  const runtimeSections = sections.map(section =>
    requireModelKind(
      section,
      'face',
      'Every loft section must be a planar face model.',
    ),
  );
  const runtimeSpine = spine
    ? requireModelKind(spine, 'edge', 'A loft spine must be a curve model.')
    : undefined;
  const [first, ...others] = runtimeSections;
  return first[loftModels](others, runtimeSpine, ruled);
}

/**
 * @code3d.inspect x box.inspectDimension
 * @code3d.inspect y box.inspectDimension
 * @code3d.inspect z box.inspectDimension
 * @code3d.param x {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 * @code3d.param z {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function box(x: number, y: number, z: number): SolidModel;
export function box(x = 10, y = 10, z = 10): SolidModel {
  assertPositive('x', x);
  assertPositive('y', y);
  assertPositive('z', z);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Box',
    geometry: evaluateSolidGeometry('box', [x, y, z], [], () => ({
      shape: centeredBoxShape(x, y, z),
    })),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('box', [], {
      dimensions: {
        x: {origin: [-x / 2, -y / 2, -z / 2], vector: [x, 0, 0]},
        y: {origin: [-x / 2, -y / 2, -z / 2], vector: [0, y, 0]},
        z: {origin: [-x / 2, -y / 2, -z / 2], vector: [0, 0, z]},
      },
    }),
  }) as unknown as SolidModel;
}

/**
 * @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function cylinder(radius: number, y: number): SolidModel;
export function cylinder(radius = 5, y = 10): SolidModel {
  assertPositive('radius', radius);
  assertPositive('y', y);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Cylinder',
    geometry: evaluateSolidGeometry('cylinder', [radius, y], [], () => ({
      shape: makeCylinder(radius, y, [0, -y / 2, 0], [0, 1, 0]),
    })),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('cylinder'),
  }) as unknown as SolidModel;
}

/**
 * A concentric, constant-section tube, open at both ends and centered on Y.
 * @code3d.param outerRadius {kind: 'length', default: 5, label: 'Outer radius', constraints: {exclusiveMin: 0}}
 * @code3d.param innerRadius {kind: 'length', default: 3, label: 'Inner radius', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function tube(
  outerRadius: number,
  innerRadius: number,
  y: number,
): SolidModel;
export function tube(outerRadius = 5, innerRadius = 3, y = 10): SolidModel {
  assertPositive('outerRadius', outerRadius);
  assertPositive('innerRadius', innerRadius);
  assertPositive('y', y);
  if (innerRadius >= outerRadius) {
    throw new Error('innerRadius must be smaller than outerRadius.');
  }
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Tube',
    geometry: evaluateSolidGeometry(
      'tube',
      [outerRadius, innerRadius, y],
      [],
      () => {
        const outer = sketchCircle(outerRadius, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        const inner = sketchCircle(innerRadius, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        // Hole wires run opposite to the outer boundary.
        inner.wire.wrapped.Reverse();
        const section = makeFace(outer.wire, [inner.wire]);
        const direction = new Vector([0, y, 0]);
        try {
          return {shape: basicFaceExtrusion(section, direction)};
        } finally {
          direction.delete();
          section.delete();
          inner.delete();
          outer.delete();
        }
      },
    ),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('tube'),
  }) as unknown as SolidModel;
}

/**
 * A right-handed, constant-pitch coil with a circular wire section and plain ends.
 * coilRadius measures to the wire centerline; pitch is the Y advance per turn.
 * The centerline spans -pitch * turns / 2 to +pitch * turns / 2 on the Y axis.
 * Fractional turns are supported. No spring-specific end treatments are applied.
 * @code3d.param coilRadius {kind: 'length', default: 5, label: 'Coil radius', constraints: {exclusiveMin: 0}}
 * @code3d.param wireRadius {kind: 'length', default: 1, label: 'Wire radius', constraints: {exclusiveMin: 0}}
 * @code3d.param pitch {kind: 'length', default: 3, constraints: {exclusiveMin: 0}}
 * @code3d.param turns {kind: 'scalar', default: 3, constraints: {exclusiveMin: 0}}
 */
export function coil(
  coilRadius: number,
  wireRadius: number,
  pitch: number,
  turns: number,
): SolidModel;
export function coil(
  coilRadius = 5,
  wireRadius = 1,
  pitch = 3,
  turns = 3,
): SolidModel {
  assertPositive('coilRadius', coilRadius);
  assertPositive('wireRadius', wireRadius);
  assertPositive('pitch', pitch);
  assertPositive('turns', turns);
  if (wireRadius >= coilRadius) {
    throw new Error('wireRadius must be smaller than coilRadius.');
  }
  if (pitch <= 2 * wireRadius) {
    throw new Error('pitch must be greater than the wire diameter.');
  }
  assertCoilClearance(coilRadius, wireRadius, pitch, turns);
  const y = pitch * turns;
  assertPositive('pitch * turns', y);
  const geometry = evaluateSolidGeometry(
    'coil',
    [coilRadius, wireRadius, pitch, turns],
    [],
    () => {
      const spine = makeHelix(pitch, y, coilRadius, [0, -y / 2, 0], [0, 1, 0]);
      const start = spine.pointAt(0);
      const tangent = spine.tangentAt(0);
      const circle = makeCircle(wireRadius, start, tangent);
      const section = assembleWire([circle]);
      try {
        return {shape: genericSweep(section, spine, {frenet: true})};
      } finally {
        section.delete();
        circle.delete();
        tangent.delete();
        start.delete();
        spine.delete();
      }
    },
  );
  // A fractional turn has asymmetric X/Z bounds, but its axis is still Y.
  // The circular end sections extend beyond the centerline's Y interval.
  const circumference = 2 * Math.PI * coilRadius;
  const halfHeight =
    y / 2 + wireRadius * (circumference / Math.hypot(circumference, pitch));
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Coil',
    geometry,
    elements: solidElements([
      [0, -halfHeight, 0],
      [0, halfHeight, 0],
    ]),
    operation: storedOperation('coil'),
  }) as unknown as SolidModel;
}

function assertCoilClearance(
  radius: number,
  wireRadius: number,
  pitch: number,
  turns: number,
): void {
  // Neighboring turns approach obliquely: pitch alone overestimates clearance.
  // For angular separation t, squared centerline distance is
  // 2 R² (1 - cos(t)) + (pitch * t / 2π)². Its only possible minimum
  // between half a turn and a full turn lies after the derivative's minimum.
  // Beyond a full turn, the Y separation already exceeds the wire diameter.
  if (turns <= 0.5) return;
  const fullTurn = 2 * Math.PI;
  const slopeSquared = (pitch / (fullTurn * radius)) ** 2;
  if (slopeSquared >= 1) return;
  let lower = fullTurn - Math.acos(-slopeSquared);
  if (Math.sin(lower) + slopeSquared * lower >= 0) return;
  let upper = fullTurn;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (Math.sin(middle) + slopeSquared * middle < 0) lower = middle;
    else upper = middle;
  }
  const separation = Math.min(fullTurn * turns, (lower + upper) / 2);
  const distance = Math.hypot(
    2 * radius * Math.sin(separation / 2),
    (pitch * separation) / fullTurn,
  );
  if (distance <= 2 * wireRadius) {
    throw new Error(
      'Coil turns must not touch or overlap; increase pitch or decrease wireRadius.',
    );
  }
}

/** @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}} */
export function sphere(radius: number): SolidModel;
export function sphere(radius = 5): SolidModel {
  assertPositive('radius', radius);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Sphere',
    geometry: evaluateSolidGeometry('sphere', [radius], [], () => ({
      shape: makeSphere(radius),
    })),
    elements: solidElements([
      [0, -radius, 0],
      [0, radius, 0],
    ]),
    operation: storedOperation('sphere'),
  }) as unknown as SolidModel;
}

/**
 * An ellipsoid centered at the local origin, with radii along X, Y and Z.
 * @code3d.param xRadius {kind: 'length', default: 5, label: 'X radius', constraints: {exclusiveMin: 0}}
 * @code3d.param yRadius {kind: 'length', default: 3, label: 'Y radius', constraints: {exclusiveMin: 0}}
 * @code3d.param zRadius {kind: 'length', default: 4, label: 'Z radius', constraints: {exclusiveMin: 0}}
 */
export function ellipsoid(
  xRadius: number,
  yRadius: number,
  zRadius: number,
): SolidModel;
export function ellipsoid(xRadius = 5, yRadius = 3, zRadius = 4): SolidModel {
  assertPositive('xRadius', xRadius);
  assertPositive('yRadius', yRadius);
  assertPositive('zRadius', zRadius);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Ellipsoid',
    geometry: evaluateSolidGeometry(
      'ellipsoid',
      [xRadius, yRadius, zRadius],
      [],
      () => ({shape: ellipsoidShape(xRadius, yRadius, zRadius)}),
    ),
    elements: solidElements([
      [0, -yRadius, 0],
      [0, yRadius, 0],
    ]),
    operation: storedOperation('ellipsoid'),
  }) as unknown as SolidModel;
}

/**
 * @code3d.param bottomRadius {kind: 'length', default: 5, label: 'Bottom radius', constraints: {exclusiveMin: 0}}
 * @code3d.param topRadius {kind: 'length', default: 3, label: 'Top radius', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function frustum(
  bottomRadius: number,
  topRadius: number,
  y: number,
): SolidModel;
export function frustum(bottomRadius = 5, topRadius = 3, y = 10): SolidModel {
  assertPositive('bottomRadius', bottomRadius);
  assertPositive('topRadius', topRadius);
  assertPositive('y', y);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Frustum',
    geometry: evaluateSolidGeometry(
      'frustum',
      [bottomRadius, topRadius, y],
      [],
      () => {
        const bottom = sketchCircle(bottomRadius, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        const top = sketchCircle(topRadius, {
          plane: 'XZ',
          origin: [0, y / 2, 0],
        });
        return {shape: bottom.loftWith(top, {ruled: true})};
      },
    ),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('frustum'),
  }) as unknown as SolidModel;
}

/**
 * @code3d.param radius {kind: 'length', default: 5, constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 * @code3d.param sides {kind: 'count', default: 6, constraints: {min: 3}}
 * @code3d.param rotation {kind: 'angle', default: 0}
 */
export function regularPrism(
  radius: number,
  y: number,
  sides: number,
  rotation?: number,
): SolidModel;
export function regularPrism(
  radius = 5,
  y = 10,
  sides = 6,
  rotation = 0,
): SolidModel {
  assertPositive('radius', radius);
  assertPositive('y', y);
  if (!Number.isInteger(sides) || sides < 3) {
    throw new Error('sides must be an integer greater than or equal to 3.');
  }
  if (!Number.isFinite(rotation)) {
    throw new Error('rotation must be a finite number.');
  }
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: `${sides}-sided prism`,
    geometry: evaluateSolidGeometry(
      'regular-prism',
      [radius, y, sides, rotation],
      [],
      () => {
        const sketch = sketchPolysides(radius, sides, 0, {
          plane: 'XZ',
          origin: [0, -y / 2, 0],
        });
        let shape = sketch.extrude(y, {
          extrusionDirection: [0, 1, 0],
        });
        if (rotation !== 0) {
          shape = shape.rotate(rotation, [0, 0, 0], [0, 1, 0]);
        }
        return {shape};
      },
    ),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('regularPrism'),
  }) as unknown as SolidModel;
}

/** @internal */
export function primitiveConstructor<Args extends unknown[]>(
  build: (...args: Args) => Shape3D,
): (...args: Args) => SolidModel {
  const geometry = cachedArtifact(
    (...args: Args) => {
      const shape = build(...args);
      let solid: Shape3D;
      try {
        solid = normalizeReplicadSolid(shape);
      } catch (error) {
        shape.delete();
        throw error;
      }
      return createModelGeometryValue(solid);
    },
    {
      identity: build,
      namespace: 'primitive',
      lifecycle: modelGeometryLifecycle,
    },
  );
  return (...args) =>
    ModelObject.create<CanonicalElements, 'solid'>({
      kind: 'solid',
      name: 'Custom primitive',
      geometry: geometry(...args) as SolidGeometry,
      operation: storedOperation('primitive'),
    }) as unknown as SolidModel;
}

function normalizeReplicadSolid(shape: Shape3D): Shape3D {
  const oc = getOC();
  const type = shape.wrapped.ShapeType();
  if (type === oc.TopAbs_ShapeEnum.TopAbs_SOLID) return shape;
  if (
    type !== oc.TopAbs_ShapeEnum.TopAbs_COMPSOLID &&
    type !== oc.TopAbs_ShapeEnum.TopAbs_COMPOUND
  ) {
    throw new Error(
      'A primitive builder must return exactly one OpenCascade solid.',
    );
  }

  const containmentLayers = [
    [oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SOLID],
    [oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHELL],
    [oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_FACE],
    [oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_WIRE],
    [oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_EDGE],
  ] as const;
  for (const [find, avoid] of containmentLayers) {
    const outsideSolid = new oc.TopExp_Explorer(shape.wrapped, find, avoid);
    try {
      if (outsideSolid.More()) {
        throw new Error(
          'A primitive builder must return exactly one OpenCascade solid.',
        );
      }
    } finally {
      outsideSolid.delete();
    }
  }

  const solids = new oc.TopExp_Explorer(
    shape.wrapped,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
  );
  let solid: Shape3D | undefined;
  try {
    if (!solids.More()) {
      throw new Error(
        'A primitive builder must return exactly one OpenCascade solid.',
      );
    }
    solid = castOwnedShape3D(solids.Current());
    solids.Next();
    if (solids.More()) {
      solid.delete();
      solid = undefined;
      throw new Error(
        'A primitive builder must return exactly one OpenCascade solid.',
      );
    }
  } finally {
    solids.delete();
  }

  shape.delete();
  return solid;
}

/** Compose members in the first member's local frame; empty groups use the default frame. */
/** @code3d.inspect children group.inspectChildren */
export function group(children: readonly Model[], name = 'Group'): GroupModel {
  const runtimeChildren = children.map(child =>
    requireModelObject(child, 'Every group child must be a model.'),
  );
  return ModelObject.create<{}, 'group'>({
    kind: 'group',
    name,
    children: runtimeChildren,
    operation: storedOperation(
      'group',
      runtimeChildren.map((model, index) => ({
        model,
        role: 'child',
        index,
      })),
    ),
  }) as unknown as GroupModel;
}

/** @internal */
export namespace group {
  export function inspectChildren(
    _args: [readonly Model[], string?],
    context: InspectContext<GroupModel>,
  ): InspectResult | undefined {
    return context.return && ModelObject.inspectGroup(context.return);
  }
}

/** Inspect derived group members at solved poses while preserving input focus. */
export function inspectGroupMembers(
  children: readonly Model[],
  inputs: readonly Model[],
): InspectResult {
  const result = ModelObject.inspectGroup(group(children));
  result.target?.forEach((member, index) => {
    retainInspectionIdentity(member, inputs[index]);
  });
  return result;
}

/**
 * Measure finite models, topology, bounds or point references in their solved placement.
 * Without axis, returns the shortest geometric distance. With axis, returns the
 * gap between projected intervals (zero when they overlap). The result is a
 * non-negative number computed now; later relations do not update it.
 * @code3d.inspect distance.inspect
 * @code3d.inspect a distance.inspect
 * @code3d.inspect b distance.inspect
 * @code3d.inspect axis distance.inspect
 */
export function distance(a: Anchor, b: Anchor, axis?: DistanceAxis): number {
  return ModelObject.distance(a, b, axis);
}

/** @internal */
export namespace distance {
  export function inspect(
    args: [Anchor, Anchor, DistanceAxis?],
    context: InspectContext<number, unknown, DistanceInspectData | undefined>,
  ): InspectResult | undefined {
    return ModelObject.inspectDistance(args, context);
  }
}

/** @internal Runtime exports for JSDoc inspectors; not a free modeling function. */
export namespace relate {
  export function inspectContext(
    execution: InspectClosureExecution,
  ): RelateInspectionContext | undefined {
    const data = execution.call.data as RelateInspectData | undefined;
    return data && createContext(data);
  }

  const contexts = new WeakMap<RelateInspectData, RelateInspectionContext>();

  function createContext(data: RelateInspectData): RelateInspectionContext {
    const existing = contexts.get(data);
    if (existing) return existing;
    const participants = new Set(data.participants);
    const frames = new Map<
      RelationExpression | undefined,
      ReadonlyMap<RelationObject, RigidTransform>
    >();
    const relations = new Set(
      data.relations.map(value => {
        const ref = value.traceReference();
        return ref.kind === 'constraint'
          ? ref.constraintId
          : ref.transformationId;
      }),
    );
    const context: RelateInspectionContext = {
      ...data,
      poses(relation, insertion) {
        if (insertion !== undefined)
          return data.self.inspectionPoses(undefined, insertion);
        let frame = frames.get(relation);
        if (!frame) {
          frame = data.self.inspectionPoses(relation);
          frames.set(relation, frame);
        }
        return frame;
      },
      owns,
    };
    contexts.set(data, context);
    return context;

    function owns(value: unknown, seen = new Set<object>()): boolean {
      if (isSketch(value) || isSketchPoint(value))
        return participants.has(
          sketchFrame(isSketch(value) ? value : value.sketch),
        );
      if (value instanceof RelationExpression) {
        const ref = value.traceReference();
        return relations.has(
          ref.kind === 'constraint' ? ref.constraintId : ref.transformationId,
        );
      }
      if (value instanceof ModelObject || value instanceof ModelAnchor)
        return participants.has(anchorReference(value).model);
      if (!value || typeof value !== 'object' || seen.has(value)) return false;
      if (value instanceof Map || value instanceof Set) {
        seen.add(value);
        const members = [
          ...(value instanceof Map
            ? Map.prototype.values
            : Set.prototype.values
          ).call(value),
        ];
        const related = members.every(member => owns(member, seen));
        seen.delete(value);
        return related;
      }
      const prototype = Object.getPrototypeOf(value);
      if (
        !Array.isArray(value) &&
        prototype !== Object.prototype &&
        prototype !== null
      )
        return false;
      seen.add(value);
      const members = Object.keys(value).map(key =>
        Object.getOwnPropertyDescriptor(value, key)!,
      );
      const related = members.every(
        member => 'value' in member && owns(member.value, seen),
      );
      seen.delete(value);
      return related;
    }
  }

  export function context(
    context: InspectContext,
  ): RelateInspectionContext | undefined {
    for (let closure = context.closure; closure; closure = closure.parent)
      if (closure.provider === inspectContext)
        return closure.data as RelateInspectionContext;
    return undefined;
  }

  export function inspectCall(
    _args: readonly unknown[],
    context: InspectContext,
  ): InspectResult | undefined {
    if (!(context.return instanceof ModelObject) && !isSketch(context.return))
      return undefined;
    const data = createContext(context.data as RelateInspectData);
    return ModelObject.inspectRelate(data, context.return, [
      context.return as unknown as PreviewValue,
    ]);
  }

  /** Inspect numeric/reference arguments through their consumed relation result. */
  export function inspectRelation(
    _args: readonly unknown[],
    context: InspectContext,
  ): InspectResult | undefined {
    const data = relate.context(context);
    const relation = context.return;
    if (!(relation instanceof RelationExpression) || !data?.owns(relation))
      return undefined;
    return ModelObject.inspectRelate(data, relation, context.focused.values);
  }

  export function inspectBody(
    _args: readonly unknown[],
    context: InspectContext,
  ): InspectResult | undefined {
    const data = relate.context(context);
    if (!data?.owns(context.focused.value)) return undefined;
    return ModelObject.inspectRelate(
      data,
      context.focused.value,
      context.focused.values,
      context.focused.insertion,
    );
  }
}

type MeasurementInspectData = Readonly<{
  owner: Model;
  target: Model | Anchor;
  placement: DimensionSegment | Readonly<{at: Vec3}>;
}>;

function measureFiniteGeometry(
  value: ModelObject | ModelTopologyElement,
  measure: 'length' | 'area' | 'volume',
): number {
  const topology =
    value instanceof ModelTopologyElement
      ? value[anchorReferenceValue].topology
      : undefined;
  const owner =
    value instanceof ModelObject ? value : value[anchorReferenceValue].model;
  const geometry = (topology?.source ?? (value as ModelObject))[
    modelGeometry
  ]()!.value;
  const scale = topology?.scale ?? 1;
  const position = (point: Vec3): Vec3 =>
    topology ? topologyTransform(topology, translation(point)).position : point;
  const read = (shape: AnyShape): number => {
    const properties =
      measure === 'length'
        ? measureShapeLinearProperties(shape)
        : measure === 'area'
          ? measureShapeSurfaceProperties(shape as ReplicadFace | Shape3D)
          : measureShapeVolumeProperties(shape as Shape3D);
    try {
      const magnitude =
        'length' in properties
          ? properties.length
          : 'area' in properties
            ? properties.area
            : properties.volume;
      const power = measure === 'length' ? 1 : measure === 'area' ? 2 : 3;
      const result = magnitude * scale ** power;
      if (isRecordingInspection()) {
        const edge = shape as ReplicadEdge;
        const edgePoint = (parameter: number): Vec3 => {
          const point = edge.pointAt(parameter);
          try {
            return position(point.toTuple());
          } finally {
            point.delete();
          }
        };
        const placement =
          measure === 'length' && edge.geomType === 'LINE'
            ? {start: edgePoint(0), end: edgePoint(1)}
            : {
                at:
                  measure === 'length'
                    ? edgePoint(0.5)
                    : position(properties.centerOfMass),
              };
        const target =
          value instanceof ModelObject
            ? value.kind === 'edge'
              ? value.edges()[0]
              : value.kind === 'face'
                ? value.surfaces()[0]
                : value
            : value;
        captureInspectData({owner, target, placement});
      }
      return result;
    } finally {
      properties.delete();
    }
  };
  return topology
    ? withTopologyShape(
        geometry.shape,
        geometry.topology,
        topology.selection,
        read,
      )
    : read(geometry.shape);
}

/** @internal */
export function inspectLength(
  _args: readonly [],
  context: InspectContext<number, unknown, MeasurementInspectData | undefined>,
): InspectResult | undefined {
  return inspectMeasurement(context, 'length');
}

/** @internal */
export function inspectArea(
  _args: readonly [],
  context: InspectContext<number, unknown, MeasurementInspectData | undefined>,
): InspectResult | undefined {
  return inspectMeasurement(context, 'area');
}

/** @internal */
export function inspectVolume(
  _args: readonly [],
  context: InspectContext<number, unknown, MeasurementInspectData | undefined>,
): InspectResult | undefined {
  return inspectMeasurement(context, 'volume');
}

function inspectMeasurement(
  context: InspectContext<number, unknown, MeasurementInspectData | undefined>,
  kind: 'length' | 'area' | 'volume',
): InspectResult | undefined {
  if (context.return === undefined || !context.data) return;
  const {owner, target, placement} = context.data;
  return {
    target: [
      target,
      dimension({
        owner,
        value: context.return,
        ...placement,
        axisLabel:
          kind === 'length'
            ? 'at' in placement
              ? 'arc length'
              : undefined
            : kind,
      }),
    ],
  };
}

/** @internal */
export function inspectTopologyReference(
  _args: readonly unknown[],
  context: InspectContext<
    Anchor | readonly Anchor[] | undefined,
    Model | Anchor
  >,
): InspectResult | undefined {
  if (
    context.return !== undefined &&
    (!Array.isArray(context.return) || context.return.length > 0)
  )
    return undefined;
  const owner = isModelObject(context.receiver)
    ? context.receiver
    : modelTopologyReference(context.receiver)?.model;
  return owner ? {ambient: [owner as unknown as Model]} : undefined;
}

/** @internal */
export namespace expose {
  export function inspectSources(
    _args: [ElementSources],
    context: InspectContext<
      Model,
      Model,
      readonly (readonly [string, Anchor])[]
    >,
  ): InspectResult | undefined {
    return (
      context.return &&
      ModelObject.inspectExposed(context.receiver, context.return, context.data)
    );
  }
}

/** @internal */
export namespace on {
  export function inspect(
    [source, target]: [Anchor, Bound?],
    context: InspectContext<Constraint>,
  ): InspectResult | undefined {
    const data = relate.context(context);
    if (!data || !context.return) return undefined;
    return ModelObject.inspectConstraint(
      data,
      context.return,
      target === undefined ? (data.self as ModelObject) : source,
      target ?? source,
      context.focused.parameter === undefined,
    );
  }
}

/** @internal */
export namespace align {
  export function inspect(
    [source, target]: [Anchor, Anchor],
    context: InspectContext<Constraint>,
  ): InspectResult | undefined {
    const data = relate.context(context);
    return data && context.return
      ? ModelObject.inspectConstraint(
          data,
          context.return,
          source,
          target,
          context.focused.parameter === undefined,
        )
      : undefined;
  }
}

type CenterableModel = Model & {originCenter(): Model};

/**
 * Put the current local bounding-box center at zero, like model.originCenter().
 * @code3d.inspect model originCenter.inspectModels
 */
export function originCenter<T extends CenterableModel>(model: T): T;
/**
 * Center the complete layout, preserving order and spacing. Member placements
 * are resolved into the first member's axes before choosing the shared origin.
 * @code3d.inspect models originCenter.inspectModels
 */
export function originCenter<const T extends readonly CenterableModel[]>(
  models: T,
): {readonly [Index in keyof T]: T[Index]};
export function originCenter(
  model: CenterableModel | readonly CenterableModel[],
): Model | readonly Model[] {
  const models = (Array.isArray(model) ? model : [model]).map(value =>
    requireModelObject(
      value,
      'originCenter requires a geometric model or an array of geometric models.',
    ),
  );
  const results = ModelObject.centerOrigins(
    models,
  ) as unknown as readonly Model[];
  return Array.isArray(model) ? results : results[0];
}

/** @internal */
export namespace originCenter {
  export function inspectModels(
    [models]: [Model | readonly Model[]],
    context: InspectContext<Model | readonly Model[]>,
  ): InspectResult | undefined {
    if (context.return === undefined) return;
    return inspectGroupMembers(
      Array.isArray(context.return)
        ? context.return
        : [context.return as Model],
      Array.isArray(models) ? models : [models as Model],
    );
  }
}

/** @code3d.inspect operands union.inspectOperands */
export function union(operands: readonly SolidModel<{}>[]): SolidModel {
  const {first, others} = booleanOperands('union', operands);
  return first[combineModels]('fuse', others);
}

/**
 * Extrudes each face independently, preserving array order and placement.
 * @code3d.inspect face extrude.inspectFaces
 * @code3d.inspect distance extrude.inspectFaces
 * @code3d.param distance {kind: 'length', default: 10, label: 'Extrusion distance'}
 */
export function extrude(face: FaceModel<{}>, distance: number): SolidModel;
/**
 * Extrudes each face independently.
 * @code3d.inspect faces extrude.inspectFaces
 * @code3d.inspect distance extrude.inspectFaces
 * @code3d.param distance {kind: 'length', default: 10, label: 'Extrusion distance'}
 */
export function extrude(
  faces: readonly FaceModel<{}>[],
  distance: number,
): readonly SolidModel[];
export function extrude(
  face: FaceModel<{}> | readonly FaceModel<{}>[],
  distance = 10,
): SolidModel | readonly SolidModel[] {
  const faces = (Array.isArray(face) ? face : [face]).map(value =>
    requireModelKind(
      value,
      'face',
      'extrude requires a face model or an array of face models.',
    ),
  );
  const solids: SolidModel[] = [];
  try {
    for (const value of faces) solids.push(value.extrude(distance));
    return Array.isArray(face) ? solids : solids[0];
  } finally {
    // Inner method records belong to this same free-function invocation.
    // Restore its complete input scope even when a batch member throws.
    ModelObject.recordFaceResults(
      faces,
      solids as unknown as readonly ModelObject[],
    );
  }
}

/**
 * @code3d.inspect profile revolve.inspectProfile
 * @code3d.inspect axis revolve.inspectAxis
 * @code3d.inspect config revolve.inspectProfile
 * @code3d.param config.angle {kind: 'angle', default: 360, label: 'Revolution angle'}
 * @code3d.param config.advance {kind: 'length', default: 0, label: 'Axial advance'}
 */
export function revolve(
  profile: FaceModel<{}>,
  axis: LineAnchor,
  config: RevolveConfig,
): SolidModel;
export function revolve(
  profile: FaceModel<{}>,
  axis: LineAnchor,
  config: RevolveConfig = {angle: 360},
): SolidModel {
  const runtimeProfile = requireModelKind(
    profile,
    'face',
    'revolve requires a face model.',
  );
  let result: SolidModel | undefined;
  try {
    result = runtimeProfile.revolve(axis, config);
    return result;
  } finally {
    ModelObject.recordRevolve(
      runtimeProfile,
      axis,
      result as ModelObject | undefined,
    );
  }
}

/**
 * Sweeps one planar profile along an open curve.
 * @code3d.inspect profile sweep.inspectProfile
 * @code3d.inspect spine sweep.inspectSpine
 */
export function sweep(
  profile: FaceModel<{}>,
  spine: EdgeModel<{}>,
): SolidModel {
  return requireModelKind(
    profile,
    'face',
    'sweep requires a face model.',
  ).sweep(spine);
}

/**
 * Wrap coplanar profiles onto one smooth, finite target surface. The complete
 * source bounding rectangle chooses the closest correspondence. Distinct local
 * results and crossing/overlapping regions are errors. Output may split at seams.
 * @code3d.inspect profiles wrap.inspectProfiles
 * @code3d.inspect target wrap.inspectTarget
 */
export function wrap(
  profiles: FaceModel<{}> | readonly FaceModel<{}>[],
  target: Surface | FaceModel<{}>,
  options: WrapOptions = {},
): readonly FaceModel<{}>[] {
  return ModelObject.wrapProfiles(
    (Array.isArray(profiles) ? profiles : [profiles]).map(profile =>
      requireModelKind(profile, 'face', 'wrap requires planar face models.'),
    ),
    target,
    options,
  );
}

/**
 * Give each face signed thickness along its surface normals, preserving placement.
 * @code3d.inspect face thicken.inspectFaces
 * @code3d.inspect thickness thicken.inspectFaces
 * @code3d.param thickness {kind: 'length', default: 1, label: 'Thickness'}
 */
export function thicken(face: FaceModel<{}>, thickness: number): SolidModel;
/**
 * @code3d.inspect faces thicken.inspectFaces
 * @code3d.inspect thickness thicken.inspectFaces
 * @code3d.param thickness {kind: 'length', default: 1, label: 'Thickness'}
 */
export function thicken(
  faces: readonly FaceModel<{}>[],
  thickness: number,
): readonly SolidModel[];
export function thicken(
  face: FaceModel<{}> | readonly FaceModel<{}>[],
  thickness = 1,
): SolidModel | readonly SolidModel[] {
  const faces = (Array.isArray(face) ? face : [face]).map(value =>
    requireModelKind(value, 'face', 'thicken requires face models.'),
  );
  const results: SolidModel[] = [];
  try {
    for (const value of faces) results.push(value.thicken(thickness));
    return Array.isArray(face) ? results : results[0];
  } finally {
    ModelObject.recordFaceResults(
      faces,
      results as unknown as readonly ModelObject[],
    );
  }
}

/**
 * Creates connected text faces on the XZ plane: +X right, -Z up, normal +Y.
 * All faces share the baseline origin. Size is the font em in model units.
 * @code3d.param size {kind: 'length', label: 'Text size'}
 */
export function text(
  content: string,
  font: Font,
  size: number,
  options?: TextOptions,
): readonly FaceModel[] {
  return textGlyphs(content, font, size, options).flatMap(({regions, x, y}) =>
    regions.value.map((region, index) => {
      const geometry = evaluateModelGeometry(
        'text',
        [x, y, index],
        [regions],
        () => ({shape: textRegionFace(region, x, y)}),
      );
      return faceModel('text', 'Text face', geometry);
    }),
  );
}

/**
 * @code3d.inspect stock cut.inspectStock
 * @code3d.inspect tools cut.inspectTools
 */
export function cut(
  stock: SolidModel<{}>,
  tools: readonly SolidModel<{}>[],
): SolidModel {
  const runtimeStock = requireModelKind(
    stock,
    'solid',
    'The cut stock must be a solid model.',
  );
  if (tools.length === 0) {
    throw new Error('cut requires at least one tool.');
  }
  const runtimeTools = tools.map(tool =>
    requireModelKind(tool, 'solid', 'Every cut tool must be a solid model.'),
  );
  return runtimeStock[combineModels]('cut', runtimeTools);
}

/** @code3d.inspect operands intersect.inspectOperands */
export function intersect(operands: readonly SolidModel<{}>[]): SolidModel {
  const {first, others} = booleanOperands('intersect', operands);
  return first[combineModels]('intersect', others);
}

export function isModelObject(value: unknown): value is ModelObject {
  return value instanceof ModelObject;
}

export function isSolidModel(value: unknown): value is SolidModel<{}> {
  return value instanceof ModelObject && value.kind === 'solid';
}

export function isConstraint(value: unknown): value is Constraint {
  return value instanceof Constraint;
}

export function isRelationExpression(
  value: unknown,
): value is RelationExpression {
  return value instanceof RelationExpression;
}

export function relationPreview(
  value: RelationExpression,
  preceding: readonly RelationExpression[] = [],
): RelationPreview | undefined {
  return value.preview(preceding);
}

/** The current authoring receiver remains available when a free selector throws. */
export function currentRelationSelf(): RelationObject | undefined {
  return activeRelate?.self;
}

/** Preview an insertion/selector prefix, retaining only placements inherited by its callback. */
export function relationSelectionPreview(
  self: RelationObject,
  preceding: readonly RelationExpression[],
  context?: RelationExpression,
): RelationPreview {
  return self[previewRelation](
    undefined,
    undefined,
    preceding,
    (preceding[0] ?? context)?.continuationArguments()[1]?.inheritedPlacements,
  );
}

export function instrumentRelation(
  constraint: RelationExpression,
  sourceRef: SourceRef,
  parameters: readonly ParameterUsage[],
): void {
  constraint.attachSource(sourceRef);
  constraint.attachParameters(parameters);
}

export function instrumentModelOperation(
  object: RelationObject,
  instrumentation: ModelOperationInstrumentation,
): void {
  object.attachSource(instrumentation.sourceRef);
  object.attachParameters(instrumentation.parameters);
  object.attachOperationTrace(
    instrumentation.siteId,
    instrumentation.execution,
    instrumentation.order,
    instrumentation.sourceRef,
    instrumentation.outputIndex,
  );
}

export function relationTraceReference(
  constraint: RelationExpression,
): RelationTraceReference {
  return constraint.traceReference();
}

export function modelObjectRuntimeInfo(
  object: RelationObject,
): ModelObjectRuntimeInfo {
  return {
    nodeId: object.nodeId,
    name: object.name,
    sourceRefs: object.sourceRefs,
  };
}

export function relatedModelObjects(
  object: RelationObject,
): readonly RelationObject[] {
  return object.relatedObjects();
}

export type SnapshotQuery = Readonly<{key: KernelOperationKey}> &
  (
    | Readonly<{
        kind: 'bounds';
        transform: RigidTransform;
        selection: TopologySelection;
        scale: number;
      }>
    | Readonly<{kind: 'mesh'; tolerance: number; topology: boolean}>
  );
export type SnapshotQueryResult = LocalBounds | RenderMesh;
type SnapshotQueryInput = {
  inputId: string;
  geometry: {shape: AnyShape; topology?: ShapeTopology};
  query: SnapshotQuery;
};

type DistancePart =
  | Readonly<{points: readonly Vec3[]}>
  | Readonly<{
      geometry: ModelGeometry;
      selection: TopologySelection;
      transform: RigidTransform;
      scale: number;
    }>;

type DistanceResult = Readonly<{value: number; start: Vec3; end: Vec3}>;

const distanceAxes = {x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1]} as const;

function withDistanceShape<T>(
  part: DistancePart,
  visit: (shape: AnyShape) => T,
): T {
  if (!('points' in part))
    return withTransformedGeometry(part.geometry.value, part, visit);
  const points = part.points;
  if (points.length <= 2) {
    const shape =
      points.length === 1
        ? makeVertex(toPoint(points[0]))
        : makeLine(toPoint(points[0]), toPoint(points[1]));
    try {
      return visit(shape);
    } finally {
      shape.delete();
    }
  }
  const edges: ReplicadEdge[] = [];
  let wire: ReplicadWire | undefined;
  let face: ReplicadFace | undefined;
  try {
    points.forEach((point, index) =>
      edges.push(
        makeLine(toPoint(point), toPoint(points[(index + 1) % points.length])),
      ),
    );
    wire = assembleWire(edges);
    face = makeFace(wire);
    return visit(face);
  } finally {
    face?.delete();
    wire?.delete();
    edges.forEach(edge => edge.delete());
  }
}

const distanceBetweenParts = cachedArtifact(
  (a: DistancePart, b: DistancePart): DistanceResult =>
    withDistanceShape(a, left =>
      withDistanceShape(b, right => {
        const query = new (getOC().BRepExtrema_DistShapeShape)();
        try {
          query.LoadS1(left.wrapped);
          query.LoadS2(right.wrapped);
          query.Perform();
          if (!query.IsDone())
            throw new Error('distance() could not measure these geometries.');
          const first = query.PointOnShape1(1),
            second = query.PointOnShape2(1);
          try {
            return {
              value: query.Value(),
              start: [first.X(), first.Y(), first.Z()],
              end: [second.X(), second.Y(), second.Z()],
            };
          } finally {
            first.delete();
            second.delete();
          }
        } finally {
          query.delete();
        }
      }),
    ),
  {
    key: (a, b) =>
      kernelOperationKey(
        'distance-witnesses',
        [a, b].map(part =>
          'points' in part
            ? ['points', part.points]
            : [
                'shape',
                part.geometry.id,
                part.selection.kind,
                part.selection.kind === 'solid' ? null : part.selection.id,
                part.transform.position,
                part.transform.quaternion,
                part.scale,
              ],
        ),
        [a, b].flatMap(part => ('points' in part ? [] : [part.geometry])),
      ),
  },
);

function boundsQuery(
  geometry: ModelGeometry,
  transform: RigidTransform,
  selection: TopologySelection = {kind: 'solid'},
  scale = 1,
): SnapshotQueryInput {
  return {
    inputId: geometry.id,
    geometry: {shape: geometry.value.shape, topology: geometry.value.topology},
    query: {
      kind: 'bounds',
      transform,
      selection,
      scale,
      key: kernelOperationKey(
        'transformed-bounds',
        [
          transform.position,
          transform.quaternion,
          selection.kind,
          selection.kind === 'solid' ? null : selection.id,
          scale,
        ],
        [geometry],
      ),
    },
  };
}

function meshQuery(
  artifact: KernelArtifact<unknown>,
  shape: AnyShape,
  tolerance: number,
  topology?: ShapeTopology,
): SnapshotQueryInput {
  return {
    inputId: artifact.id,
    geometry: {shape, topology},
    query: {
      kind: 'mesh',
      tolerance,
      topology: topology !== undefined,
      key: kernelOperationKey(
        'render-mesh',
        [tolerance, 0.2, topology !== undefined],
        [artifact],
      ),
    },
  };
}

function computeSnapshotQuery(
  geometry: SnapshotQueryInput['geometry'],
  query: SnapshotQuery,
): SnapshotQueryResult {
  return query.kind === 'bounds'
    ? computeTransformedBounds(geometry, query)
    : computeRenderMesh(
        geometry.shape,
        query.tolerance,
        query.topology ? geometry.topology : undefined,
      );
}

const snapshotQuery = cachedArtifact(
  (input: SnapshotQueryInput): SnapshotQueryResult => {
    if (input.query.kind !== 'mesh')
      return computeSnapshotQuery(input.geometry, input.query);
    // Local and remote meshes consume the same binary input: BinTools can
    // renormalize plane axes by a few ULPs and change Delaunay diagonal ties.
    let value!: SnapshotQueryResult;
    executeSnapshotQueryBatch(
      input.inputId,
      encodeKernelArtifact(input.inputId, input.geometry),
      [input.query],
      () => {},
      (_, result) => {
        value = result;
      },
    );
    return value;
  },
  {key: input => input.query.key},
);

function evaluateSnapshotQuery(input: SnapshotQueryInput): SnapshotQueryResult {
  return snapshotQuery(input).value;
}

/** Host-owned native input and result admission. Only encode() bytes cross runtimes. */
export type SnapshotQueryBatch = Readonly<{
  id: string;
  queries: readonly SnapshotQuery[];
  weight: number;
  sourceRef?: SourceRef;
  encode(): Uint8Array;
  accept(
    query: SnapshotQuery,
    value: SnapshotQueryResult,
    milliseconds: number,
  ): void;
}>;

export function planModelSnapshotQueries(
  objects: readonly RelationObject[],
): SnapshotQueryBatch[] {
  const visited = new Set<ModelObject>();
  const inputs = new Map<
    string,
    {input: SnapshotQueryInput; sourceRef?: SourceRef}
  >();
  const batches = new Map<
    string,
    {input: SnapshotQueryInput; queries: SnapshotQuery[]; sourceRef?: SourceRef}
  >();
  function collect(object: ModelObject): void {
    if (visited.has(object)) return;
    visited.add(object);
    for (const input of object[modelSnapshotQueries]()) {
      const {query} = input;
      const existing = inputs.get(query.key.id);
      if (existing) {
        if (existing.input.query.key.signature !== query.key.signature)
          throw new Error(
            `Kernel operation cache identity collision: ${query.key.id}`,
          );
        continue;
      }
      inputs.set(query.key.id, {input, sourceRef: object.sourceRefs.at(-1)});
    }
    object.children.forEach(collect);
  }
  objects.filter(isModelObject).forEach(collect);
  const pending = [...inputs.values()];
  const hits = snapshotQuery.findMany(
    pending.map(({input}) => input.query.key),
  );
  pending.forEach(({input, sourceRef}, index) => {
    if (hits[index]) return;
    let batch = batches.get(input.inputId);
    if (!batch) {
      batch = {input, queries: [], sourceRef};
      batches.set(input.inputId, batch);
    }
    batch.queries.push(input.query);
  });
  return [...batches].map(([id, {input, queries, sourceRef}]) => ({
    id,
    queries,
    sourceRef,
    weight:
      (1 +
        (input.geometry.topology?.edges.ids.length ?? 0) +
        (input.geometry.topology?.surfaces.ids.length ?? 0)) *
      queries.length,
    encode: () => encodeKernelArtifact(id, input.geometry),
    accept: (query, value, milliseconds) =>
      snapshotQuery.accept(query.key, value, milliseconds),
  }));
}

/** Each batch owns its restored shape; completed results leave before cancellation checks. */
export function executeSnapshotQueryBatch(
  id: string,
  bytes: Uint8Array,
  queries: readonly SnapshotQuery[],
  checkCancelled: () => void,
  onResult: (
    query: SnapshotQuery,
    value: SnapshotQueryResult,
    milliseconds: number,
  ) => void,
  onRestore?: (milliseconds: number) => void,
): void {
  const started = performance.now();
  const geometry = decodeKernelArtifact<SnapshotQueryInput['geometry']>(
    bytes,
    id,
  );
  try {
    onRestore?.(performance.now() - started);
    for (const query of queries) {
      checkCancelled();
      const started = performance.now();
      const value = computeSnapshotQuery(geometry, query);
      onResult(query, value, performance.now() - started);
    }
  } finally {
    geometry.shape.delete();
  }
}

export function createModelSnapshotter(): (
  object: RelationObject,
) => ModelSnapshotObject {
  const meshCache = new Map<AnyShape, RenderMesh>();
  return object => object.toSnapshot(meshCache);
}

export function disposeModelObjects(objects: Iterable<RelationObject>): void {
  const disposed = new Set<AnyShape>();
  for (const object of objects) {
    if (isModelObject(object)) object.disposeShape(disposed);
  }
}

/** Worker-owned native geometry, independent of the author's object lifetime. */
export type ModelGeometrySnapshot = Readonly<{
  /** Borrowed shapes; clone before passing them to consuming operations. */
  shapes: ReadonlyMap<string, AnyShape>;
  inspect(
    nodeId: string,
    options?: TopologyInspectionOptions,
  ): TopologyInspection;
  dispose(): void;
}>;

export function retainModelGeometry(
  objects: Iterable<RelationObject>,
): ModelGeometrySnapshot {
  const retained = new Map<AnyShape, AnyShape>();
  const shapes = new Map<string, AnyShape>();
  const topologies = new Map<string, ShapeTopology>();
  const dispose = () => {
    for (const shape of retained.values()) shape.delete();
    retained.clear();
    shapes.clear();
    topologies.clear();
  };
  try {
    for (const object of objects) {
      if (!isModelObject(object)) continue;
      const geometry = object[modelGeometry]()?.value;
      const original = geometry?.shape;
      if (!original) continue;
      let shape = retained.get(original);
      if (!shape) {
        shape = original.clone();
        retained.set(original, shape);
      }
      shapes.set(object.nodeId, shape);
      topologies.set(object.nodeId, geometry!.topology);
    }
    return {
      shapes,
      dispose,
      inspect(nodeId, options) {
        const shape = shapes.get(nodeId);
        const topology = topologies.get(nodeId);
        if (!shape || !topology)
          throw new Error('The model geometry snapshot is unavailable.');
        return inspectShapeTopology(shape, topology, options);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export const authoringApi = Object.freeze({
  originCenter,
  input,
  timeOffset,
  dimension,
  boundsAnnotation,
  anchorAnnotation,
  captureInspectData,
  offset,
  rotate,
  pivot,
  pivotVertex,
  pivotPoint,
  axisEdge,
  axisLine,
  coupleRotation,
  on,
  align,
  cache,
  font,
  googleFont,
  text,
  sketch,
  circle,
  ellipse,
  extrude,
  rectangle,
  regularPolygon,
  point,
  line,
  arc,
  bezier,
  spline,
  loft,
  revolve,
  sweep,
  wrap,
  thicken,
  box,
  cylinder,
  tube,
  coil,
  sphere,
  ellipsoid,
  frustum,
  regularPrism,
  group,
  distance,
  union,
  cut,
  intersect,
});

function storedOperation(
  kind: ModelOperationKind,
  inputs: readonly StoredOperationInput[] = [],
  options: Readonly<{
    selections?: readonly StoredOperationSelection[];
    dimensions?: Readonly<Record<string, ModelParameterDimension>>;
  }> = {},
): StoredOperation {
  return {
    runtimeId: `operation-${nextOperationId++}`,
    kind,
    inputs: [...inputs],
    selections: [...(options.selections ?? [])],
    dimensions: options.dimensions,
  };
}

function storedOperationId(operation: StoredOperation): string {
  const trace = operationTraces.get(operation);
  return trace
    ? `${trace.siteId}:execution:${trace.execution}:output:${trace.outputIndex ?? 0}`
    : operation.runtimeId;
}

const shapeLifecycle: KernelValueLifecycle<AnyShape> = {
  estimateBytes: () => 64,
  retain: shape => shape.clone(),
  instantiate: shape => shape.clone(),
  release: shape => shape.delete(),
};

const modelGeometryLifecycle: KernelValueLifecycle<ModelGeometryValue> = {
  estimateBytes: geometry =>
    128 +
    estimateRetainedBytes([
      geometry.topology,
      geometry.localBounds,
      geometry.referenceBasis?.topology,
      geometry.referenceBasis?.transform,
    ]),
  retain: cloneModelGeometryValue,
  instantiate: cloneModelGeometryValue,
  release: disposeModelGeometryValue,
};

function cloneModelGeometryValue(
  geometry: ModelGeometryValue,
): ModelGeometryValue {
  return {
    ...geometry,
    shape: geometry.shape.clone(),
    referenceBasis: geometry.referenceBasis
      ? {
          ...geometry.referenceBasis,
          shape: geometry.referenceBasis.shape.clone(),
        }
      : undefined,
  };
}

function disposeModelGeometryValue(geometry: ModelGeometryValue): void {
  geometry.shape.delete();
  geometry.referenceBasis?.shape.delete();
}

const kernelShape = cachedArtifact(
  (
    _operation: string,
    _arguments: readonly KernelKeyPart[],
    _inputs: readonly KernelArtifact<unknown>[],
    compute: () => AnyShape,
  ) => compute(),
  {
    key: (operation, arguments_, inputs) =>
      kernelOperationKey(`kernel-shape:${operation}`, arguments_, inputs),
    lifecycle: shapeLifecycle,
  },
);

function evaluateKernelShape<Shape extends AnyShape>(
  operation: string,
  arguments_: readonly KernelKeyPart[],
  inputs: readonly KernelArtifact<unknown>[],
  compute: () => Shape,
): KernelArtifact<Shape> {
  return kernelShape(
    operation,
    arguments_,
    inputs,
    compute,
  ) as KernelArtifact<Shape>;
}

const evaluateModelGeometry = cachedArtifact(
  (
    _operation: string,
    _arguments: readonly KernelKeyPart[],
    _inputs: readonly KernelArtifact<unknown>[],
    compute: () => Readonly<{
      shape: AnyShape;
      topology?: ShapeTopology;
      referenceBasis?: ModelGeometryValue['referenceBasis'];
    }>,
  ): ModelGeometryValue => {
    const result = compute();
    return {
      ...createModelGeometryValue(result.shape, result.topology),
      referenceBasis: result.referenceBasis,
    };
  },
  {
    key: (operation, arguments_, inputs) =>
      kernelOperationKey(`model-geometry:${operation}`, arguments_, inputs),
    lifecycle: modelGeometryLifecycle,
  },
);

function createModelGeometryValue(
  shape: AnyShape,
  topology?: ShapeTopology,
): ModelGeometryValue {
  try {
    return {
      shape,
      topology: topology ?? initialShapeTopology(shape),
      localBounds: shapeBounds(shape),
    };
  } catch (error) {
    shape.delete();
    throw error;
  }
}

function evaluateSolidGeometry(
  operation: string,
  arguments_: readonly KernelKeyPart[],
  inputs: readonly KernelArtifact<unknown>[],
  compute: () => Readonly<{
    shape: Shape3D;
    topology?: ShapeTopology;
  }>,
): SolidGeometry {
  return evaluateModelGeometry(
    operation,
    arguments_,
    inputs,
    compute,
  ) as SolidGeometry;
}

function renderMesh(
  artifact: KernelArtifact<unknown>,
  shape: AnyShape,
  cache: Map<AnyShape, RenderMesh>,
  tolerance: number,
  topology?: ShapeTopology,
): RenderMesh {
  const cached = cache.get(shape);
  if (cached) {
    return cached;
  }
  const mesh = evaluateSnapshotQuery(
    meshQuery(artifact, shape, tolerance, topology),
  ) as RenderMesh;
  cache.set(shape, mesh);
  return mesh;
}

function computeRenderMesh(
  shape: AnyShape,
  tolerance: number,
  topology?: ShapeTopology,
): RenderMesh {
  const surface = shape.mesh({tolerance, angularTolerance: 0.2});
  const wire = shape.meshEdges({tolerance, angularTolerance: 0.2});
  const vertexData = topology
    ? stableVertexData(shape, topology.vertices)
    : {positions: new Float32Array(), ids: []};
  return {
    vertices: new Float32Array(surface.vertices),
    normals: new Float32Array(surface.normals),
    uvs: meshUVs(shape, surface.vertices.length / 3),
    triangles: new Uint32Array(surface.triangles),
    edges: new Float32Array(wire.lines),
    topologyVertices: vertexData.positions,
    vertexIds: vertexData.ids,
    surfaceGroups: topology
      ? stableSurfaceGroups(shape, topology.surfaces, surface.faceGroups)
      : surface.faceGroups.map((group, index) => ({
          start: group.start,
          count: group.count,
          surfaceId: index + 1,
        })),
    edgeGroups: topology
      ? stableEdgeGroups(shape, topology.edges, wire.edgeGroups)
      : wire.edgeGroups.map((group, index) => ({
          start: group.start,
          count: group.count,
          // Context-region edges have their own traversal namespace, just
          // like the surfaces above. Native handle hashes change on restore.
          edgeId: index + 1,
        })),
  };
}

function meshUVs(
  shape: AnyShape,
  vertexCount: number,
): Float32Array | undefined {
  if (!vertexCount) return undefined;
  const faces = shape.faces;
  const location = new (getOC().TopLoc_Location)();
  const uvs = new Float32Array(vertexCount * 2);
  let offset = 0;
  try {
    // Match the native mesh extractor's face/node traversal exactly.
    for (const face of faces) {
      const triangulation = getOC().BRep_Tool.Triangulation(
        face.wrapped,
        location,
        0,
      );
      // Native meshing can omit a face below its geometric tolerance.
      if (!triangulation) continue;
      try {
        if (triangulation.isNull()) continue;
        if (!triangulation.HasUVNodes()) return undefined;
        const count = triangulation.NbNodes();
        let minU = Infinity,
          minV = Infinity,
          maxU = -Infinity,
          maxV = -Infinity;
        for (let index = 0; index < count; index++) {
          const uv = triangulation.UVNode(index + 1);
          try {
            const u = uv.X(),
              v = uv.Y();
            uvs[(offset + index) * 2] = u;
            uvs[(offset + index) * 2 + 1] = v;
            minU = Math.min(minU, u);
            maxU = Math.max(maxU, u);
            minV = Math.min(minV, v);
            maxV = Math.max(maxV, v);
          } finally {
            uv.delete();
          }
        }
        for (let index = 0; index < count; index++) {
          const base = (offset + index) * 2;
          uvs[base] = maxU === minU ? 0 : (uvs[base] - minU) / (maxU - minU);
          uvs[base + 1] =
            maxV === minV ? 0 : (uvs[base + 1] - minV) / (maxV - minV);
        }
        offset += count;
      } finally {
        triangulation.delete();
      }
    }
    return uvs;
  } finally {
    location.delete();
    faces.forEach(face => face.delete());
  }
}

type PlanarSketch = Readonly<{
  face(): ReplicadFace;
  delete(): void;
}>;

/** Internal bridge from the kernel-independent sketch definition to model geometry. */
function sketchFaceModel(
  region: SketchRegion,
  placements: readonly StoredPlacement[],
  source: SketchFrame,
): FaceModel {
  const curves = [region.outer, ...region.holes].map(loop =>
    loop.map(curve =>
      curve.kind === 'line'
        ? ['line', curve.points]
        : curve.kind === 'circle'
          ? ['circle', curve.center, curve.radius]
          : ['arc', curve.center, curve.radius, curve.start, curve.sweep],
    ),
  );
  const geometry = evaluateModelGeometry('sketchFace', curves, [], () => ({
    shape: sketchRegionFace(region),
  }));
  const plane: StoredElement = {
    kind: 'face',
    transform: identityRigidTransform,
  };
  return ModelObject.create<PlanarElements, 'face'>({
    kind: 'face',
    name: 'Sketch face',
    placements,
    geometry,
    geometryAnchor: plane,
    elements: {plane},
    operation: storedOperation('sketchFace', [
      {model: source, role: 'source', index: 0},
    ]),
  }) as unknown as FaceModel;
}

function planarFaceModel(
  operation: Extract<
    ModelOperationKind,
    'circle' | 'ellipse' | 'rectangle' | 'regularPolygon'
  >,
  name: string,
  arguments_: readonly KernelKeyPart[],
  buildSketch: () => PlanarSketch,
  transform?: (face: ReplicadFace) => ReplicadFace,
): FaceModel {
  const geometry = evaluateModelGeometry(operation, arguments_, [], () => {
    const sketch = buildSketch();
    try {
      const face = sketch.face();
      // Replicad's XZ sketches face -Y. Core's planar profiles face +Y;
      // normalize the native face before normals, offsets and sweeps consume it.
      face.wrapped.Reverse();
      return {shape: transform?.(face) ?? face};
    } finally {
      sketch.delete();
    }
  });
  return faceModel(operation, name, geometry);
}

function faceModel(
  operation: ModelOperationKind,
  name: string,
  geometry: ModelGeometry,
): FaceModel {
  const plane: StoredElement = {
    kind: 'face',
    transform: identityRigidTransform,
  };
  return ModelObject.create<PlanarElements, 'face'>({
    kind: 'face',
    name,
    geometry,
    geometryAnchor: plane,
    elements: {
      plane,
    },
    operation: storedOperation(operation),
  }) as unknown as FaceModel;
}

function curveModel(
  operation: Extract<ModelOperationKind, 'line' | 'arc' | 'bezier' | 'spline'>,
  name: string,
  arguments_: readonly KernelKeyPart[],
  build: () => ReplicadEdge,
): EdgeModel {
  const geometry = evaluateModelGeometry(operation, arguments_, [], () => ({
    shape: build(),
  }));
  const elements = curveElements(geometry.value.shape as ReplicadEdge);
  return ModelObject.create<CurveElements, 'edge'>({
    kind: 'edge',
    name,
    geometry,
    geometryAnchor: {...elements.start, kind: 'line'},
    elements,
    operation: storedOperation(operation),
  }) as unknown as EdgeModel;
}

function curveElements(curve: ReplicadEdge): Readonly<{
  start: StoredElement;
  midpoint: StoredElement;
  end: StoredElement;
}> {
  return {
    start: curveAnchor(curve, 0),
    midpoint: curveAnchor(curve, 0.5),
    end: curveAnchor(curve, 1),
  };
}

function curveAnchor(curve: ReplicadEdge, position: number): StoredElement {
  const point = curve.pointAt(position);
  const tangent = curve.tangentAt(position);
  try {
    return {
      kind: 'point',
      transform: frameFromYAxis(point.toTuple(), tangent.toTuple()),
    };
  } finally {
    point.delete();
    tangent.delete();
  }
}

type PositionedModelGeometry = Readonly<{
  geometry: ModelGeometry;
  transform: RigidTransform;
}>;

function buildLoftGeometry(
  sections: readonly PositionedModelGeometry[],
  spine: PositionedModelGeometry | undefined,
  ruled: boolean,
): Readonly<{shape: Shape3D; topology: ShapeTopology}> {
  const inputs: {
    shape: ReplicadFace;
    topology: ShapeTopology;
    namespace: number;
  }[] = [];
  let spineWire: ReplicadWire | undefined;
  try {
    for (const [index, section] of sections.entries()) {
      inputs.push({
        shape: shapeWithTransform(
          section.geometry.value.shape as ReplicadFace,
          section.transform,
        ),
        topology: section.geometry.value.topology,
        namespace: index + 1,
      });
    }
    if (spine) {
      const edge = shapeWithTransform(
        spine.geometry.value.shape as ReplicadEdge,
        spine.transform,
      );
      try {
        spineWire = assembleWire([edge]);
      } finally {
        edge.delete();
      }
    }
    return loftWithTopology(inputs, spineWire, ruled);
  } finally {
    inputs.forEach(input => input.shape.delete());
    spineWire?.delete();
  }
}

function shapeBounds(shape: AnyShape): LocalBounds {
  const boundingBox = new BoundingBox();
  try {
    // Use analytic geometry, independent of whether a viewport has meshed it.
    getOC().BRepBndLib.AddOptimal(
      shape.wrapped,
      boundingBox.wrapped,
      false,
      false,
    );
    const [minimum, maximum] = boundingBox.bounds;
    return [
      [minimum[0], minimum[1], minimum[2]],
      [maximum[0], maximum[1], maximum[2]],
    ];
  } finally {
    boundingBox.delete();
  }
}

function boundsCenter(bounds: LocalBounds): Vec3 {
  const [[minX, minY, minZ], [maxX, maxY, maxZ]] = bounds;
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

function solidElements(bounds: LocalBounds): StoredElements {
  return {axis: {kind: 'line', transform: translation(boundsCenter(bounds))}};
}

function constraintReferences(constraint: StoredPlacement): RelationObject[] {
  return [
    ...(constraint.kind === 'transformation'
      ? []
      : [constraint.source.model, constraint.target.model]),
    ...(constraint.kind === 'transformation' ? constraint.actions : []).map(
      action =>
        'pivot' in action ? selectionReference(action.pivot)?.model : undefined,
    ),
  ].filter((model): model is RelationObject => !!model);
}

/** Signed axis permutations preserve tight bounds; arbitrary rotations do not. */
function axisAlignedBounds(
  bounds: LocalBounds,
  transform: RigidTransform,
): LocalBounds | undefined {
  const axes = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const
  ).map(axis => rotateVector(axis, transform.quaternion));
  // Account only for floating-point roundoff in quarter-turn quaternion products.
  if (
    axes.some(axis =>
      axis.some(
        value => Math.abs(value - Math.round(value)) > 8 * Number.EPSILON,
      ),
    )
  )
    return;
  return [0, 1].map(side =>
    axes[0].map((_, output) => {
      const input = axes.findIndex(axis => Math.abs(axis[output]) > 0.5);
      const sign = Math.round(axes[input][output]);
      return (
        transform.position[output] +
        sign * bounds[sign > 0 ? side : 1 - side][input]
      );
    }),
  ) as unknown as LocalBounds;
}

function computeTransformedBounds(
  geometry: SnapshotQueryInput['geometry'],
  query: Extract<SnapshotQuery, {kind: 'bounds'}>,
): LocalBounds {
  return withTransformedGeometry(geometry, query, shapeBounds);
}

/** Borrow the input, and release all selected/transformed handles after the query. */
function withTransformedGeometry<T>(
  geometry: SnapshotQueryInput['geometry'],
  query: Readonly<{
    transform: RigidTransform;
    selection: TopologySelection;
    scale: number;
  }>,
  visit: (shape: AnyShape) => T,
): T {
  const {transform, selection, scale} = query;
  return withTopologyShape(
    geometry.shape,
    geometry.topology!,
    selection,
    shape => {
      const scaled = scale === 1 ? shape : shapeWithScale(shape, scale);
      try {
        const moved = shapeWithTransform(scaled, transform);
        try {
          return visit(moved);
        } finally {
          moved.delete();
        }
      } finally {
        if (scaled !== shape) scaled.delete();
      }
    },
  );
}

function pointBounds(points: readonly Vec3[]): LocalBounds {
  if (!points.length)
    throw new Error('Empty geometry has no directional bounds.');
  return [
    [0, 1, 2].map(axis =>
      Math.min(...points.map(point => point[axis])),
    ) as unknown as Vec3,
    [0, 1, 2].map(axis =>
      Math.max(...points.map(point => point[axis])),
    ) as unknown as Vec3,
  ];
}
function combineBounds(bounds: readonly LocalBounds[]): LocalBounds {
  return pointBounds(bounds.flat());
}

const boundDirections = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
} as const;

function directionalBound(
  reference: AnchorReference,
  direction: keyof typeof boundDirections,
): Bound {
  const quaternion = frameFromYAxis(
    origin,
    boundDirections[direction],
  ).quaternion;
  const bounds = reference.model[referenceBounds](
    reference,
    invertTransform(rotation(quaternion)),
  );
  const center: Vec3 = [
    (bounds[0][0] + bounds[1][0]) / 2,
    bounds[1][1],
    (bounds[0][2] + bounds[1][2]) / 2,
  ];
  return modelAnchor(
    reference.model,
    reference.whole ? direction : `${reference.name}.${direction}`,
    {
      kind: 'face',
      transform: composeTransforms(rotation(quaternion), translation(center)),
      bound: {
        size: [bounds[1][0] - bounds[0][0], bounds[1][2] - bounds[0][2]],
        facing: 1,
      },
    },
  ) as Bound;
}

function modelAnchor<Kind extends ElementKind>(
  model: RelationObject,
  name: string,
  element: StoredElement & Readonly<{kind: Kind}>,
): Anchor<Kind> {
  const reference = {...element, model, name};
  return (
    element.topology
      ? new ModelTopologyElement(reference)
      : element.kind === 'frame'
        ? new ModelFrameAnchor(reference)
        : new ModelAnchor<Kind>(reference)
  ) as Anchor<Kind>;
}

function snapshotElements(
  elements: StoredElements,
  prefix = '',
): readonly ElementSnapshot[] {
  return Object.entries(elements).flatMap(([key, element]) => {
    const name = `${prefix}${key}`;
    const topology = element.topology;
    return [
      {
        name,
        kind: element.kind,
        transform: toTransform(element.transform),
        bound: element.bound,
        facing: element.facing,
        direction: element.direction,
        topology: topology
          ? {
              geometryNodeId: topology.source.nodeId,
              transform: {
                ...topology.transform,
                scale: [topology.scale, topology.scale, topology.scale] as Vec3,
              },
              ...topology.selection,
            }
          : undefined,
      },
      ...snapshotElements(element.members ?? {}, `${name}.`),
    ];
  });
}

function scaleElements(
  elements: StoredElements,
  factor: number,
): StoredElements {
  return Object.fromEntries(
    Object.entries(elements).map(([name, element]) => [
      name,
      scaleElement(element, factor),
    ]),
  );
}

function transformElement(
  element: StoredElement,
  transform: RigidTransform,
): StoredElement {
  return {
    ...element,
    transform: composeTransforms(transform, element.transform),
    topology: element.topology
      ? {
          ...element.topology,
          transform: composeTransforms(transform, element.topology.transform),
        }
      : undefined,
    parts: element.parts?.map(part => ({
      ...part,
      transform: composeTransforms(transform, part.transform),
    })),
    members: element.members
      ? Object.fromEntries(
          Object.entries(element.members).map(([name, member]) => [
            name,
            transformElement(member, transform),
          ]),
        )
      : undefined,
  };
}

function scaleElement(element: StoredElement, factor: number): StoredElement {
  return {
    ...element,
    bound: element.bound
      ? {
          ...element.bound,
          size: [
            element.bound.size[0] * factor,
            element.bound.size[1] * factor,
          ],
        }
      : undefined,
    topology: element.topology
      ? {
          ...element.topology,
          scale: element.topology.scale * factor,
          transform: scaleFrame(element.topology.transform, factor),
        }
      : undefined,
    parts: element.parts?.map(part => ({
      ...part,
      scale: part.scale * factor,
      transform: scaleFrame(part.transform, factor),
    })),
    members: element.members
      ? scaleElements(element.members, factor)
      : undefined,
    transform: {
      ...element.transform,
      position: [
        element.transform.position[0] * factor,
        element.transform.position[1] * factor,
        element.transform.position[2] * factor,
      ],
    },
  };
}

function scaleFrame(transform: RigidTransform, factor: number): RigidTransform {
  return {
    ...transform,
    position: transform.position.map(
      value => value * factor,
    ) as unknown as Vec3,
  };
}

function topologyTransform(
  topology: Pick<StoredTopology, 'transform' | 'scale'>,
  frame: RigidTransform,
): RigidTransform {
  return composeTransforms(
    topology.transform,
    scaleFrame(frame, topology.scale),
  );
}

function topologyCenter(
  geometry: ModelGeometry,
  selection: TopologySelection,
): RigidTransform {
  const {referenceBasis, shape, topology} = geometry.value;
  if (referenceBasis)
    return withTopologyShape(
      referenceBasis.shape,
      referenceBasis.topology,
      selection,
      selected =>
        topologyTransform(
          referenceBasis,
          translation(boundsCenter(shapeBounds(selected))),
        ),
    );
  return withTopologyShape(shape, topology, selection, selected =>
    translation(boundsCenter(shapeBounds(selected))),
  );
}

function transformedReferenceBasis(
  source: ModelGeometry,
  transform: RigidTransform,
  scale: number,
): NonNullable<ModelGeometryValue['referenceBasis']> {
  const basis = source.value.referenceBasis;
  return {
    shape: (basis?.shape ?? source.value.shape).clone(),
    topology: basis?.topology ?? source.value.topology,
    transform: composeTransforms(
      transform,
      scaleFrame(basis?.transform ?? identityRigidTransform, scale),
    ),
    scale: (basis?.scale ?? 1) * scale,
  };
}

function topologyName(selection: TopologySelection): string {
  return selection.kind === 'solid'
    ? 'solid'
    : formatTopologyId(selection.kind, selection.id);
}

function topologyReferences(
  model: RelationObject,
  prefix: string,
  context: Omit<StoredTopology, 'selection'>,
  kind: TopologyKind,
  ids: readonly TopologyId[],
): readonly ModelTopologyElement[] {
  const geometry = context.source[modelGeometry]()!.value;
  const basis = geometry.referenceBasis;
  const {shape, topology} = basis ?? geometry;
  const frames =
    kind === 'vertex'
      ? topologyVertexPoints(shape, topology.vertices, ids).map(point =>
          translation(point.position),
        )
      : (kind === 'edge'
          ? topologyEdgeDirections(shape, topology.edges, ids)
          : topologySurfaceDirections(shape, topology.surfaces, ids)
        ).map(({position, direction}) => frameFromYAxis(position, direction));
  return ids.map((id, index) => {
    const selection = {kind, id};
    return new ModelTopologyElement({
      model,
      name: `${prefix}${topologyName(selection)}`,
      kind: topologyElementKinds[kind],
      transform: topologyTransform(
        context,
        basis ? topologyTransform(basis, frames[index]) : frames[index],
      ),
      topology: {...context, selection},
    });
  });
}

function boundReference(target: Bound): AnchorReference {
  const reference =
    target instanceof ModelAnchor ? target[anchorReferenceValue] : undefined;
  if (!reference?.bound)
    throw new Error(
      'on() requires a directional bound: up, down, left, right, front, or back.',
    );
  return reference;
}

function anchorReference(anchor: Anchor): AnchorReference {
  if (anchor instanceof ModelObject) {
    return anchor.relationAnchorReference();
  }
  return (anchor as ModelAnchor)[anchorReferenceValue];
}

function anchorSnapshot(reference: AnchorReference): ConstraintAnchorSnapshot;
function anchorSnapshot(
  model: RelationObject,
  anchor: StoredAnchor,
): ConstraintAnchorSnapshot;
function anchorSnapshot(
  modelOrReference: RelationObject | AnchorReference,
  stored?: StoredAnchor,
): ConstraintAnchorSnapshot {
  const model = stored ? (modelOrReference as RelationObject) : undefined;
  const reference = stored ?? (modelOrReference as AnchorReference);
  return {
    nodeId: (model ?? (modelOrReference as AnchorReference).model).nodeId,
    name: reference.name,
    kind: reference.kind,
  };
}

function uniqueModels<T extends RelationObject>(models: readonly T[]): T[] {
  return [...new Set(models)];
}

function toTransform(transform: RigidTransform): Transform {
  return {...transform, scale: unitScale};
}

function shapeWithTransform<Shape extends AnyShape>(
  source: Shape,
  transform: RigidTransform,
): Shape {
  const oc = getOC();
  let shape = source.clone() as Shape;
  const {axis, angleDegrees} = quaternionAxisAngle(transform.quaternion);
  try {
    if (Math.abs(angleDegrees) > 1e-9) {
      const rotated = transformShape(shape, value => {
        const point = new oc.gp_Pnt(0, 0, 0);
        const direction = new oc.gp_Dir(...axis);
        const rotationAxis = new oc.gp_Ax1(point, direction);
        try {
          value.SetRotation(rotationAxis, angleDegrees * (Math.PI / 180));
        } finally {
          rotationAxis.delete();
          direction.delete();
          point.delete();
        }
      });
      shape.delete();
      shape = rotated;
    }
    return transformShape(shape, value => {
      const vector = new oc.gp_Vec(...transform.position);
      try {
        value.SetTranslation(vector);
      } finally {
        vector.delete();
      }
    });
  } finally {
    shape.delete();
  }
}

function shapeWithScale<Shape extends AnyShape>(
  source: Shape,
  scale: number,
): Shape {
  return transformShape(source, value => {
    const point = new (getOC().gp_Pnt)(0, 0, 0);
    try {
      value.SetScale(point, scale);
    } finally {
      point.delete();
    }
  });
}

function requireModelObject(value: unknown, message: string): ModelObject {
  if (!isModelObject(value)) {
    throw new Error(message);
  }
  return value;
}

function requireModelKind<Kind extends ModelKind>(
  value: unknown,
  kind: Kind,
  message: string,
): ModelObject<{}, Kind> {
  const object = requireModelObject(value, message);
  if (object.kind !== kind) {
    throw new Error(message);
  }
  return object as ModelObject<{}, Kind>;
}

/** @internal */
export namespace box {
  export function inspectDimension(
    args: [number, number, number],
    context: InspectContext<SolidModel>,
  ): InspectResult | undefined {
    if (!context.return) return undefined;
    const parameter = context.focused.parameter!;
    const value = args[['x', 'y', 'z'].indexOf(parameter)];
    return {
      target: [
        context.return,
        ModelObject.inspectDimension(
          context.return,
          parameter,
          value,
          context.return,
          identityRigidTransform,
          parameter.toUpperCase(),
        ),
      ],
    };
  }
}

/** @internal */
export namespace extrude {
  export function inspectFaces(
    [face, distance]: [FaceModel<{}> | readonly FaceModel<{}>[], number],
    context: InspectContext<
      SolidModel | readonly SolidModel[],
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const faces = (
      Array.isArray(face) ? face : [face]
    ) as readonly FaceModel<{}>[];
    const results = (
      Array.isArray(context.return)
        ? context.return
        : context.return
          ? [context.return]
          : []
    ) as readonly SolidModel[];
    return ModelObject.inspectExtrude(
      faces,
      results,
      distance,
      context.focused.parameter,
      context.data,
    );
  }
  export function inspectMethod(
    [distance]: [number],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectExtrude(
        [context.receiver],
        context.return ? [context.return] : [],
        distance,
        context.focused.parameter,
        context.data,
      )
    );
  }
}

/** @internal */
export namespace revolve {
  export function inspectProfile(
    [profile, axis]: [FaceModel<{}>, LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        profile,
        axis,
        context.return,
        context.data,
        'profile',
      )
    );
  }

  export function inspectAxis(
    [profile, axis]: [FaceModel<{}>, LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        profile,
        axis,
        context.return,
        context.data,
        'axis',
      )
    );
  }

  export function inspectMethodProfile(
    [axis]: [LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        context.receiver,
        axis,
        context.return,
        context.data,
        'profile',
      )
    );
  }

  export function inspectMethodAxis(
    [axis]: [LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        context.receiver,
        axis,
        context.return,
        context.data,
        'axis',
      )
    );
  }
}

/** @internal */
export namespace sweep {
  export function inspectProfile(
    [profile, spine]: [FaceModel<{}>, EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [spine, ...(context.return ? [context.return] : [])],
      [profile],
    );
  }

  export function inspectSpine(
    [profile, spine]: [FaceModel<{}>, EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [profile, ...(context.return ? [context.return] : [])],
      [spine],
    );
  }

  export function inspectMethodProfile(
    [spine]: [EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectProfile([context.receiver, spine], context);
  }

  export function inspectMethodSpine(
    [spine]: [EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectSpine([context.receiver, spine], context);
  }
}

/** @internal */
export namespace union {
  export function inspectOperands(
    [operands]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(context.data, [], operands);
  }
}

/** @internal */
export namespace intersect {
  export function inspectOperands(
    [operands]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const focused = new Set(context.focused.solids);
    const scene = ModelObject.inspectComposition(
      context.data,
      operands.filter(operand => !focused.has(operand)),
      operands.filter(operand => focused.has(operand)),
    );
    if (!context.return) return scene;
    const result = ModelObject.inspectComposition(
      context.data,
      [],
      [context.return],
    ).target![0] as Model;
    return {
      ...scene,
      target: [
        ...scene.target!,
        result.material(inspectionRegionMaterial('#66c9ff')),
      ],
    };
  }
}

/** Generated inspect regions remain legible through their translucent inputs. */
function inspectionRegionMaterial(color: string): Material {
  return new MeshBasicMaterial({color, depthTest: false, toneMapped: false});
}

/** @internal */
export namespace cut {
  export function inspectStock(
    [stock, tools]: [SolidModel<{}>, readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(context.data, tools, [stock]);
  }
  export function inspectTools(
    [stock, tools]: [SolidModel<{}>, readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectCutTools(
      stock,
      tools,
      context.focused.solids,
      context.data,
    );
  }
  export function inspectReceiver(
    [tools]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      SolidModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectStock([context.receiver, tools], context);
  }
  export function inspectMethodTools(
    [tools]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      SolidModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectTools([context.receiver, tools], context);
  }
}

/** @internal */
export namespace loft {
  export function inspectSections(
    [sections, {spine} = {}]: [readonly FaceModel<{}>[], LoftOptions?],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [...(context.return ? [context.return] : []), ...(spine ? [spine] : [])],
      sections,
    );
  }
  export function inspectSpine(
    [sections, {spine} = {}]: [readonly FaceModel<{}>[], LoftOptions?],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [...sections, ...(context.return ? [context.return] : [])],
      spine ? [spine] : [],
    );
  }
}

function booleanOperands(
  operation: 'union' | 'intersect',
  operands: readonly SolidModel<{}>[],
): Readonly<{
  first: ModelObject<{}, 'solid'>;
  others: readonly ModelObject<{}, 'solid'>[];
}> {
  if (operands.length < 2) {
    throw new Error(`${operation} requires at least two model operands.`);
  }
  const runtimeOperands = operands.map(operand =>
    requireModelKind(
      operand,
      'solid',
      `Every ${operation} operand must be a solid model.`,
    ),
  );
  return {first: runtimeOperands[0], others: runtimeOperands.slice(1)};
}

function assertPositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertFiniteVector(label: string, value: Vec3): void {
  if (value.some(component => !Number.isFinite(component))) {
    throw new Error(`${label} must be a finite number.`);
  }
}

function assertCurvePoints(
  label: string,
  points: readonly Vec3[],
  minimum: number,
): void {
  if (points.length < minimum) {
    throw new Error(`${label} requires at least ${minimum} points.`);
  }
  points.forEach((point, index) =>
    assertFiniteVector(`${label} point ${index + 1}`, point),
  );
  const [first, ...rest] = points;
  if (
    rest.every(point =>
      point.every((component, index) => component === first[index]),
    )
  ) {
    throw new Error(`${label} requires at least two distinct points.`);
  }
}

function toPoint(vector: Vec3): [number, number, number] {
  return [vector[0], vector[1], vector[2]];
}

function appendUniqueParameters(
  destination: ParameterUsage[],
  parameters: readonly ParameterUsage[],
): void {
  for (const parameter of parameters) {
    if (!hasParameter(destination, parameter)) {
      destination.push(parameter);
    }
  }
}

function uniqueParameters(
  parameters: readonly ParameterUsage[],
): ParameterUsage[] {
  const unique: ParameterUsage[] = [];
  appendUniqueParameters(unique, parameters);
  return unique;
}

function hasParameter(
  parameters: readonly ParameterUsage[],
  parameter: ParameterUsage,
): boolean {
  return parameters.some(
    candidate =>
      candidate.operation === parameter.operation &&
      candidate.argument === parameter.argument &&
      candidate.operationRef.file === parameter.operationRef.file &&
      candidate.operationRef.start === parameter.operationRef.start &&
      candidate.operationRef.end === parameter.operationRef.end &&
      candidate.expressionRef.file === parameter.expressionRef.file &&
      candidate.expressionRef.start === parameter.expressionRef.start &&
      candidate.expressionRef.end === parameter.expressionRef.end &&
      candidate.target.id === parameter.target.id,
  );
}

/** @internal */
export namespace wrap {
  function inspect(
    [profiles, target]: [
      FaceModel<{}> | readonly FaceModel<{}>[],
      Surface | FaceModel<{}>,
    ],
    context: InspectContext<
      readonly FaceModel<{}>[],
      unknown,
      CompositionInspectData | undefined
    >,
    focus: 'profiles' | 'target',
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const faces = Array.isArray(profiles) ? profiles : [profiles];
    return ModelObject.inspectComposition(
      context.data,
      focus === 'profiles'
        ? [target, ...(context.return ?? [])]
        : [...faces, ...(context.return ?? [])],
      focus === 'profiles' ? faces : [target],
    );
  }
  export function inspectProfiles(
    args: [FaceModel<{}> | readonly FaceModel<{}>[], Surface | FaceModel<{}>],
    context: InspectContext<
      readonly FaceModel<{}>[],
      unknown,
      CompositionInspectData | undefined
    >,
  ) {
    return inspect(args, context, 'profiles');
  }
  export function inspectTarget(
    args: [FaceModel<{}> | readonly FaceModel<{}>[], Surface | FaceModel<{}>],
    context: InspectContext<
      readonly FaceModel<{}>[],
      unknown,
      CompositionInspectData | undefined
    >,
  ) {
    return inspect(args, context, 'target');
  }
}
/** @internal */
export namespace thicken {
  export function inspectFaces(
    [face]: [FaceModel<{}> | readonly FaceModel<{}>[], number],
    context: InspectContext<
      SolidModel | readonly SolidModel[],
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const results = context.return
      ? Array.isArray(context.return)
        ? context.return
        : [context.return]
      : [];
    return ModelObject.inspectComposition(
      context.data,
      results,
      Array.isArray(face) ? face : [face],
    );
  }
  export function inspectMethod(
    [thickness]: [number],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectFaces([context.receiver, thickness], context);
  }
}
