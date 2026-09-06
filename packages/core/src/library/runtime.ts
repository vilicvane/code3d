import {
  assembleWire,
  basicFaceExtrusion,
  BoundingBox,
  genericSweep,
  getOC,
  makeBSplineApproximation,
  makeBezierCurve,
  makeCircle,
  makeCylinder,
  makeFace,
  makeHelix,
  makeLine,
  makeSphere,
  makeThreePointArc,
  makeVertex,
  sketchCircle,
  sketchEllipse,
  sketchPolysides,
  sketchRectangle,
  Vector,
  type AnyShape,
  type Edge as ReplicadEdge,
  type Face as ReplicadFace,
  type Vertex as ReplicadVertex,
  type Shape3D,
  type Wire as ReplicadWire,
} from 'replicad';
import {
  castOwnedShape,
  castOwnedShape3D,
  centeredBoxShape,
  shapeSubshapes,
} from './kernel-shapes.js';
import {
  addVectors,
  composeTransforms,
  frameFromYAxis,
  identityRigidTransform,
  invertTransform,
  rotateVector,
  origin,
  quaternionAxisAngle,
  relativeTransform,
  rotation,
  rotationAround,
  translation,
  type Quaternion,
  type RigidTransform,
  type Vec3,
} from './spatial.js';
import {
  axisRotation,
  solveBodies,
  type Body,
  type BodyRotation,
} from './relation-solver.js';
import {
  edgeGeometry,
  faceGeometry,
  transformGeometry,
  type AlignmentGeometry,
} from './alignment-geometry.js';
import {shellWithTopology} from './shell.js';
import {
  evaluateKernelOperation,
  type KernelArtifact,
  type KernelKeyPart,
  type KernelValueLifecycle,
} from './kernel-cache.js';
import {loftWithTopology} from './loft.js';
import {formatTopologyId, type TopologyId} from './topology-id.js';
import {
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
  topologyEdgeDirections,
  topologySurfaceDirections,
  topologyVertexPoints,
  topologyChildren,
  withTopologyShape,
  type EdgeId,
  type ShapeTopology,
  type SurfaceId,
  type TopologyKind,
  type TopologySelection,
  type VertexId,
} from './topology.js';

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
  arrow?: RigidTransform;
  topology?: Readonly<{geometryNodeId: string; transform: Transform}> &
    TopologySelection;
}>;

export type ConstraintAnchorSnapshot = Readonly<{
  nodeId: string;
  name: string;
  kind: ElementKind;
}>;

export type ConstraintSnapshot = Readonly<{
  id: string;
  kind: 'on' | 'align';
  source: ConstraintAnchorSnapshot;
  target: ConstraintAnchorSnapshot;
  sourceElement: ElementSnapshot;
  targetElement: ElementSnapshot;
  offsetDirection: 1 | -1;
  offset: Vec3;
  offsetFrame: Transform;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
}>;

export type ModelOperationKind =
  | 'box'
  | 'cylinder'
  | 'tube'
  | 'coil'
  | 'sphere'
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
  | 'primitive'
  | 'paint'
  | 'scaled'
  | 'origin'
  | 'originOffset'
  | 'originVertex'
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

export type ModelOperationRegionSnapshot = Readonly<{
  kind: 'intersection' | 'section';
  inputNodeId: string;
  mesh: RenderMesh;
}>;

export type ModelOperationSelectionSnapshot = Readonly<{
  kind: 'edge' | 'surface';
  inputNodeId: string;
  ids: readonly TopologyId[];
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
  regions: readonly ModelOperationRegionSnapshot[];
  selections: readonly ModelOperationSelectionSnapshot[];
  sourceRef?: SourceRef;
  spatial?: ModelSpatialOperation;
}>;

/** Local geometry coordinates; vector is the authored coordinates, offset, or angles. */
export type ModelSpatialOperation = Readonly<{
  origin: Vec3;
  vector: Vec3;
  /** Relation edits use self's frame at this authored operation. */
  frame?: RigidTransform;
  rotation?: Vec3;
  axisOnly?: boolean;
}>;

export type ConstraintSpatialReference = Readonly<{
  nodeId: string;
  kind: 'pivot' | 'pivotVertex' | 'around' | 'rotate';
  spatial: ModelSpatialOperation;
}>;

export type RenderMesh = Readonly<{
  /** Tessellation vertices used by the triangle mesh. */
  vertices: Float32Array;
  normals: Float32Array;
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
  }>[];
}>;

export type ModelSnapshotObject = Readonly<{
  nodeId: string;
  kind: ModelKind;
  name: string;
  /** Effective color, including recursive overrides from enclosing groups. */
  color?: string;
  children: readonly ModelSnapshotObject[];
  /** Placement used when this snapshot participates in a composition. */
  compositionTransform: Transform;
  /** Placement in this snapshot tree; a root value keeps its intrinsic frame. */
  transform: Transform;
  constraints: readonly ConstraintSnapshot[];
  elements: readonly ElementSnapshot[];
  origin: Vec3;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
  operation: ModelOperationSnapshot;
  mesh?: RenderMesh;
}>;

type StoredElement = Readonly<{
  kind: ElementKind;
  transform: RigidTransform;
  whole?: boolean;
  bound?: Readonly<{size: readonly [number, number]; facing: 1 | -1}>;
  facing?: 1 | -1;
  direction?: 1 | -1;
  topology?: StoredTopology;
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

type AnchorReference = StoredAnchor & Readonly<{model: ModelObject}>;

export type ModelElementReference = Readonly<{
  model: ModelObject;
  name: string;
  kind: ElementKind;
  transform: Transform;
  bound?: ElementSnapshot['bound'];
  facing?: 1 | -1;
  direction?: 1 | -1;
}>;

export type ModelTopologyReference = Readonly<{
  model: ModelObject;
  geometry: ModelObject;
  transform: Transform;
}> &
  TopologySelection;

export type ConstraintTraceReference = Readonly<{
  constraintId: string;
  source: ModelObject;
  target: ModelObject;
  self?: ModelObject;
}>;

export type ModelOperationInstrumentation = Readonly<{
  siteId: string;
  execution: number;
  order: number;
  sourceRef: SourceRef;
  parameters: readonly ParameterUsage[];
}>;

export type ModelObjectRuntimeInfo = Readonly<{
  nodeId: string;
  name: string;
  sourceRefs: readonly SourceRef[];
}>;

type StoredConstraint = Readonly<{
  id: string;
  kind: 'on' | 'align';
  source: RelationReference;
  target: RelationReference;
  rotations: readonly ConstraintRotation[];
  offset: Vec3 | undefined;
}>;

// An omitted model refers to relate's self, including after immutable copies.
type RelationReference = StoredAnchor & Readonly<{model?: ModelObject}>;
type PivotSelection =
  | Readonly<{kind: 'pivot'; point: Vec3}>
  | Readonly<{kind: 'pivotVertex'; id: VertexId}>
  | Readonly<{kind: 'around'; axis: RelationReference}>;
type ConstraintRotation = Readonly<{
  pivot: PivotSelection;
  angles: Vec3 | number;
}>;
type ConstraintSpatialSelection = Readonly<{
  kind: ConstraintSpatialReference['kind'];
  pivot: PivotSelection;
}>;
type RelateContext = Readonly<{self: ModelObject; original: ModelObject}>;
let activeRelate: RelateContext | undefined;

type StoredOperationInput = Readonly<{
  model: ModelObject;
  role: ModelOperationInputRole;
  index: number;
}>;

type StoredOperationRegion = Readonly<{
  kind: 'intersection' | 'section';
  input: ModelObject;
  artifact: KernelArtifact<AnyShape>;
}>;

type StoredOperationSelection = Readonly<{
  kind: 'edge' | 'surface';
  input: ModelObject;
  ids: readonly TopologyId[];
}>;

type StoredOperation = {
  runtimeId: string;
  kind: ModelOperationKind;
  inputs: StoredOperationInput[];
  regions: StoredOperationRegion[];
  selections: StoredOperationSelection[];
  spatial?: ModelSpatialOperation;
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

/** Start a fresh, serial tooling evaluation without invalidating model geometry. */
export function beginModelEvaluation(): void {
  valueTraces = new WeakMap();
  operationTraces = new WeakMap();
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
  geometry: SolidGeometry;
  regions: readonly StoredOperationRegion[];
}>;

type ModelObjectInit<Kind extends ModelKind = ModelKind> = Readonly<{
  kind: Kind;
  geometry?: ModelGeometry;
  intrinsic?: StoredElement;
  name?: string;
  color?: string;
  children?: readonly ModelObject[];
  constraints?: readonly StoredConstraint[];
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
  poses: Map<ModelObject, RigidTransform>;
};

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
const anchorReferenceValue = Symbol('anchorReference');
const modelFamily = Symbol('modelFamily');
const modelNamedElements = Symbol('modelNamedElements');

export interface Anchor<Kind extends ElementKind = ElementKind> {
  readonly [anchorKind]: Kind;
  /** Translate this geometry's matching bound onto the directed target bound. */
  on(target: Bound): Constraint;
  /** Align the underlying geometry, retaining unconstrained position and orientation. */
  align(
    this: Anchor<'point' | 'line' | 'face'>,
    target: Anchor<'point' | 'line' | 'face'>,
  ): Constraint;
}

export interface PointAnchor extends Anchor<'point'> {}

export interface LineAnchor extends Anchor<'line'> {
  /** Reverse direction without changing geometry or the reference coordinate axes. */
  reverse(): this;
}

export interface FaceAnchor extends Anchor<'face'> {
  /** Reverse facing without changing geometry, position, or the reference axes. */
  flip(): this;
}

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

export interface Edge
  extends LineAnchor, GeometryQueryCapabilities, EdgeTopologyCapabilities {
  readonly kind: 'edge';
  readonly id: EdgeId;
  readonly start: PointAnchor;
  readonly midpoint: PointAnchor;
  readonly end: PointAnchor;
}

export interface Surface
  extends FaceAnchor, GeometryQueryCapabilities, SurfaceTopologyCapabilities {
  readonly kind: 'surface';
  readonly id: SurfaceId;
}

export interface Solid
  extends
    Anchor<'frame'>,
    GeometryQueryCapabilities,
    SurfaceTopologyCapabilities {
  readonly kind: 'solid';
}

export type ElementSources = Readonly<Record<string, Anchor>>;
export type NamedElements = Readonly<Record<string, Anchor>>;

export type ExposedValue<Value> = Value extends {
  readonly [modelFamily]: infer Family;
  readonly [modelNamedElements]: infer Elements;
}
  ? (Family extends 'solid'
      ? Solid
      : Family extends 'face'
        ? Surface
        : Family extends 'edge'
          ? Edge
          : Family extends 'vertex'
            ? Vertex
            : Family extends 'group'
              ? Anchor<'frame'>
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

export type ModelFamily = ModelKind | 'model';

export type ModelFamilyElementKind<Family extends ModelFamily> =
  Family extends ModelKind ? ModelElementKind<Family> : ElementKind;

export type ModelForFamily<
  Elements extends NamedElements,
  Family extends ModelFamily,
> = Family extends 'solid'
  ? SolidModel<Elements>
  : Family extends 'face'
    ? FaceModel<Elements>
    : Family extends 'edge'
      ? EdgeModel<Elements>
      : Family extends 'vertex'
        ? VertexModel<Elements>
        : Family extends 'group'
          ? GroupModel<Elements>
          : Model<Elements>;

export interface ModelCapabilities<
  Elements extends NamedElements,
  Family extends ModelFamily,
>
  extends Anchor<ModelFamilyElementKind<Family>>, DirectionalBounds {
  readonly [modelFamily]: Family extends ModelKind ? Family : ModelKind;
  readonly [modelNamedElements]: Elements;
  relate(
    build: (
      self: ModelForFamily<Elements, Family>,
    ) => Constraint | readonly Constraint[],
  ): ModelForFamily<Elements, Family>;
  expose<const Sources extends ElementSources>(
    sources: Sources,
  ): ModelForFamily<MergedElements<Elements, ExposedElements<Sources>>, Family>;
  /** Return a recolored value; a group overrides the color of every descendant. */
  paint(color: string): ModelForFamily<Elements, Family>;
}

export interface GeometryCapabilities<
  Elements extends NamedElements,
  Family extends ModelGeometryKind,
> extends GeometryQueryCapabilities {
  /** Set the origin to this model's center, replacing earlier origin settings. */
  originCenter(): ModelForFamily<Elements, Family>;
  /**
   * Set the model origin in local geometry coordinates without moving geometry.
   * @code3d.param x {kind: 'length', label: 'Origin X'}
   * @code3d.param y {kind: 'length', label: 'Origin Y'}
   * @code3d.param z {kind: 'length', label: 'Origin Z'}
   */
  origin(x: number, y: number, z: number): ModelForFamily<Elements, Family>;
  /**
   * Add a local-coordinate offset to the current origin.
   * @code3d.param dx {kind: 'length', label: 'Origin ΔX'}
   * @code3d.param dy {kind: 'length', label: 'Origin ΔY'}
   * @code3d.param dz {kind: 'length', label: 'Origin ΔZ'}
   */
  originOffset(
    dx: number,
    dy: number,
    dz: number,
  ): ModelForFamily<Elements, Family>;
  /**
   * Set the origin to a vertex of this model, replacing earlier origin settings.
   * @code3d.param id {kind: 'vertex', label: 'Origin vertex'}
   */
  originVertex(id: VertexId): ModelForFamily<Elements, Family>;
  /**
   * Rotate about the current origin, in degrees, about fixed local X, Y, then Z axes.
   * @code3d.param x {kind: 'angle', label: 'Rotate X'}
   * @code3d.param y {kind: 'angle', label: 'Rotate Y'}
   * @code3d.param z {kind: 'angle', label: 'Rotate Z'}
   */
  rotate(x: number, y: number, z: number): ModelForFamily<Elements, Family>;
  /** @code3d.param factor {kind: 'ratio', label: 'Scale'} */
  scaled(factor: number): ModelForFamily<Elements, Family>;
}

export interface VertexTopologyCapabilities {
  /** @code3d.param id {kind: 'vertex', label: 'Vertex'} */
  vertex(id: VertexId): Vertex;
  /** @code3d.param ids {kind: 'vertex', label: 'Vertices', actions: [{label: 'Use all', action: 'remove-argument'}]} */
  vertices(ids?: readonly VertexId[]): readonly Vertex[];
}

export interface EdgeTopologyCapabilities extends VertexTopologyCapabilities {
  /** @code3d.param id {kind: 'edge', label: 'Edge'} */
  edge(id: EdgeId): Edge;
  /** @code3d.param ids {kind: 'edge', label: 'Edges', actions: [{label: 'Use all', action: 'remove-argument'}]} */
  edges(ids?: readonly EdgeId[]): readonly Edge[];
}

export interface SurfaceTopologyCapabilities extends EdgeTopologyCapabilities {
  /** @code3d.param id {kind: 'surface', label: 'Surface'} */
  surface(id: SurfaceId): Surface;
  /** @code3d.param ids {kind: 'surface', label: 'Surfaces', actions: [{label: 'Use all', action: 'remove-argument'}]} */
  surfaces(ids?: readonly SurfaceId[]): readonly Surface[];
}

export interface SolidModificationCapabilities<Elements extends NamedElements> {
  /**
   * @code3d.param radius {kind: 'length', label: 'Fillet radius', constraints: {exclusiveMin: 0}}
   * @code3d.param edgeIds {kind: 'edge', actions: [{label: 'Use all', action: 'remove-argument'}]}
   */
  fillet(radius: number, edgeIds?: readonly EdgeId[]): SolidModel<Elements>;
  /**
   * @code3d.param distance {kind: 'length', label: 'Chamfer distance', constraints: {exclusiveMin: 0}}
   * @code3d.param edgeIds {kind: 'edge', actions: [{label: 'Use all', action: 'remove-argument'}]}
   */
  chamfer(distance: number, edgeIds?: readonly EdgeId[]): SolidModel<Elements>;
  /**
   * Hollow a solid with uniform walls. Positive thickness offsets inward;
   * negative thickness offsets outward. Selected surfaces become openings.
   * Omit the selection, or use [], for a fully enclosed cavity.
   * @code3d.param thickness {kind: 'length', label: 'Wall thickness'}
   * @code3d.param removedSurfaceIds {kind: 'surface', label: 'Openings', actions: [{label: 'Close all openings', action: 'remove-argument'}]}
   */
  shell(
    thickness: number,
    removedSurfaceIds?: readonly SurfaceId[],
  ): SolidModel<Elements>;
}

export type Model<Elements extends NamedElements = {}> = ModelCapabilities<
  Elements,
  'model'
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
    EdgeTopologyCapabilities & {reverse(): Edge} & Elements;

export type FaceModel<Elements extends NamedElements = PlanarElements> =
  ModelCapabilities<Elements, 'face'> &
    GeometryCapabilities<Elements, 'face'> &
    SurfaceTopologyCapabilities & {flip(): Surface} & Elements;

export type SolidModel<Elements extends NamedElements = CanonicalElements> =
  ModelCapabilities<Elements, 'solid'> &
    GeometryCapabilities<Elements, 'solid'> &
    SurfaceTopologyCapabilities &
    SolidModificationCapabilities<Elements> &
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

  on(target: Bound): Constraint {
    return Constraint.create(
      this[anchorReferenceValue],
      boundReference(target),
    );
  }

  align(target: Anchor<'point' | 'line' | 'face'>): Constraint {
    return Constraint.create(
      this[anchorReferenceValue],
      anchorReference(target),
      'align',
    );
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
    : value instanceof ConstraintExpression
      ? value.self()
      : topology?.source;
  const geometry = source?.[modelGeometry]()?.value;
  if (!geometry) return undefined;
  return topologyChildren(
    geometry.shape,
    geometry.topology,
    topology?.selection ?? {kind: 'solid'},
    kind,
  );
}

/** Traceable relation values, including unfinished pivot and axis selections. */
export abstract class ConstraintExpression {
  private get sourceRefs(): SourceRef[] {
    return valueTrace(this).sourceRefs;
  }
  private get parameters(): ParameterUsage[] {
    return valueTrace(this).parameters;
  }
  protected spatialOperation?: ConstraintSpatialSelection;
  protected constructor(
    protected readonly kind: StoredConstraint['kind'],
    protected readonly source: AnchorReference,
    protected readonly target: AnchorReference,
    protected readonly displacement: Vec3 | undefined,
    protected readonly rotations: readonly ConstraintRotation[],
    protected readonly context: RelateContext | undefined,
    protected readonly constraintId: string,
    previous?: ConstraintExpression,
  ) {
    valueTraces.set(this, {
      sourceRefs: [...(previous ? valueTrace(previous).sourceRefs : [])],
      parameters: [...(previous ? valueTrace(previous).parameters : [])],
    });
  }
  /** @internal */
  attachSource(sourceRef: SourceRef): void {
    const refs = this.sourceRefs;
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
    appendUniqueParameters(this.parameters, parameters);
  }
  /** @internal */
  self(): ModelObject | undefined {
    return this.context?.self;
  }
  /** @internal */
  traceReference(): ConstraintTraceReference {
    const rebind = (model: ModelObject) =>
      model === this.context?.original ? this.context.self : model;
    return {
      constraintId: this.constraintId,
      source: rebind(this.source.model),
      target: rebind(this.target.model),
      self: this.context?.self,
    };
  }
  /** @internal */
  storeFor(model: ModelObject, original: ModelObject): StoredConstraint {
    const isSelf = (candidate: ModelObject | undefined) =>
      candidate === model || candidate === original;
    if (!isSelf(this.source.model) && !isSelf(this.target.model))
      throw new Error(
        'The constraint returned by relate() must involve self or the original receiver.',
      );
    const bind = (reference: RelationReference): RelationReference => ({
      ...reference,
      model: isSelf(reference.model) ? undefined : reference.model,
    });
    const stored: StoredConstraint = {
      id: this.constraintId,
      kind: this.kind,
      source: bind(this.source),
      target: bind(this.target),
      offset: this.displacement,
      rotations: this.rotations.map(action => ({
        ...action,
        pivot:
          action.pivot.kind === 'around'
            ? {...action.pivot, axis: bind(action.pivot.axis)}
            : action.pivot,
      })),
    };
    valueTraces.set(stored, {
      sourceRefs: [...this.sourceRefs],
      parameters: [...this.parameters],
    });
    return stored;
  }
  /** @internal */
  spatialReference(): ConstraintSpatialReference | undefined {
    if (!this.context || !this.spatialOperation) return undefined;
    const {pivot} = this.spatialOperation;
    const selection =
      pivot.kind === 'around'
        ? {
            ...this.spatialOperation,
            pivot: {
              ...pivot,
              axis: {
                ...pivot.axis,
                model:
                  pivot.axis.model === this.context.self ||
                  pivot.axis.model === this.context.original
                    ? undefined
                    : pivot.axis.model,
              },
            },
          }
        : this.spatialOperation;
    return this.context.self[relationSpatial](
      this.storeFor(this.context.self, this.context.original),
      this.rotations.length,
      selection,
    );
  }
}

export class Constraint extends ConstraintExpression {
  private constructor(
    kind: StoredConstraint['kind'],
    source: AnchorReference,
    target: AnchorReference,
    displacement: Vec3 | undefined = undefined,
    rotations: readonly ConstraintRotation[] = [],
    context = activeRelate,
    constraintId = `constraint-${nextConstraintId++}`,
    previous?: ConstraintExpression,
    spatialOperation?: ConstraintSpatialSelection,
  ) {
    super(
      kind,
      source,
      target,
      displacement,
      rotations,
      context,
      constraintId,
      previous,
    );
    this.spatialOperation = spatialOperation;
  }
  /** @internal */
  static create(
    source: AnchorReference,
    target: AnchorReference,
    kind: StoredConstraint['kind'] = 'on',
  ): Constraint {
    if (kind === 'on')
      source.model[referenceBounds](source, identityRigidTransform);
    else if (source.kind === 'frame' || target.kind === 'frame')
      throw new Error(
        'align() requires points, curves, or surfaces; select geometry on a solid or group.',
      );
    return new Constraint(kind, source, target);
  }
  /**
   * In the target reference axes, on() pins matching bound centers; align()
   * translates self after alignment, retaining the relation's free modes.
   * Explicit zero pins tangential coordinates for on() only.
   * @code3d.param x {kind: 'length', label: 'ΔX'}
   * @code3d.param y {kind: 'length', label: 'ΔY'}
   * @code3d.param z {kind: 'length', label: 'ΔZ'}
   */
  offset(x: number, y: number, z: number): Constraint {
    assertFiniteVector('offset', [x, y, z]);
    return new Constraint(
      this.kind,
      this.source,
      this.target,
      addVectors(this.displacement ?? origin, [x, y, z]),
      this.rotations,
      this.context,
      this.constraintId,
      this,
    );
  }
  /**
   * Select this rotation's pivot in self's local coordinates.
   * @code3d.param x {kind: 'length', label: 'Pivot X'}
   * @code3d.param y {kind: 'length', label: 'Pivot Y'}
   * @code3d.param z {kind: 'length', label: 'Pivot Z'}
   */
  pivot(x: number, y: number, z: number): ConstraintPivotChain {
    assertFiniteVector('pivot', [x, y, z]);
    return new ConstraintPivotChain(this, {kind: 'pivot', point: [x, y, z]});
  }
  /** @code3d.param id {kind: 'vertex', label: 'Pivot vertex'} */
  pivotVertex(id: VertexId): ConstraintPivotChain {
    return new ConstraintPivotChain(this, {kind: 'pivotVertex', id});
  }
  /** Select a positioned axis in the composition. */
  around(axis: LineAnchor): ConstraintAroundChain {
    const reference = anchorReference(axis);
    if (reference.kind !== 'line')
      throw new Error('around() requires an axis or straight edge.');
    const geometry =
      reference.topology?.source[modelGeometry]()?.value ??
      (reference.whole ? reference.model[modelGeometry]()?.value : undefined);
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
          'around() requires a straight axis; curved edges do not define one rotation axis.',
        );
    }
    return new ConstraintAroundChain(this, {kind: 'around', axis: reference});
  }
  /**
   * Rotate about self's origin and local X, Y, then Z axes, in degrees.
   * @code3d.param x {kind: 'angle', label: 'Rotate X'}
   * @code3d.param y {kind: 'angle', label: 'Rotate Y'}
   * @code3d.param z {kind: 'angle', label: 'Rotate Z'}
   */
  rotate(x: number, y: number, z: number): Constraint {
    return this.withRotation({kind: 'pivot', point: origin}, [x, y, z], this);
  }
  /** @internal */
  withRotation(
    pivot: PivotSelection,
    angles: Vec3 | number,
    previous: ConstraintExpression,
  ): Constraint {
    assertFiniteVector(
      'rotate',
      typeof angles === 'number' ? [angles, 0, 0] : angles,
    );
    return new Constraint(
      this.kind,
      this.source,
      this.target,
      this.displacement,
      [...this.rotations, {pivot, angles}],
      this.context,
      this.constraintId,
      previous,
      {kind: 'rotate', pivot},
    );
  }
  /** @internal */
  chainArguments(): [
    StoredConstraint['kind'],
    AnchorReference,
    AnchorReference,
    Vec3 | undefined,
    readonly ConstraintRotation[],
    RelateContext | undefined,
    string,
    ConstraintExpression,
  ] {
    return [
      this.kind,
      this.source,
      this.target,
      this.displacement,
      this.rotations,
      this.context,
      this.constraintId,
      this,
    ];
  }
}

export class ConstraintPivotChain extends ConstraintExpression {
  /** @internal */
  constructor(
    private readonly constraint: Constraint,
    private readonly selection: Exclude<PivotSelection, {kind: 'around'}>,
  ) {
    super(...constraint.chainArguments());
    this.spatialOperation = {kind: selection.kind, pivot: selection};
  }
  /**
   * @code3d.param x {kind: 'angle', label: 'Rotate X'}
   * @code3d.param y {kind: 'angle', label: 'Rotate Y'}
   * @code3d.param z {kind: 'angle', label: 'Rotate Z'}
   */
  rotate(x: number, y: number, z: number): Constraint {
    return this.constraint.withRotation(this.selection, [x, y, z], this);
  }
}
export class ConstraintAroundChain extends ConstraintExpression {
  /** @internal */
  constructor(
    private readonly constraint: Constraint,
    private readonly selection: Extract<PivotSelection, {kind: 'around'}>,
  ) {
    super(...constraint.chainArguments());
    this.spatialOperation = {kind: selection.kind, pivot: selection};
  }
  /** @code3d.param angle {kind: 'angle', label: 'Rotate'} */
  rotate(angle: number): Constraint {
    return this.constraint.withRotation(this.selection, angle, this);
  }
}

const modelGeometry = Symbol('modelGeometry');
const referenceBounds = Symbol('referenceBounds');
const referenceFrame = Symbol('referenceFrame');
const relationSpatial = Symbol('relationSpatial');

export class ModelObject<
  Elements extends NamedElements = {},
  Kind extends ModelKind = ModelKind,
> implements Anchor<ModelElementKind<Kind>> {
  declare readonly [anchorKind]: ModelElementKind<Kind>;
  declare readonly [modelFamily]: Kind;
  declare readonly [modelNamedElements]: Elements;
  /** @internal */
  readonly elementKind: ModelElementKind<Kind>;
  /** @internal */
  readonly nodeId: string;
  /** @internal */
  readonly kind: Kind;
  /** @internal */
  readonly name: string;
  /** @internal */
  readonly color?: string;
  /** @internal */
  readonly children: readonly ModelObject[];
  /** @internal */
  get sourceRefs(): SourceRef[] {
    return valueTrace(this).sourceRefs;
  }
  /** @internal */
  get parameters(): ParameterUsage[] {
    return valueTrace(this).parameters;
  }
  private readonly geometry?: ModelGeometry;
  private readonly meshTolerance: number;
  private readonly intrinsic: StoredElement;
  private readonly elements: StoredElements;
  private constraints: StoredConstraint[];
  private readonly operation: StoredOperation;

  /** @internal */
  [modelGeometry](): ModelGeometry | undefined {
    return this.geometry;
  }

  private constructor(init: ModelObjectInit<Kind>) {
    if (init.kind !== 'group' && !init.geometry) {
      throw new Error(
        'A geometric model object must contain an OpenCascade shape.',
      );
    }
    this.nodeId = init.nodeId ?? `node-${nextNodeId++}`;
    this.kind = init.kind;
    this.elementKind = modelElementKinds[
      init.kind
    ] as unknown as ModelElementKind<Kind>;
    this.geometry = init.geometry;
    this.intrinsic = init.intrinsic ?? {
      kind: this.elementKind,
      transform: identityRigidTransform,
    };
    this.meshTolerance = init.meshTolerance ?? 0.2;
    this.name = init.name ?? defaultModelNames[init.kind];
    this.color = init.color;
    this.children = init.children ?? [];
    this.constraints = [...(init.constraints ?? [])];
    valueTraces.set(this, {
      sourceRefs: [...(init.sourceRefs ?? [])],
      parameters: [...(init.parameters ?? [])],
    });
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

  on(target: Bound): Constraint {
    return Constraint.create(
      this.relationAnchorReference(),
      boundReference(target),
    );
  }

  /** @internal */
  relationAnchorReference(): AnchorReference {
    return {model: this, name: 'geometry', ...this.intrinsic, whole: true};
  }

  align(target: Anchor<'point' | 'line' | 'face'>): Constraint {
    return Constraint.create(
      this.relationAnchorReference(),
      anchorReference(target),
      'align',
    );
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
    ) => Constraint | readonly Constraint[],
  ): RuntimeModel<Elements, Kind> {
    const operation = storedOperation('relate', [
      {model: this, role: 'source', index: 0},
    ]);
    const related = this.copy({}, operation);
    const previous = activeRelate;
    activeRelate = {self: related, original: this};
    let built: Constraint | readonly Constraint[];
    try {
      built = build(related);
    } finally {
      activeRelate = previous;
    }
    const constraints: readonly Constraint[] = Array.isArray(built)
      ? built
      : [built as Constraint];
    const stored = constraints.map(constraint => {
      if (!(constraint instanceof Constraint))
        throw new Error(
          'relate() requires a completed Constraint; finish pivot/around with rotate().',
        );
      return constraint.storeFor(related, this);
    });
    related.constraints.push(...stored);
    operation.inputs.push(
      ...uniqueModels(stored.flatMap(constraintReferences)).map(
        (model, index) => ({
          model,
          role: 'reference' as const,
          index,
        }),
      ),
    );
    return related;
  }

  expose<const Sources extends ElementSources>(
    sources: Sources,
  ): RuntimeModel<MergedElements<Elements, ExposedElements<Sources>>, Kind> {
    const members = this.memberPoses();
    const context = ModelObject.createSolveContext([
      this,
      ...Object.values(sources)
        .map(source => anchorReference(source).model)
        .filter(model => !members.has(model)),
    ]);
    const ownPose = this.solvePose(context);
    const references: ModelObject[] = [];
    const exposed = Object.fromEntries(
      Object.entries(sources).map(([name, source]) => {
        const reference = anchorReference(source);
        references.push(reference.model);
        const {
          kind,
          transform: frame,
          topology,
          members: nested,
          bound,
          facing,
        } = source instanceof ModelObject
          ? source.exposedElement()
          : (source as ModelAnchor)[anchorReferenceValue];
        const memberPose = members.get(reference.model);
        if (memberPose === null)
          throw new Error(
            `The exposed element ${name} belongs to multiple occurrences. Expose it through the intended child model's named reference.`,
          );
        const transform =
          memberPose ??
          relativeTransform(reference.model.solvePose(context), ownPose);
        return [
          name,
          transformElement(
            {kind, transform: frame, topology, members: nested, bound, facing},
            transform,
          ),
        ];
      }),
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
      return {...this.intrinsic, members: this.elements};
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
        ? this.intrinsic
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

  paint(color: string): RuntimeModel<Elements, Kind> {
    return this.copy(
      {color},
      storedOperation('paint', [{model: this, role: 'source', index: 0}]),
    );
  }

  origin(x: number, y: number, z: number): RuntimeModel<Elements, Kind> {
    const position: Vec3 = [x, y, z];
    assertFiniteVector('origin', position);
    return this.withOrigin(position, 'origin', position);
  }

  originOffset(
    dx: number,
    dy: number,
    dz: number,
  ): RuntimeModel<Elements, Kind> {
    const offset: Vec3 = [dx, dy, dz];
    assertFiniteVector('originOffset', offset);
    return this.withOrigin(
      addVectors(this.intrinsic.transform.position, offset),
      'originOffset',
      offset,
    );
  }

  originVertex(id: VertexId): RuntimeModel<Elements, Kind> {
    const geometry = this.requireGeometry().value;
    const [{position}] = topologyVertexPoints(
      geometry.shape,
      geometry.topology.vertices,
      [id],
    );
    return this.withOrigin(position, 'originVertex', position);
  }

  originCenter(): RuntimeModel<Elements, Kind> {
    this.requireGeometry();
    const position = this.elements.center.transform.position;
    return this.withOrigin(position, 'originCenter', position);
  }

  private withOrigin(
    position: Vec3,
    kind: 'origin' | 'originOffset' | 'originVertex' | 'originCenter',
    vector: Vec3,
  ): RuntimeModel<Elements, Kind> {
    this.requireGeometry();
    const operation = storedOperation(kind, [
      {model: this, role: 'source', index: 0},
    ]);
    operation.spatial = {origin: position, vector};
    return this.copy(
      {
        intrinsic: {
          ...this.intrinsic,
          transform: {...this.intrinsic.transform, position},
        },
      },
      operation,
    );
  }

  rotate(x: number, y: number, z: number): RuntimeModel<Elements, Kind> {
    const angles: Vec3 = [x, y, z];
    assertFiniteVector('rotate', angles);
    const pivot = this.intrinsic.transform.position;
    const transform = rotationAround(pivot, angles);
    const source = this.requireGeometry();
    const geometry = evaluateModelGeometry(
      'rotate',
      [pivot, angles],
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
    const operation = storedOperation('rotate', [
      {model: this, role: 'source', index: 0},
    ]);
    operation.spatial = {origin: pivot, vector: angles};
    return this.copyWithGeometry(
      geometry,
      {
        intrinsic: transformElement(this.intrinsic, transform),
        elements: Object.fromEntries(
          Object.entries(this.elements).map(([name, element]) => [
            name,
            transformElement(element, transform),
          ]),
        ),
      },
      operation,
    );
  }

  scaled(factor: number): RuntimeModel<Elements, Kind> {
    assertPositive('scale', factor);
    const source = this.requireGeometry();
    const geometry = evaluateModelGeometry('scaled', [factor], [source], () => {
      const shape = source.value.shape.clone().scale(factor, toPoint(origin));
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
        intrinsic: scaleElement(this.intrinsic, factor),
        elements: scaleElements(this.elements, factor),
      },
      storedOperation('scaled', [{model: this, role: 'source', index: 0}]),
    );
  }

  fillet(
    this: ModelObject<Elements, 'solid'>,
    radius: number,
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
        selections: [{kind: 'edge', input: this, ids: selectedEdgeIds}],
      }),
    ) as unknown as SolidModel<Elements>;
  }

  chamfer(
    this: ModelObject<Elements, 'solid'>,
    distance: number,
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
        selections: [{kind: 'edge', input: this, ids: selectedEdgeIds}],
      }),
    ) as unknown as SolidModel<Elements>;
  }

  shell(
    this: ModelObject<Elements, 'solid'>,
    thickness: number,
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
        selections: [{kind: 'surface', input: this, ids: selectedIds}],
      }),
    ) as unknown as SolidModel<Elements>;
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

  /** @internal */
  attachOperationTrace(
    siteId: string,
    execution: number,
    order: number,
    sourceRef: SourceRef,
  ): void {
    if (operationTraces.has(this.operation)) {
      return;
    }
    operationTraces.set(this.operation, {siteId, execution, order, sourceRef});
  }

  /** @internal */
  relatedObjects(): readonly ModelObject[] {
    return [
      ...this.children,
      ...this.operation.inputs.map(input => input.model),
      ...this.constraints.flatMap(constraintReferences),
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
    overrideColor?: string,
  ): ModelSnapshotObject {
    const color = overrideColor ?? this.color;
    const pose = this.solvePose(solveContext);
    const constraints = this.constraints.map(constraint =>
      this.constraintSnapshot(constraint, solveContext),
    );
    const parameters = uniqueParameters([
      ...this.parameters,
      ...this.constraints.flatMap(
        constraint => valueTrace(constraint).parameters,
      ),
    ]);
    const common = {
      nodeId: this.nodeId,
      kind: this.kind,
      name: this.name,
      color,
      compositionTransform: toTransform(pose),
      transform: toTransform(inComposition ? pose : identityRigidTransform),
      constraints,
      origin: this.intrinsic.transform.position,
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
      operation: this.operationSnapshot(meshCache),
    } as const;

    if (this.kind === 'group') {
      const childContext = ModelObject.createSolveContext(this.children);
      return {
        ...common,
        children: this.children.map(child =>
          child.snapshotNode(meshCache, childContext, true, color),
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
      ...this.operation.regions.map(region => region.artifact.value),
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
    return ModelObject.create<CanonicalElements, 'solid'>({
      kind: 'solid',
      name: 'Loft',
      geometry,
      color: this.color,
      constraints: this.constraints,
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
    }) as unknown as SolidModel;
  }

  /** @internal */
  [combineModels](
    this: ModelObject<Elements, 'solid'>,
    operation: BooleanOperation,
    others: readonly ModelObject<{}, 'solid'>[],
  ): SolidModel {
    const evaluation = this.evaluateBoolean(operation, others);
    let transferred = false;
    try {
      const combined = ModelObject.create<CanonicalElements, 'solid'>({
        kind: 'solid',
        intrinsic: this.intrinsic,
        geometry: evaluation.geometry,
        name: this.name,
        color: this.color,
        constraints: this.constraints,
        sourceRefs: [this, ...others].flatMap(model => model.sourceRefs),
        parameters: uniqueParameters(
          [this, ...others].flatMap(model => model.allParameters()),
        ),
        meshTolerance: Math.min(
          this.meshTolerance,
          ...others.map(model => model.meshTolerance),
        ),
        operation: storedOperation(
          operation === 'fuse' ? 'union' : operation,
          [
            {model: this, role: 'receiver', index: 0},
            ...others.map((model, index) => ({
              model,
              role:
                operation === 'cut' ? ('tool' as const) : ('operand' as const),
              index: index + 1,
            })),
          ],
          {regions: evaluation.regions},
        ),
      });
      transferred = true;
      return combined as unknown as SolidModel;
    } finally {
      if (!transferred) {
        disposeModelGeometryValue(evaluation.geometry.value);
        evaluation.regions.forEach(region => region.artifact.value.delete());
      }
    }
  }

  private evaluateBoolean(
    this: ModelObject<Elements, 'solid'>,
    operation: BooleanOperation,
    others: readonly ModelObject<{}, 'solid'>[],
  ): BooleanEvaluation {
    const solveContext = ModelObject.createSolveContext([this, ...others]);
    const targetPose = this.solvePose(solveContext);
    let geometry = this.requireSolidGeometry();
    let temporaryGeometry: SolidGeometry | undefined;
    const regions: StoredOperationRegion[] = [];
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
          if (operation === 'cut' || operation === 'fuse') {
            regions.push({
              kind: 'intersection',
              input: other,
              artifact: evaluateKernelShape(
                'boolean-intersection-region',
                [],
                [geometry, operand],
                () => geometry.value.shape.intersect(operand.value),
              ),
            });
          }
          if (operation === 'fuse') {
            regions.push({
              kind: 'section',
              input: other,
              artifact: evaluateKernelShape(
                'boolean-section-region',
                [],
                [geometry, operand],
                () => unionSectionShape(geometry.value.shape, operand.value),
              ),
            });
          }
          const nextGeometry = evaluateSolidGeometry(
            `boolean-${operation}`,
            [otherIndex],
            [geometry, operand],
            () => {
              const result = booleanWithTopology(
                {
                  shape: geometry.value.shape,
                  topology: geometry.value.topology,
                  index: otherIndex === 0 ? 1 : undefined,
                },
                {
                  shape: operand.value,
                  topology: otherGeometry.value.topology,
                  index: otherIndex + 2,
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
      return {geometry, regions};
    } finally {
      if (!evaluated) {
        temporaryGeometry?.value.shape.delete();
        regions.forEach(region => region.artifact.value.delete());
      }
    }
  }

  private allParameters(): ParameterUsage[] {
    return uniqueParameters([
      ...this.parameters,
      ...this.constraints.flatMap(
        constraint => valueTrace(constraint).parameters,
      ),
    ]);
  }

  private solvePose(context: SolveContext): RigidTransform {
    return context.poses.get(this)!;
  }

  private memberPoses(): Map<ModelObject, RigidTransform | null> {
    const members = new Map<ModelObject, RigidTransform | null>([
      [this, identityRigidTransform],
    ]);
    if (this.children.length) {
      const context = ModelObject.createSolveContext(this.children);
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

  /** @internal */
  [referenceFrame](): RigidTransform {
    return this.intrinsic.transform;
  }

  /** Bounds of the selected finite geometry after a rigid transform. */
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
    if (reference.whole) {
      if (this.geometry)
        return transformedBounds(this.geometry.value.shape, transform);
      const context = ModelObject.createSolveContext(this.children);
      return combineBounds(
        this.children.map(child =>
          child[referenceBounds](
            child.relationAnchorReference(),
            composeTransforms(transform, child.solvePose(context)),
          ),
        ),
      );
    }
    if (reference.topology) {
      const topology = reference.topology;
      const geometry = topology.source.requireGeometry().value;
      return withTopologyShape(
        geometry.shape,
        geometry.topology,
        topology.selection,
        shape => {
          const scaled =
            topology.scale === 1 ? shape : shape.scale(topology.scale);
          try {
            return transformedBounds(
              scaled,
              composeTransforms(transform, topology.transform),
            );
          } finally {
            if (scaled !== shape) scaled.delete();
          }
        },
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

  private alignmentGeometry(reference: StoredAnchor): AlignmentGeometry {
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
            topology.scale === 1 ? shape : shape.scale(topology.scale);
          try {
            return transformGeometry(read(scaled), topology.transform);
          } finally {
            if (scaled !== shape) scaled.delete();
          }
        },
      );
    }
    if (reference.whole) return read(this.requireGeometry().value.shape);
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

  private relationElement(reference: StoredAnchor): ElementSnapshot {
    const element = reference.whole
      ? {
          ...this.exposedElement(),
          name: reference.name,
          direction: reference.direction,
          facing: reference.facing,
        }
      : reference;
    const topology = element.topology;
    let arrow: RigidTransform | undefined;
    if (reference.kind === 'line' && topology) {
      const geometry = topology.source.requireGeometry().value;
      arrow = withTopologyShape(
        geometry.shape,
        geometry.topology,
        topology.selection,
        shape => {
          const edge = shape as ReplicadEdge;
          const position = (reference.direction ?? 1) === 1 ? 1 : 0;
          const point = edge.pointAt(position),
            tangent = edge.tangentAt(position);
          try {
            return topologyTransform(
              topology,
              frameFromYAxis(
                point.toTuple(),
                tangent
                  .toTuple()
                  .map(v => v * (reference.direction ?? 1)) as unknown as Vec3,
              ),
            );
          } finally {
            point.delete();
            tangent.delete();
          }
        },
      );
    }
    return {
      ...snapshotElements({[reference.name]: element})[0],
      arrow,
    };
  }

  private bodyRotations(
    constraint: StoredConstraint,
    indices: Map<ModelObject, number>,
  ): BodyRotation[] {
    return constraint.rotations.map(({pivot, angles}) => {
      if (pivot.kind === 'around') {
        return pivot.axis.model
          ? {
              body: indices.get(pivot.axis.model)!,
              axis: pivot.axis.transform,
              angle: (angles as number) * (pivot.axis.direction ?? 1),
            }
          : {
              local: axisRotation(
                pivot.axis.transform,
                (angles as number) * (pivot.axis.direction ?? 1),
              ),
            };
      }
      const frame =
        pivot.kind === 'pivot'
          ? composeTransforms(
              this.intrinsic.transform,
              translation(pivot.point),
            )
          : {
              ...this.intrinsic.transform,
              position: anchorReference(this.vertex(pivot.id)).transform
                .position,
            };
      return {
        local: composeTransforms(
          composeTransforms(frame, rotationAround(origin, angles as Vec3)),
          invertTransform(frame),
        ),
      };
    });
  }

  /** @internal */
  [relationSpatial](
    fallback: StoredConstraint,
    completed: number,
    selection: ConstraintSpatialSelection,
  ): ConstraintSpatialReference {
    const stored = this.constraints.find(
      constraint => constraint.id === fallback.id,
    );
    const owner = stored
      ? this
      : this.copy(
          {constraints: [...this.constraints, fallback]},
          this.operation,
        );
    const constraint = stored ?? fallback;
    const context = ModelObject.createSolveContext([
      owner,
      ...(selection.pivot.kind === 'around' && selection.pivot.axis.model
        ? [selection.pivot.axis.model]
        : []),
    ]);
    const models = [...context.poses.keys()];
    const actions = owner.bodyRotations(
      constraint,
      new Map(models.map((model, i) => [model, i])),
    );
    const stage = selection.kind === 'rotate' ? completed - 1 : completed;
    const finalPose = owner.solvePose(context);
    let before = finalPose;
    for (let i = actions.length - 1; i >= stage; i--) {
      const action = actions[i];
      before =
        'local' in action
          ? composeTransforms(before, invertTransform(action.local))
          : composeTransforms(
              axisRotation(
                composeTransforms(
                  models[action.body].solvePose(context),
                  action.axis,
                ),
                -action.angle,
              ),
              before,
            );
    }
    const pivot = selection.pivot;
    let frame: RigidTransform;
    if (pivot.kind === 'around') {
      frame = composeTransforms(
        pivot.axis.model ? pivot.axis.model.solvePose(context) : before,
        (pivot.axis.direction ?? 1) === 1
          ? pivot.axis.transform
          : composeTransforms(pivot.axis.transform, rotation([1, 0, 0, 0])),
      );
    } else {
      const local =
        pivot.kind === 'pivot'
          ? composeTransforms(
              this.intrinsic.transform,
              translation(pivot.point),
            )
          : {
              ...this.intrinsic.transform,
              position: anchorReference(this.vertex(pivot.id)).transform
                .position,
            };
      frame = composeTransforms(before, local);
    }
    // Later rotations about external axes transport this operation's gizmo.
    for (const action of actions.slice(stage + 1)) {
      if ('body' in action)
        frame = composeTransforms(
          axisRotation(
            composeTransforms(
              models[action.body].solvePose(context),
              action.axis,
            ),
            action.angle,
          ),
          frame,
        );
    }
    const angles = constraint.rotations[stage]?.angles ?? origin;
    const rotationVector: Vec3 =
      typeof angles === 'number' ? [0, angles, 0] : angles;
    const localFrame = relativeTransform(frame, finalPose);
    return {
      nodeId: this.nodeId,
      kind: selection.kind,
      spatial: {
        origin: localFrame.position,
        vector:
          selection.kind === 'rotate'
            ? rotationVector
            : pivot.kind === 'pivot'
              ? pivot.point
              : origin,
        frame: localFrame,
        rotation: rotationVector,
        axisOnly: pivot.kind === 'around',
      },
    };
  }

  private static createSolveContext(
    roots: readonly ModelObject[],
  ): SolveContext {
    const models: ModelObject[] = [];
    const indices = new Map<ModelObject, number>();
    const collect = (model: ModelObject): void => {
      if (indices.has(model)) return;
      indices.set(model, models.length);
      models.push(model);
      model.constraints.flatMap(constraintReferences).forEach(collect);
    };
    roots.forEach(collect);
    const poses = solveBodies(
      models.map((model): Body => ({
        name: model.name,
        relations: model.constraints.map(constraint =>
          constraint.kind === 'align'
            ? {
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
                offset: constraint.offset,
                rotations: model.bodyRotations(constraint, indices),
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
                offset: constraint.offset,
                rotations: model.bodyRotations(constraint, indices),
              },
        ),
      })),
    );
    return {
      poses: new Map(models.map((model, index) => [model, poses[index]])),
    };
  }

  private constraintSnapshot(
    constraint: StoredConstraint,
    context: SolveContext,
  ): ConstraintSnapshot {
    const source = constraint.source.model ?? this;
    const target = constraint.target.model ?? this;
    const models = [...context.poses.keys()];
    const actions = this.bodyRotations(
      constraint,
      new Map(models.map((model, i) => [model, i])),
    );
    let before = this.solvePose(context);
    for (const action of [...actions].reverse()) {
      before =
        'local' in action
          ? composeTransforms(before, invertTransform(action.local))
          : composeTransforms(
              axisRotation(
                composeTransforms(
                  models[action.body].solvePose(context),
                  action.axis,
                ),
                -action.angle,
              ),
              before,
            );
    }
    const sourcePose = source === this ? before : source.solvePose(context);
    const targetPose = target === this ? before : target.solvePose(context);
    let offsetFrame = composeTransforms(
      targetPose,
      constraint.target.transform,
    );
    if (constraint.kind === 'align') {
      for (const action of actions)
        if ('body' in action)
          offsetFrame = composeTransforms(
            axisRotation(
              composeTransforms(
                models[action.body].solvePose(context),
                action.axis,
              ),
              action.angle,
            ),
            offsetFrame,
          );
      return {
        id: constraint.id,
        kind: 'align',
        source: anchorSnapshot(source, constraint.source),
        target: anchorSnapshot(target, constraint.target),
        sourceElement: source.relationElement(constraint.source),
        targetElement: target.relationElement(constraint.target),
        offsetDirection: 1,
        offset: constraint.offset ?? origin,
        offsetFrame: toTransform(offsetFrame),
        sourceRefs: [...valueTrace(constraint).sourceRefs],
        parameters: [...valueTrace(constraint).parameters],
      };
    }
    const orientation = composeTransforms(
      invertTransform(rotation(offsetFrame.quaternion)),
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
          rotateVector(center, offsetFrame.quaternion),
        ),
        quaternion: offsetFrame.quaternion,
      },
      sourcePose,
    );
    for (const action of actions) {
      if ('body' in action)
        offsetFrame = composeTransforms(
          axisRotation(
            composeTransforms(
              models[action.body].solvePose(context),
              action.axis,
            ),
            action.angle,
          ),
          offsetFrame,
        );
    }
    return {
      id: constraint.id,
      kind: constraint.kind,
      source: anchorSnapshot(source, constraint.source),
      target: anchorSnapshot(target, constraint.target),
      sourceElement: {
        name: `${constraint.source.name}:bound`,
        kind: 'face',
        transform: toTransform(sourceFrame),
        bound: {
          size: [bounds[1][0] - bounds[0][0], bounds[1][2] - bounds[0][2]],
          facing: constraint.target.bound!.facing === 1 ? -1 : 1,
        },
      },
      targetElement: {
        name: constraint.target.name,
        kind: 'face',
        transform: toTransform(constraint.target.transform),
        bound: constraint.target.bound,
      },
      offsetDirection: source === this ? 1 : -1,
      offset: constraint.offset ?? origin,
      offsetFrame: toTransform(offsetFrame),
      sourceRefs: [...valueTrace(constraint).sourceRefs],
      parameters: [...valueTrace(constraint).parameters],
    };
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

  private operationSnapshot(
    meshCache: Map<AnyShape, RenderMesh>,
  ): ModelOperationSnapshot {
    const {kind, inputs, regions, selections} = this.operation;
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
      regions: regions.map(region => ({
        kind: region.kind,
        inputNodeId: region.input.nodeId,
        mesh: renderMesh(
          region.artifact,
          region.artifact.value,
          meshCache,
          this.meshTolerance,
        ),
      })),
      selections: selections.map(selection => ({
        kind: selection.kind,
        inputNodeId: selection.input.nodeId,
        ids: [...selection.ids],
      })),
      sourceRef,
      spatial: this.operation.spatial,
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
    return ModelObject.create<Elements, Kind>({
      kind: this.kind,
      geometry: this.geometry,
      intrinsic: this.intrinsic,
      name: this.name,
      color: this.color,
      children: this.children,
      constraints: this.constraints,
      elements: this.elements,
      sourceRefs: this.sourceRefs,
      parameters: this.parameters,
      meshTolerance: this.meshTolerance,
      operation,
      ...overrides,
    }) as RuntimeModel<Elements, Kind>;
  }
}

/** @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}} */
export function circle(radius: number): FaceModel {
  assertPositive('radius', radius);
  return planarFaceModel('circle', 'Circle', [radius], () =>
    sketchCircle(radius, {plane: 'XZ'}),
  );
}

/**
 * @code3d.param xRadius {kind: 'length', label: 'X radius', constraints: {exclusiveMin: 0}}
 * @code3d.param zRadius {kind: 'length', label: 'Z radius', constraints: {exclusiveMin: 0}}
 */
export function ellipse(xRadius: number, zRadius: number): FaceModel {
  assertPositive('xRadius', xRadius);
  assertPositive('zRadius', zRadius);
  return planarFaceModel('ellipse', 'Ellipse', [xRadius, zRadius], () =>
    sketchEllipse(xRadius, zRadius, {plane: 'XZ'}),
  );
}

/**
 * @code3d.param x {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param z {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function rectangle(x: number, z: number): FaceModel {
  assertPositive('x', x);
  assertPositive('z', z);
  return planarFaceModel('rectangle', 'Rectangle', [x, z], () =>
    sketchRectangle(x, z, {plane: 'XZ'}),
  );
}

/**
 * @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param sides {kind: 'count', constraints: {min: 3}}
 * @code3d.param rotation {kind: 'angle'}
 */
export function regularPolygon(
  radius: number,
  sides: number,
  rotation = 0,
): FaceModel {
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
 * @code3d.param x {kind: 'length'}
 * @code3d.param y {kind: 'length'}
 * @code3d.param z {kind: 'length'}
 */
export function point(x?: number, y?: number, z?: number): VertexModel;
export function point(position: Vec3): VertexModel;
export function point(
  xOrPosition: number | Vec3 = 0,
  y = 0,
  z = 0,
): VertexModel {
  const position: Vec3 =
    typeof xOrPosition === 'number' ? [xOrPosition, y, z] : xOrPosition;
  assertFiniteVector('point', position);
  const geometry = evaluateModelGeometry('point', [position], [], () => ({
    shape: makeVertex(toPoint(position)),
  }));
  return ModelObject.create<{}, 'vertex'>({
    kind: 'vertex',
    name: 'Point',
    geometry,
    intrinsic: {kind: 'point', transform: translation(position)},
    operation: storedOperation('point'),
  }) as unknown as VertexModel;
}

/**
 * @code3d.param x {kind: 'length', label: 'End X'}
 * @code3d.param y {kind: 'length', label: 'End Y'}
 * @code3d.param z {kind: 'length', label: 'End Z'}
 */
export function line(x: number, y: number, z: number): EdgeModel;
export function line(start: Vec3, end: Vec3): EdgeModel;
export function line(
  xOrStart: number | Vec3,
  yOrEnd: number | Vec3,
  z?: number,
): EdgeModel {
  const [start, end]: readonly [Vec3, Vec3] =
    typeof xOrStart === 'number'
      ? [origin, [xOrStart, yOrEnd as number, z ?? 0]]
      : [xOrStart, yOrEnd as Vec3];
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
 * @code3d.param x {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param z {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function box(x: number, y: number, z: number): SolidModel {
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
    operation: storedOperation('box'),
  }) as unknown as SolidModel;
}

/**
 * @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function cylinder(radius: number, y: number): SolidModel {
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
 * @code3d.param outerRadius {kind: 'length', label: 'Outer radius', constraints: {exclusiveMin: 0}}
 * @code3d.param innerRadius {kind: 'length', label: 'Inner radius', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function tube(
  outerRadius: number,
  innerRadius: number,
  y: number,
): SolidModel {
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
 * @code3d.param coilRadius {kind: 'length', label: 'Coil radius', constraints: {exclusiveMin: 0}}
 * @code3d.param wireRadius {kind: 'length', label: 'Wire radius', constraints: {exclusiveMin: 0}}
 * @code3d.param pitch {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param turns {kind: 'scalar', constraints: {exclusiveMin: 0}}
 */
export function coil(
  coilRadius: number,
  wireRadius: number,
  pitch: number,
  turns: number,
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

/** @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}} */
export function sphere(radius: number): SolidModel {
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
 * @code3d.param bottomRadius {kind: 'length', label: 'Bottom radius', constraints: {exclusiveMin: 0}}
 * @code3d.param topRadius {kind: 'length', label: 'Top radius', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function frustum(
  bottomRadius: number,
  topRadius: number,
  y: number,
): SolidModel {
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
 * @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param sides {kind: 'count', constraints: {min: 3}}
 * @code3d.param rotation {kind: 'angle'}
 */
export function regularPrism(
  radius: number,
  y: number,
  sides: number,
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
export function modelFromReplicadSolid(shape: Shape3D): SolidModel {
  let solid: Shape3D;
  try {
    solid = normalizeReplicadSolid(shape);
  } catch (error) {
    shape.delete();
    throw error;
  }
  // The builder still executes on every call. Cache its actual output, not its
  // arguments: captured state may change the geometry between invocations.
  let adopted = false;
  let geometry: SolidGeometry;
  try {
    geometry = evaluateSolidGeometry(
      'replicad-solid',
      [solid.serialize()],
      [],
      () => {
        adopted = true;
        return {shape: solid};
      },
    );
  } finally {
    // A hit returns an independently owned cached copy; discard this output.
    // A miss transfers ownership to evaluateSolidGeometry, including on error.
    if (!adopted) solid.delete();
  }
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Custom primitive',
    geometry,
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

export function union(operands: readonly SolidModel<{}>[]): SolidModel {
  const {first, others} = booleanOperands('union', operands);
  return first[combineModels]('fuse', others);
}

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

export function intersect(operands: readonly SolidModel<{}>[]): SolidModel {
  const {first, others} = booleanOperands('intersect', operands);
  return first[combineModels]('intersect', others);
}

export function isModelObject(value: unknown): value is ModelObject {
  return value instanceof ModelObject;
}

export function isConstraint(value: unknown): value is Constraint {
  return value instanceof Constraint;
}

export function isConstraintExpression(
  value: unknown,
): value is ConstraintExpression {
  return value instanceof ConstraintExpression;
}

export function constraintSpatialReference(
  value: ConstraintExpression,
): ConstraintSpatialReference | undefined {
  return value.spatialReference();
}

export function instrumentConstraint(
  constraint: ConstraintExpression,
  sourceRef: SourceRef,
  parameters: readonly ParameterUsage[],
): void {
  constraint.attachSource(sourceRef);
  constraint.attachParameters(parameters);
}

export function instrumentModelOperation(
  object: ModelObject,
  instrumentation: ModelOperationInstrumentation,
): void {
  object.attachSource(instrumentation.sourceRef);
  object.attachParameters(instrumentation.parameters);
  object.attachOperationTrace(
    instrumentation.siteId,
    instrumentation.execution,
    instrumentation.order,
    instrumentation.sourceRef,
  );
}

export function constraintTraceReference(
  constraint: ConstraintExpression,
): ConstraintTraceReference {
  return constraint.traceReference();
}

export function modelObjectRuntimeInfo(
  object: ModelObject,
): ModelObjectRuntimeInfo {
  return {
    nodeId: object.nodeId,
    name: object.name,
    sourceRefs: object.sourceRefs,
  };
}

export function relatedModelObjects(
  object: ModelObject,
): readonly ModelObject[] {
  return object.relatedObjects();
}

export function createModelSnapshotter(): (
  object: ModelObject,
) => ModelSnapshotObject {
  const meshCache = new Map<AnyShape, RenderMesh>();
  return object => object.toSnapshot(meshCache);
}

export function disposeModelObjects(objects: Iterable<ModelObject>): void {
  const disposed = new Set<AnyShape>();
  for (const object of objects) {
    object.disposeShape(disposed);
  }
}

/** Worker-owned native geometry, independent of the author's object lifetime. */
export type ModelGeometrySnapshot = Readonly<{
  /** Borrowed shapes; clone before passing them to consuming operations. */
  shapes: ReadonlyMap<string, AnyShape>;
  dispose(): void;
}>;

export function retainModelGeometry(
  objects: Iterable<ModelObject>,
): ModelGeometrySnapshot {
  const retained = new Map<AnyShape, AnyShape>();
  const shapes = new Map<string, AnyShape>();
  const dispose = () => {
    for (const shape of retained.values()) shape.delete();
    retained.clear();
    shapes.clear();
  };
  try {
    for (const object of objects) {
      const original = object[modelGeometry]()?.value.shape;
      if (!original) continue;
      let shape = retained.get(original);
      if (!shape) {
        shape = original.clone();
        retained.set(original, shape);
      }
      shapes.set(object.nodeId, shape);
    }
    return {shapes, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}

export const authoringApi = Object.freeze({
  circle,
  ellipse,
  rectangle,
  regularPolygon,
  point,
  line,
  arc,
  bezier,
  spline,
  loft,
  box,
  cylinder,
  tube,
  coil,
  sphere,
  frustum,
  regularPrism,
  group,
  union,
  cut,
  intersect,
});

function storedOperation(
  kind: ModelOperationKind,
  inputs: readonly StoredOperationInput[] = [],
  options: Readonly<{
    regions?: readonly StoredOperationRegion[];
    selections?: readonly StoredOperationSelection[];
  }> = {},
): StoredOperation {
  return {
    runtimeId: `operation-${nextOperationId++}`,
    kind,
    inputs: [...inputs],
    regions: [...(options.regions ?? [])],
    selections: [...(options.selections ?? [])],
  };
}

function storedOperationId(operation: StoredOperation): string {
  const trace = operationTraces.get(operation);
  return trace
    ? `${trace.siteId}:execution:${trace.execution}`
    : operation.runtimeId;
}

const shapeLifecycle: KernelValueLifecycle<AnyShape> = {
  retain: shape => shape.clone(),
  instantiate: shape => shape.clone(),
  release: shape => shape.delete(),
};

const modelGeometryLifecycle: KernelValueLifecycle<ModelGeometryValue> = {
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

const renderMeshLifecycle: KernelValueLifecycle<RenderMesh> = {
  retain: mesh => mesh,
  instantiate: mesh => mesh,
  release: () => undefined,
};

function evaluateKernelShape<Shape extends AnyShape>(
  operation: string,
  arguments_: readonly KernelKeyPart[],
  inputs: readonly KernelArtifact<unknown>[],
  compute: () => Shape,
): KernelArtifact<Shape> {
  return evaluateKernelOperation(
    operation,
    arguments_,
    inputs,
    shapeLifecycle as KernelValueLifecycle<Shape>,
    compute,
  );
}

function evaluateModelGeometry(
  operation: string,
  arguments_: readonly KernelKeyPart[],
  inputs: readonly KernelArtifact<unknown>[],
  compute: () => Readonly<{
    shape: AnyShape;
    topology?: ShapeTopology;
    referenceBasis?: ModelGeometryValue['referenceBasis'];
  }>,
): ModelGeometry {
  return evaluateKernelOperation(
    operation,
    arguments_,
    inputs,
    modelGeometryLifecycle,
    () => {
      const result = compute();
      return {
        ...createModelGeometryValue(result.shape, result.topology),
        referenceBasis: result.referenceBasis,
      };
    },
  );
}

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
  const mesh = evaluateKernelOperation(
    'render-mesh',
    [tolerance, 0.2, topology !== undefined],
    [artifact],
    renderMeshLifecycle,
    () => {
      const surface = shape.mesh({tolerance, angularTolerance: 0.2});
      const wire = shape.meshEdges({tolerance, angularTolerance: 0.2});
      const vertexData = topology
        ? stableVertexData(shape, topology.vertices)
        : {positions: new Float32Array(), ids: []};
      return {
        vertices: new Float32Array(surface.vertices),
        normals: new Float32Array(surface.normals),
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
          : wire.edgeGroups,
      };
    },
  ).value;
  cache.set(shape, mesh);
  return mesh;
}

type PlanarSketch = Readonly<{
  face(): ReplicadFace;
  delete(): void;
}>;

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
      return {shape: transform?.(face) ?? face};
    } finally {
      sketch.delete();
    }
  });
  const plane: StoredElement = {
    kind: 'face',
    transform: identityRigidTransform,
  };
  return ModelObject.create<PlanarElements, 'face'>({
    kind: 'face',
    name,
    geometry,
    intrinsic: plane,
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
    intrinsic: {...elements.start, kind: 'line'},
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
    index: number;
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
        index: index + 1,
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

function constraintReferences(constraint: StoredConstraint): ModelObject[] {
  return [
    constraint.source.model,
    constraint.target.model,
    ...constraint.rotations.map(action =>
      action.pivot.kind === 'around' ? action.pivot.axis.model : undefined,
    ),
  ].filter((model): model is ModelObject => !!model);
}

function transformedBounds(
  shape: AnyShape,
  transform: RigidTransform,
): LocalBounds {
  const moved = shapeWithTransform(shape, transform);
  try {
    return shapeBounds(moved);
  } finally {
    moved.delete();
  }
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
  const quaternion = composeTransforms(
    rotation(reference.model[referenceFrame]().quaternion),
    frameFromYAxis(origin, boundDirections[direction]),
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
  model: ModelObject,
  name: string,
  element: StoredElement & Readonly<{kind: Kind}>,
): Anchor<Kind> {
  const reference = {...element, model, name};
  return (
    element.topology
      ? new ModelTopologyElement(reference)
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
  model: ModelObject,
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

function unionSectionShape(left: Shape3D, right: Shape3D): AnyShape {
  const section = new (getOC().BRepAlgoAPI_Section)(
    left.wrapped,
    right.wrapped,
    false,
  );
  try {
    section.Build();
    const sectionShape = castOwnedShape(section.Shape());
    const edges = shapeSubshapes(sectionShape, 'edge');
    if (edges.length === 0) {
      return sectionShape;
    }
    let wire: ReturnType<typeof assembleWire> | undefined;
    try {
      wire = assembleWire(edges);
      const face = makeFace(wire);
      sectionShape.delete();
      return face;
    } catch {
      return sectionShape;
    } finally {
      edges.forEach(edge => edge.delete());
      wire?.delete();
    }
  } finally {
    section.delete();
  }
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
  model: ModelObject,
  anchor: StoredAnchor,
): ConstraintAnchorSnapshot;
function anchorSnapshot(
  modelOrReference: ModelObject | AnchorReference,
  stored?: StoredAnchor,
): ConstraintAnchorSnapshot {
  const model = stored ? (modelOrReference as ModelObject) : undefined;
  const reference = stored ?? (modelOrReference as AnchorReference);
  return {
    nodeId: (model ?? (modelOrReference as AnchorReference).model).nodeId,
    name: reference.name,
    kind: reference.kind,
  };
}

function uniqueModels(models: readonly ModelObject[]): ModelObject[] {
  return [...new Set(models)];
}

function toTransform(transform: RigidTransform): Transform {
  return {...transform, scale: unitScale};
}

function shapeWithTransform<Shape extends AnyShape>(
  source: Shape,
  transform: RigidTransform,
): Shape {
  let shape = source.clone();
  const {axis, angleDegrees} = quaternionAxisAngle(transform.quaternion);
  if (Math.abs(angleDegrees) > 1e-9) {
    shape = shape.rotate(angleDegrees, toPoint(origin), toPoint(axis));
  }
  shape = shape.translate(toPoint(transform.position));
  return shape as unknown as Shape;
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
