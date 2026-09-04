import {
  assembleWire,
  cast,
  getOC,
  loft as makeLoft,
  makeBox,
  makeBSplineApproximation,
  makeBezierCurve,
  makeCylinder,
  makeFace,
  makeLine,
  makeSphere,
  makeThreePointArc,
  makeVertex,
  sketchCircle,
  sketchEllipse,
  sketchPolysides,
  sketchRectangle,
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
  invertTransform,
  origin,
  quaternionAxisAngle,
  relativeTransform,
  rotation,
  transformsAreEquivalent,
  translation,
  type Quaternion,
  type RigidTransform,
  type Vec3,
} from './spatial.js';
import {
  evaluateKernelOperation,
  type KernelArtifact,
  type KernelKeyPart,
  type KernelValueLifecycle,
} from './kernel-cache.js';
import {makeHelicalThreadShape} from './thread.js';
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
  type EdgeId,
  type ShapeTopology,
  type SurfaceId,
  type TopologyKind,
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
  description?: string;
  kind?: ParameterKind;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
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
  | 'helicalThread'
  | 'paint'
  | 'scaled'
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
  color?: string;
  children: readonly ModelSnapshotObject[];
  /** Placement used when this snapshot participates in a composition. */
  compositionTransform: Transform;
  /** Placement in this snapshot tree; a root value keeps its intrinsic frame. */
  transform: Transform;
  constraints: readonly ConstraintSnapshot[];
  elements: readonly ElementSnapshot[];
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
  operation: ModelOperationSnapshot;
  mesh?: RenderMesh;
}>;

type StoredElement = Readonly<{
  kind: ElementKind;
  transform: RigidTransform;
}>;

type StoredElements = Readonly<Record<string, StoredElement>>;

type StoredAnchor = StoredElement & Readonly<{name: string}>;

type AnchorReference = StoredAnchor & Readonly<{model: ModelObject}>;

export type ModelElementReference = Readonly<{
  model: ModelObject;
  name: string;
  kind: ElementKind;
}>;

export type ModelTopologyReference = Readonly<{
  model: ModelObject;
  kind: TopologyKind;
  id: VertexId | EdgeId | SurfaceId;
}>;

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
  offset: Vec3;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
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
  siteId?: string;
  execution?: number;
  order?: number;
  sourceRef?: SourceRef;
};

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
}>;

type ModelGeometry = KernelArtifact<ModelGeometryValue>;

type SolidGeometry = KernelArtifact<
  ModelGeometryValue & Readonly<{shape: Shape3D}>
>;

type SolveContext = {
  poses: Map<ModelObject, RigidTransform>;
  visiting: Set<ModelObject>;
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

export interface Anchor<Kind extends ElementKind = ElementKind> {
  readonly [anchorKind]: Kind;
  on(target: Anchor): Constraint;
}

export interface PointAnchor extends Anchor<'point'> {}

export interface LineAnchor extends Anchor<'line'> {}

export interface FaceAnchor extends Anchor<'face'> {}

export interface Vertex extends PointAnchor {
  readonly kind: 'vertex';
  readonly id: VertexId;
}

export interface Edge extends LineAnchor {
  readonly kind: 'edge';
  readonly id: EdgeId;
}

export interface Surface extends FaceAnchor {
  readonly kind: 'surface';
  readonly id: SurfaceId;
}

type ElementSources = Readonly<Record<string, Anchor>>;
type NamedElements = Readonly<Record<string, Anchor>>;

type AnchorFor<Kind extends ElementKind> = Kind extends 'point'
  ? PointAnchor
  : Kind extends 'line'
    ? LineAnchor
    : Kind extends 'face'
      ? FaceAnchor
      : Anchor<'frame'>;

type ExposedElements<Sources extends ElementSources> = Readonly<{
  [Name in keyof Sources]: Sources[Name] extends Anchor<infer Kind>
    ? AnchorFor<Kind>
    : never;
}>;

type MergedElements<
  Existing extends NamedElements,
  Added extends NamedElements,
> = Omit<Existing, keyof Added> & Added;

type ModelElementKind<Kind extends ModelKind> = Kind extends 'face'
  ? 'face'
  : Kind extends 'edge'
    ? 'line'
    : Kind extends 'vertex'
      ? 'point'
      : 'frame';

type TopologyElementKind<Kind extends TopologyKind> = Kind extends 'surface'
  ? 'face'
  : Kind extends 'edge'
    ? 'line'
    : 'point';

type ModelFamily = ModelKind | 'model';

type ModelFamilyElementKind<Family extends ModelFamily> =
  Family extends ModelKind ? ModelElementKind<Family> : ElementKind;

type ModelForFamily<
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

interface ModelCapabilities<
  Elements extends NamedElements,
  Family extends ModelFamily,
> extends Anchor<ModelFamilyElementKind<Family>> {
  relate(
    build: (
      self: ModelForFamily<Elements, Family>,
    ) => Constraint | readonly Constraint[],
  ): ModelForFamily<Elements, Family>;
  expose<const Sources extends ElementSources>(
    sources: Sources,
  ): ModelForFamily<MergedElements<Elements, ExposedElements<Sources>>, Family>;
  paint(color: string): ModelForFamily<Elements, Family>;
}

interface GeometryCapabilities<
  Elements extends NamedElements,
  Family extends ModelGeometryKind,
> {
  /** @code3d.param factor {kind: 'ratio', label: 'Scale'} */
  scaled(factor: number): ModelForFamily<Elements, Family>;
}

interface VertexTopologyCapabilities {
  /** @code3d.param id {kind: 'vertex', label: 'Vertex'} */
  vertex(id: VertexId): Vertex;
  /** @code3d.param ids {kind: 'vertex', label: 'Vertices'} */
  vertices(ids?: readonly VertexId[]): readonly Vertex[];
}

interface EdgeTopologyCapabilities extends VertexTopologyCapabilities {
  /** @code3d.param id {kind: 'edge', label: 'Edge'} */
  edge(id: EdgeId): Edge;
  /** @code3d.param ids {kind: 'edge', label: 'Edges'} */
  edges(ids?: readonly EdgeId[]): readonly Edge[];
}

interface SurfaceTopologyCapabilities extends EdgeTopologyCapabilities {
  /** @code3d.param id {kind: 'surface', label: 'Surface'} */
  surface(id: SurfaceId): Surface;
  /** @code3d.param ids {kind: 'surface', label: 'Surfaces'} */
  surfaces(ids?: readonly SurfaceId[]): readonly Surface[];
}

interface SolidModificationCapabilities<Elements extends NamedElements> {
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

  constructor(readonly reference: AnchorReference) {
    this.elementKind = this.reference.kind as Kind;
  }

  on(target: Anchor): Constraint {
    return Constraint.create(this.reference, anchorReference(target));
  }
}

type TopologyIdByKind = Readonly<{
  vertex: VertexId;
  edge: EdgeId;
  surface: SurfaceId;
}>;

class ModelTopologyElement<Kind extends TopologyKind> implements Anchor<
  TopologyElementKind<Kind>
> {
  declare readonly [anchorKind]: TopologyElementKind<Kind>;
  readonly elementKind: TopologyElementKind<Kind>;

  constructor(
    readonly model: ModelObject,
    readonly kind: Kind,
    readonly id: TopologyIdByKind[Kind],
    readonly transform: RigidTransform,
  ) {
    this.elementKind = topologyElementKinds[
      kind
    ] as unknown as TopologyElementKind<Kind>;
  }

  on(target: Anchor): Constraint {
    return Constraint.create(
      topologyAnchorReference(this),
      anchorReference(target),
    );
  }
}

const topologyElementKinds = {
  vertex: 'point',
  edge: 'line',
  surface: 'face',
} as const satisfies Record<TopologyKind, ElementKind>;

export function modelElementReference(
  value: unknown,
): ModelElementReference | undefined {
  if (!(value instanceof ModelAnchor)) return undefined;
  return {
    model: value.reference.model,
    name: value.reference.name,
    kind: value.reference.kind,
  };
}

export function modelTopologyReference(
  value: unknown,
): ModelTopologyReference | undefined {
  if (!(value instanceof ModelTopologyElement)) return undefined;
  return {model: value.model, kind: value.kind, id: value.id};
}

export class Constraint {
  private readonly sourceRefs: SourceRef[];
  private readonly parameters: ParameterUsage[];

  private constructor(
    private readonly source: AnchorReference,
    private readonly target: AnchorReference,
    private readonly displacement: Vec3 = origin,
    private readonly isFlipped = false,
    private readonly constraintId = `constraint-${nextConstraintId++}`,
    sourceRefs: readonly SourceRef[] = [],
    parameters: readonly ParameterUsage[] = [],
  ) {
    this.sourceRefs = [...sourceRefs];
    this.parameters = [...parameters];
  }

  /** @internal */
  static create(source: AnchorReference, target: AnchorReference): Constraint {
    return new Constraint(source, target);
  }

  /**
   * @code3d.param x {kind: 'length', label: 'ΔX'}
   * @code3d.param y {kind: 'length', label: 'ΔY'}
   * @code3d.param z {kind: 'length', label: 'ΔZ'}
   */
  offset(x: number, y: number, z: number): Constraint {
    assertFiniteVector('offset', [x, y, z]);
    return new Constraint(
      this.source,
      this.target,
      addVectors(this.displacement, [x, y, z]),
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
    return {
      id: this.constraintId,
      kind: 'on',
      source: storedAnchor(this.source),
      target: this.target,
      flipped: this.isFlipped,
      offset: this.displacement,
      sourceRefs: [...this.sourceRefs],
      parameters: [...this.parameters],
    };
  }
}

export class ModelObject<
  Elements extends NamedElements = {},
  Kind extends ModelKind = ModelKind,
> implements Anchor<ModelElementKind<Kind>> {
  declare readonly [anchorKind]: ModelElementKind<Kind>;
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
  readonly sourceRefs: SourceRef[];
  /** @internal */
  readonly parameters: ParameterUsage[];
  private readonly geometry?: ModelGeometry;
  private readonly meshTolerance: number;
  private readonly intrinsic: StoredElement;
  private readonly elements: StoredElements;
  private constraints: StoredConstraint[];
  private readonly operation: StoredOperation;

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
    this.sourceRefs = [...(init.sourceRefs ?? [])];
    this.parameters = [...(init.parameters ?? [])];
    this.operation = init.operation;
    this.elements =
      init.elements ??
      (this.kind === 'solid' && this.geometry
        ? canonicalElements(this.geometry.value.localBounds)
        : {});
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
    const context = createSolveContext();
    const ownPose = this.solvePose(context);
    const references: ModelObject[] = [];
    const exposed = Object.fromEntries(
      Object.entries(sources).map(([name, source]) => {
        const reference = anchorReference(source);
        references.push(reference.model);
        return [
          name,
          {
            kind: reference.kind,
            transform: relativeTransform(
              composeTransforms(
                reference.model.solvePose(context),
                reference.transform,
              ),
              ownPose,
            ),
          },
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
    ) as RuntimeModel<MergedElements<Elements, ExposedElements<Sources>>, Kind>;
  }

  vertex(id: VertexId): Vertex {
    return this.vertices([id])[0];
  }

  vertices(ids?: readonly VertexId[]): readonly Vertex[] {
    const geometry = this.requireGeometry().value;
    const topology = geometry.topology.vertices;
    const selectedIds = ids ?? topology.ids;
    const points = topologyVertexPoints(geometry.shape, topology, selectedIds);
    return selectedIds.map(
      (id, index) =>
        new ModelTopologyElement(
          this,
          'vertex',
          id,
          translation(points[index].position),
        ),
    );
  }

  surface(id: SurfaceId): Surface {
    return this.surfaces([id])[0];
  }

  surfaces(ids?: readonly SurfaceId[]): readonly Surface[] {
    const geometry = this.requireGeometry().value;
    const topology = geometry.topology.surfaces;
    const selectedIds = ids ?? topology.ids;
    const directions = topologySurfaceDirections(
      geometry.shape,
      topology,
      selectedIds,
    );
    return selectedIds.map(
      (id, index) =>
        new ModelTopologyElement(
          this,
          'surface',
          id,
          frameFromYAxis(
            directions[index].position,
            directions[index].direction,
          ),
        ),
    );
  }

  edge(id: EdgeId): Edge {
    return this.edges([id])[0];
  }

  edges(ids?: readonly EdgeId[]): readonly Edge[] {
    const geometry = this.requireGeometry().value;
    const topology = geometry.topology.edges;
    const selectedIds = ids ?? topology.ids;
    const directions = topologyEdgeDirections(
      geometry.shape,
      topology,
      selectedIds,
    );
    return selectedIds.map(
      (id, index) =>
        new ModelTopologyElement(
          this,
          'edge',
          id,
          frameFromYAxis(
            directions[index].position,
            directions[index].direction,
          ),
        ),
    );
  }

  paint(color: string): RuntimeModel<Elements, Kind> {
    return this.copy(
      {color},
      storedOperation('paint', [{model: this, role: 'source', index: 0}]),
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
    if (this.operation.siteId) {
      return;
    }
    Object.assign(this.operation, {siteId, execution, order, sourceRef});
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
    const solveContext = createSolveContext();
    return this.snapshotNode(meshCache, solveContext);
  }

  private snapshotNode(
    meshCache: Map<AnyShape, RenderMesh>,
    solveContext: SolveContext,
    parentPose?: RigidTransform,
  ): ModelSnapshotObject {
    const pose = this.solvePose(solveContext);
    const compositionPose = parentPose
      ? relativeTransform(pose, parentPose)
      : pose;
    const constraints = this.constraints.map(constraint =>
      this.constraintSnapshot(
        constraint,
        solveContext,
        parentPose ?? identityRigidTransform,
      ),
    );
    const parameters = uniqueParameters([
      ...this.parameters,
      ...this.constraints.flatMap(constraint => constraint.parameters),
    ]);
    const common = {
      nodeId: this.nodeId,
      kind: this.kind,
      name: this.name,
      color: this.color,
      compositionTransform: toTransform(compositionPose),
      transform: toTransform(
        parentPose ? compositionPose : identityRigidTransform,
      ),
      constraints,
      elements: Object.entries(this.elements).map(([name, element]) => ({
        name,
        kind: element.kind,
        transform: toTransform(element.transform),
      })),
      sourceRefs: [...this.sourceRefs],
      parameters,
      operation: this.operationSnapshot(meshCache),
    } as const;

    if (this.kind === 'group') {
      return {
        ...common,
        children: this.children.map(child =>
          child.snapshotNode(meshCache, solveContext, pose),
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
    const solveContext = createSolveContext();
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
        evaluation.geometry.value.shape.delete();
        evaluation.regions.forEach(region => region.artifact.value.delete());
      }
    }
  }

  private evaluateBoolean(
    this: ModelObject<Elements, 'solid'>,
    operation: BooleanOperation,
    others: readonly ModelObject<{}, 'solid'>[],
  ): BooleanEvaluation {
    const solveContext = createSolveContext();
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
      ...this.constraints.flatMap(constraint => constraint.parameters),
    ]);
  }

  private solvePose(context: SolveContext): RigidTransform {
    const cached = context.poses.get(this);
    if (cached) {
      return cached;
    }
    if (context.visiting.has(this)) {
      throw new Error(`The relations for ${this.name} form a cycle.`);
    }

    context.visiting.add(this);
    let pose: RigidTransform | undefined;
    for (const constraint of this.constraints) {
      const candidate = this.solveConstraint(constraint, context);
      if (pose && !transformsAreEquivalent(pose, candidate)) {
        throw new Error(
          `The constraints for ${this.name} do not have one consistent solution.`,
        );
      }
      pose = candidate;
    }
    pose ??= identityRigidTransform;
    context.visiting.delete(this);
    context.poses.set(this, pose);
    return pose;
  }

  private solveConstraint(
    constraint: StoredConstraint,
    context: SolveContext,
  ): RigidTransform {
    const targetPose = constraint.target.model.solvePose(context);
    return composeAll(
      targetPose,
      constraint.target.transform,
      translation(constraint.offset),
      constraint.flipped ? identityRigidTransform : rotation(halfTurnAroundX),
      invertTransform(constraint.source.transform),
    );
  }

  private constraintSnapshot(
    constraint: StoredConstraint,
    context: SolveContext,
    basis: RigidTransform,
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
      offset: constraint.offset,
      offsetFrame: toTransform(relativeTransform(offsetFrame, basis)),
      sourceRefs: [...constraint.sourceRefs],
      parameters: [...constraint.parameters],
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
    const {
      siteId,
      execution,
      kind,
      order,
      sourceRef,
      inputs,
      regions,
      selections,
    } = this.operation;
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
      geometry.value.shape.delete();
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
  }) as VertexModel;
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
    operation: storedOperation('cylinder'),
  }) as unknown as SolidModel;
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
    operation: storedOperation('regularPrism'),
  }) as unknown as SolidModel;
}

export type HelicalThreadOptions = Readonly<{
  pitch: number;
  y: number;
  majorDiameter: number;
  minorDiameter: number;
  rootWidth: number;
  crestWidth: number;
  leftHanded?: boolean;
}>;

export function helicalThread(options: HelicalThreadOptions): SolidModel {
  const {
    pitch,
    y,
    majorDiameter,
    minorDiameter,
    rootWidth,
    crestWidth,
    leftHanded = false,
  } = options;
  assertPositive('pitch', pitch);
  assertPositive('y', y);
  assertPositive('majorDiameter', majorDiameter);
  assertPositive('minorDiameter', minorDiameter);
  assertPositive('rootWidth', rootWidth);
  assertPositive('crestWidth', crestWidth);
  if (y < pitch) {
    throw new Error('y must be at least one thread pitch.');
  }
  if (minorDiameter >= majorDiameter) {
    throw new Error('minorDiameter must be smaller than majorDiameter.');
  }
  if (crestWidth >= rootWidth || rootWidth > pitch) {
    throw new Error(
      'The thread profile requires crestWidth < rootWidth <= pitch.',
    );
  }
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Helical thread',
    geometry: evaluateSolidGeometry(
      'helical-thread',
      [
        pitch,
        y,
        majorDiameter,
        minorDiameter,
        rootWidth,
        crestWidth,
        leftHanded,
      ],
      [],
      () => ({
        shape: makeHelicalThreadShape({
          pitch,
          y,
          majorRadius: majorDiameter / 2,
          minorRadius: minorDiameter / 2,
          rootWidth,
          crestWidth,
          leftHanded,
        }),
      }),
    ),
    meshTolerance: Math.min(0.12, pitch / 8),
    operation: storedOperation('helicalThread'),
  }) as unknown as SolidModel;
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
  sphere,
  frustum,
  regularPrism,
  helicalThread,
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
  return operation.siteId !== undefined && operation.execution !== undefined
    ? `${operation.siteId}:execution:${operation.execution}`
    : operation.runtimeId;
}

const shapeLifecycle: KernelValueLifecycle<AnyShape> = {
  retain: shape => shape.clone(),
  instantiate: shape => shape.clone(),
  release: shape => shape.delete(),
};

const modelGeometryLifecycle: KernelValueLifecycle<ModelGeometryValue> = {
  retain: geometry => ({...geometry, shape: geometry.shape.clone()}),
  instantiate: geometry => ({...geometry, shape: geometry.shape.clone()}),
  release: geometry => geometry.shape.delete(),
};

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
  }>,
): ModelGeometry {
  return evaluateKernelOperation(
    operation,
    arguments_,
    inputs,
    modelGeometryLifecycle,
    () => {
      const result = compute();
      try {
        return {
          shape: result.shape,
          topology: result.topology ?? initialShapeTopology(result.shape),
          localBounds: shapeBounds(result.shape),
        };
      } catch (error) {
        result.shape.delete();
        throw error;
      }
    },
  );
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
      center: {kind: 'point', transform: identityRigidTransform},
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

function canonicalElements(bounds: LocalBounds): StoredElements {
  const [[minX, minY, minZ], [maxX, maxY, maxZ]] = bounds;
  const center: Vec3 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  return {
    center: {kind: 'point', transform: translation(center)},
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
  return new ModelAnchor<Kind>({model, name, ...element});
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

function scaleElement(element: StoredElement, factor: number): StoredElement {
  return {
    ...element,
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
  if (anchor instanceof ModelTopologyElement) {
    return topologyAnchorReference(anchor);
  }
  return (anchor as ModelAnchor).reference;
}

function topologyAnchorReference(
  element: ModelTopologyElement<TopologyKind>,
): AnchorReference {
  const prefixes = {
    vertex: 'V',
    edge: 'E',
    surface: 'S',
  } as const satisfies Record<TopologyKind, string>;
  return {
    model: element.model,
    name: `${prefixes[element.kind]}${element.id}`,
    kind: element.elementKind,
    transform: element.transform,
  };
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

function createSolveContext(): SolveContext {
  return {poses: new Map(), visiting: new Set()};
}

function composeAll(...transforms: readonly RigidTransform[]): RigidTransform {
  return transforms.reduce(composeTransforms, identityRigidTransform);
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
