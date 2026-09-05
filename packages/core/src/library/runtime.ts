import {
  assembleWire,
  basicFaceExtrusion,
  cast,
  genericSweep,
  getOC,
  loft as makeLoft,
  makeBox,
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
  type Shape3D,
  type Wire as ReplicadWire,
} from 'replicad';
import type {TopoDS_Shape} from 'replicad-opencascadejs';
import {
  addVectors,
  composeTransforms,
  frameFromYAxis,
  halfTurnAroundX,
  identityRigidTransform,
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
import {solveBodies} from './constraint-solver.js';
import {
  evaluateKernelOperation,
  type KernelArtifact,
  type KernelKeyPart,
  type KernelValueLifecycle,
} from './kernel-cache.js';
import {
  booleanWithTopology,
  chamferEdges,
  filletEdges,
  initialShapeTopology,
  preserveShapeTopology,
  resolveEdgeSelection,
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
  kind: 'on';
  source: ConstraintAnchorSnapshot;
  target: ConstraintAnchorSnapshot;
  flipped: boolean;
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
  kind: 'edge';
  inputNodeId: string;
  ids: readonly EdgeId[];
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
    edgeId: number;
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
  kind: 'on';
  source: StoredAnchor;
  target: AnchorReference;
  flipped: boolean;
  offset: Vec3 | undefined;
}>;

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
  kind: 'edge';
  input: ModelObject;
  ids: readonly EdgeId[];
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
  /** Constrain point, line, plane, or complete-frame geometry. Centering is a preference. */
  on(target: Anchor): Constraint;
}

export interface PointAnchor extends Anchor<'point'> {}

export interface LineAnchor extends Anchor<'line'> {}

export interface FaceAnchor extends Anchor<'face'> {}

export interface GeometryQueryCapabilities {
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
> extends Anchor<ModelFamilyElementKind<Family>> {
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
    EdgeTopologyCapabilities &
    Elements;

export type FaceModel<Elements extends NamedElements = PlanarElements> =
  ModelCapabilities<Elements, 'face'> &
    GeometryCapabilities<Elements, 'face'> &
    SurfaceTopologyCapabilities &
    Elements;

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
  top: FaceAnchor;
  bottom: FaceAnchor;
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

  on(target: Anchor): Constraint {
    return Constraint.create(
      this[anchorReferenceValue],
      anchorReference(target),
    );
  }
}

class ModelTopologyElement extends ModelAnchor {
  get kind(): TopologySelection['kind'] {
    return this.#topology.selection.kind;
  }
  get id(): number | undefined {
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
    ids?: readonly number[],
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
): readonly number[] | undefined {
  const topology =
    value instanceof ModelTopologyElement
      ? value[anchorReferenceValue].topology
      : undefined;
  const source = isModelObject(value) ? value : topology?.source;
  const geometry = source?.[modelGeometry]()?.value;
  if (!geometry) return undefined;
  return topologyChildren(
    geometry.shape,
    geometry.topology,
    topology?.selection ?? {kind: 'solid'},
    kind,
  );
}

export class Constraint {
  private get sourceRefs(): SourceRef[] {
    return valueTrace(this).sourceRefs;
  }

  private get parameters(): ParameterUsage[] {
    return valueTrace(this).parameters;
  }

  private constructor(
    private readonly source: AnchorReference,
    private readonly target: AnchorReference,
    private readonly displacement: Vec3 | undefined = undefined,
    private readonly isFlipped = false,
    private readonly constraintId = `constraint-${nextConstraintId++}`,
    sourceRefs: readonly SourceRef[] = [],
    parameters: readonly ParameterUsage[] = [],
  ) {
    valueTraces.set(this, {
      sourceRefs: [...sourceRefs],
      parameters: [...parameters],
    });
  }

  /** @internal */
  static create(source: AnchorReference, target: AnchorReference): Constraint {
    return new Constraint(source, target);
  }

  /**
   * Pin the anchor position to this displacement in the target frame.
   * Calling offset(0, 0, 0) explicitly requires coincident anchor centers.
   * @code3d.param x {kind: 'length', label: 'ΔX'}
   * @code3d.param y {kind: 'length', label: 'ΔY'}
   * @code3d.param z {kind: 'length', label: 'ΔZ'}
   */
  offset(x: number, y: number, z: number): Constraint {
    assertFiniteVector('offset', [x, y, z]);
    return new Constraint(
      this.source,
      this.target,
      addVectors(this.displacement ?? origin, [x, y, z]),
      this.isFlipped,
      this.constraintId,
      this.sourceRefs,
      this.parameters,
    );
  }

  flip(): Constraint {
    return new Constraint(
      this.source,
      this.target,
      this.displacement,
      !this.isFlipped,
      this.constraintId,
      this.sourceRefs,
      this.parameters,
    );
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
  traceReference(): ConstraintTraceReference {
    return {
      constraintId: this.constraintId,
      source: this.source.model,
      target: this.target.model,
    };
  }

  /** @internal */
  storeFor(model: ModelObject): StoredConstraint {
    if (this.source.model !== model) {
      throw new Error(
        'The constraint returned by relate() must originate from the model copy passed to its callback.',
      );
    }
    const stored: StoredConstraint = {
      id: this.constraintId,
      kind: 'on',
      source: storedAnchor(this.source),
      target: this.target,
      flipped: this.isFlipped,
      offset: this.displacement,
    };
    valueTraces.set(stored, {
      sourceRefs: [...this.sourceRefs],
      parameters: [...this.parameters],
    });
    return stored;
  }
}

const modelGeometry = Symbol('modelGeometry');

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
        ? solidBoundsElements(this.geometry.value.localBounds)
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

  on(target: Anchor): Constraint {
    return Constraint.create(
      this.relationAnchorReference(),
      anchorReference(target),
    );
  }

  /** @internal */
  relationAnchorReference(): AnchorReference {
    return {model: this, name: 'origin', ...this.intrinsic};
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
    const built = build(related);
    const constraints = Array.isArray(built) ? built : [built];
    const stored = constraints.map(constraint => constraint.storeFor(related));
    related.constraints.push(...stored);
    operation.inputs.push(
      ...stored.map((constraint, index) => ({
        model: constraint.target.model,
        role: 'reference' as const,
        index,
      })),
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
            {kind, transform: frame, topology, members: nested},
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
    ids?: readonly number[],
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

  /** @internal */
  withChildren(
    this: ModelObject<Elements, 'group'>,
    children: readonly ModelObject[],
  ): RuntimeModel<Elements, 'group'> {
    if (this.kind !== 'group') {
      throw new Error('Only a group can contain child objects.');
    }
    assertChildren(children);
    return this.copy(
      {children},
      storedOperation(
        'group',
        children.map((model, index) => ({model, role: 'child', index})),
      ),
    );
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
      ...this.constraints.map(constraint => constraint.target.model),
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
      elements: snapshotElements(this.elements),
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
      () => ({
        shape: buildLoftShape(sectionInputs, spineInput, ruled),
      }),
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
      for (const other of others) {
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
            [],
            [geometry, operand],
            () => {
              const result = booleanWithTopology(
                geometry.value.shape,
                operand.value,
                operation,
                geometry.value.topology,
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

  private static createSolveContext(
    roots: readonly ModelObject[],
  ): SolveContext {
    const models: ModelObject[] = [];
    const indices = new Map<ModelObject, number>();
    const collect = (model: ModelObject): void => {
      if (indices.has(model)) return;
      indices.set(model, models.length);
      models.push(model);
      model.constraints.forEach(constraint => collect(constraint.target.model));
    };
    roots.forEach(collect);
    const poses = solveBodies(
      models.map(model => ({
        name: model.name,
        relations: model.constraints.map(constraint => ({
          ...constraint,
          target: {
            ...constraint.target,
            body: indices.get(constraint.target.model)!,
          },
        })),
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
    const targetPose = constraint.target.model.solvePose(context);
    const offsetFrame = composeTransforms(
      targetPose,
      constraint.target.transform,
    );
    return {
      id: constraint.id,
      kind: constraint.kind,
      source: anchorSnapshot(this, constraint.source),
      target: anchorSnapshot(constraint.target),
      flipped: constraint.flipped,
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
      shape: makeBox([-x / 2, -y / 2, -z / 2], [x / 2, y / 2, z / 2]),
    })),
    elements: solidBoundsElements([
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
    elements: solidBoundsElements([
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
    elements: solidBoundsElements([
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
    elements: solidBoundsElements([
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
    elements: solidBoundsElements([
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
    elements: solidBoundsElements([
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
    elements: solidBoundsElements([
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

export function instrumentConstraint(
  constraint: Constraint,
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
  constraint: Constraint,
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

function buildLoftShape(
  sections: readonly PositionedModelGeometry[],
  spine: PositionedModelGeometry | undefined,
  ruled: boolean,
): Shape3D {
  const wires = sections.map(section => {
    const face = shapeWithTransform(
      section.geometry.value.shape as ReplicadFace,
      section.transform,
    );
    return face.outerWire();
  });
  let spineWire: ReplicadWire | undefined;
  try {
    if (!spine) return makeLoft(wires, {ruled});
    const edge = shapeWithTransform(
      spine.geometry.value.shape as ReplicadEdge,
      spine.transform,
    );
    try {
      spineWire = assembleWire([edge]);
    } finally {
      edge.delete();
    }
    return makeSpineLoft(wires, spineWire);
  } finally {
    wires.forEach(wire => wire.delete());
    spineWire?.delete();
  }
}

function makeSpineLoft(
  sections: readonly ReplicadWire[],
  spine: ReplicadWire,
): Shape3D {
  const builder = new (getOC().BRepOffsetAPI_MakePipeShell)(spine.wrapped);
  try {
    builder.SetMode(false);
    sections.forEach(section => builder.Add(section.wrapped, false, false));
    if (!builder.IsReady()) {
      throw new Error(
        'The loft sections could not be associated with the spine.',
      );
    }
    builder.Build();
    if (!builder.IsDone() || !builder.MakeSolid()) {
      throw new Error('Could not construct a solid loft along the spine.');
    }
    return castOwnedShape3D(builder.Shape());
  } finally {
    builder.delete();
  }
}

function castOwnedShape3D(shape: TopoDS_Shape): Shape3D {
  let result: ReturnType<typeof cast>;
  try {
    result = cast(shape);
  } finally {
    shape.delete();
  }
  try {
    return result.asShape3D();
  } catch (error) {
    result.delete();
    throw error;
  }
}

function shapeBounds(shape: AnyShape): LocalBounds {
  const boundingBox = shape.boundingBox;
  const [minimum, maximum] = boundingBox.bounds;
  boundingBox.delete();
  return [
    [minimum[0], minimum[1], minimum[2]],
    [maximum[0], maximum[1], maximum[2]],
  ];
}

function boundsCenter(bounds: LocalBounds): Vec3 {
  const [[minX, minY, minZ], [maxX, maxY, maxZ]] = bounds;
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

function solidBoundsElements(bounds: LocalBounds): StoredElements {
  const [[, minY], [, maxY]] = bounds;
  const center = boundsCenter(bounds);
  return {
    top: {
      kind: 'face',
      transform: translation([center[0], maxY, center[2]]),
    },
    bottom: {
      kind: 'face',
      transform: composeTransforms(
        translation([center[0], minY, center[2]]),
        rotation(halfTurnAroundX),
      ),
    },
    axis: {kind: 'line', transform: translation(center)},
  };
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
    : `${{vertex: 'V', edge: 'E', surface: 'S'}[selection.kind]}${selection.id}`;
}

function topologyReferences(
  model: ModelObject,
  prefix: string,
  context: Omit<StoredTopology, 'selection'>,
  kind: TopologyKind,
  ids: readonly number[],
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
    const sectionShape = cast(section.Shape());
    const edges = sectionShape.edges;
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

function anchorReference(anchor: Anchor): AnchorReference {
  if (anchor instanceof ModelObject) {
    return anchor.relationAnchorReference();
  }
  return (anchor as ModelAnchor)[anchorReferenceValue];
}

function storedAnchor(reference: AnchorReference): StoredAnchor {
  return {
    name: reference.name,
    kind: reference.kind,
    transform: reference.transform,
  };
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

function assertChildren(children: readonly ModelObject[]): void {
  for (const child of children) {
    if (!isModelObject(child)) {
      throw new Error('Every group child must be a ModelObject.');
    }
  }
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
