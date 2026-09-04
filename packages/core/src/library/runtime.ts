import {
  assembleWire,
  cast,
  getOC,
  makeBox,
  makeCylinder,
  makeFace,
  makeSphere,
  sketchCircle,
  sketchPolysides,
  type AnyShape,
  type Shape3D,
} from 'replicad';
import {
  addVectors,
  composeTransforms,
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
  initialEdgeTopology,
  preserveEdgeTopology,
  resolveEdgeSelection,
  stableEdgeGroups,
  type EdgeId,
  type EdgeTopology,
} from './topology.js';

export type {Quaternion, Vec3} from './spatial.js';
export type {EdgeId} from './topology.js';

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
  | 'reference';

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
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  faceGroups: readonly Readonly<{
    start: number;
    count: number;
    faceId: number;
  }>[];
  edgeGroups: readonly Readonly<{
    start: number;
    count: number;
    edgeId: number;
  }>[];
}>;

export type ModelSnapshotObject = Readonly<{
  nodeId: string;
  kind: 'solid' | 'group';
  name: string;
  color?: string;
  children: readonly ModelSnapshotObject[];
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

type ModelObjectInit = Readonly<{
  kind: 'solid' | 'group';
  geometry?: SolidGeometry;
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

type SolidGeometryValue = Readonly<{
  shape: Shape3D;
  edgeTopology: EdgeTopology;
  localBounds: LocalBounds;
}>;

type SolidGeometry = KernelArtifact<SolidGeometryValue>;

type SolveContext = {
  poses: Map<ModelObject, RigidTransform>;
  visiting: Set<ModelObject>;
};

const unitScale: Vec3 = [1, 1, 1];
let nextNodeId = 1;
let nextConstraintId = 1;
let nextOperationId = 1;
const combineModels = Symbol('combineModels');

export interface Anchor<Kind extends ElementKind = ElementKind> {
  readonly elementKind: Kind;
  on(target: Anchor): Constraint;
}

export interface PointAnchor extends Anchor<'point'> {}

export interface LineAnchor extends Anchor<'line'> {}

export interface FaceAnchor extends Anchor<'face'> {}

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

export type Model<Elements extends NamedElements = {}> = ModelObject<Elements> &
  Elements;

export type CanonicalElements = Readonly<{
  center: PointAnchor;
  top: FaceAnchor;
  bottom: FaceAnchor;
  axis: LineAnchor;
}>;

class ModelAnchor<
  Kind extends ElementKind = ElementKind,
> implements Anchor<Kind> {
  readonly elementKind: Kind;

  constructor(readonly reference: AnchorReference) {
    this.elementKind = this.reference.kind as Kind;
  }

  on(target: Anchor): Constraint {
    return new Constraint(this.reference, anchorReference(target));
  }
}

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

export class Constraint {
  private readonly sourceRefs: SourceRef[];
  private readonly parameters: ParameterUsage[];

  constructor(
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

  /** Runtime instrumentation hook. Not part of the authoring API. */
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

  /** Runtime instrumentation hook. Not part of the authoring API. */
  attachParameters(parameters: readonly ParameterUsage[]): void {
    appendUniqueParameters(this.parameters, parameters);
  }

  /** Runtime instrumentation hook. Not part of the authoring API. */
  traceReference(): Readonly<{
    constraintId: string;
    source: ModelObject;
    target: ModelObject;
  }> {
    return {
      constraintId: this.constraintId,
      source: this.source.model,
      target: this.target.model,
    };
  }

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
> implements Anchor<'frame'> {
  readonly elementKind = 'frame' as const;
  readonly nodeId: string;
  readonly kind: 'solid' | 'group';
  readonly name: string;
  readonly color?: string;
  readonly children: readonly ModelObject[];
  readonly sourceRefs: SourceRef[];
  readonly parameters: ParameterUsage[];
  private readonly geometry?: SolidGeometry;
  private readonly meshTolerance: number;
  private readonly elements: StoredElements;
  private constraints: StoredConstraint[];
  private readonly operation: StoredOperation;

  constructor(init: ModelObjectInit) {
    if (init.kind === 'solid' && !init.geometry) {
      throw new Error(
        'A solid model object must contain an OpenCascade shape.',
      );
    }
    this.nodeId = init.nodeId ?? `node-${nextNodeId++}`;
    this.kind = init.kind;
    this.geometry = init.geometry;
    this.meshTolerance = init.meshTolerance ?? 0.2;
    this.name = init.name ?? (init.kind === 'solid' ? 'Solid' : 'Group');
    this.color = init.color;
    this.children = init.children ?? [];
    this.constraints = [...(init.constraints ?? [])];
    this.sourceRefs = [...(init.sourceRefs ?? [])];
    this.parameters = [...(init.parameters ?? [])];
    this.operation = init.operation;
    this.elements =
      init.elements ??
      (this.geometry ? canonicalElements(this.geometry.value.localBounds) : {});
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

  on(target: Anchor): Constraint {
    return new Constraint(
      {
        model: this,
        name: 'origin',
        kind: 'frame',
        transform: identityRigidTransform,
      },
      anchorReference(target),
    );
  }

  relate(
    build: (self: Model<Elements>) => Constraint | readonly Constraint[],
  ): Model<Elements> {
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
  ): Model<MergedElements<Elements, ExposedElements<Sources>>> {
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
    ) as Model<MergedElements<Elements, ExposedElements<Sources>>>;
  }

  paint(color: string): Model<Elements> {
    return this.copy(
      {color},
      storedOperation('paint', [{model: this, role: 'source', index: 0}]),
    );
  }

  /** @code3d.param factor {kind: 'ratio', label: 'Scale'} */
  scaled(factor: number): Model<Elements> {
    assertPositive('scale', factor);
    const source = this.requireGeometry();
    const geometry = evaluateSolidGeometry('scaled', [factor], [source], () => {
      const shape = source.value.shape.clone().scale(factor, toPoint(origin));
      try {
        return {
          shape,
          edgeTopology: preserveEdgeTopology(shape, source.value.edgeTopology),
        };
      } catch (error) {
        shape.delete();
        throw error;
      }
    });
    return this.copyWithGeometry(
      geometry,
      {elements: scaleElements(this.elements, factor)},
      storedOperation('scaled', [{model: this, role: 'source', index: 0}]),
    );
  }

  /**
   * @code3d.param radius {kind: 'length', label: 'Fillet radius', constraints: {exclusiveMin: 0}}
   * @code3d.param edgeIds {kind: 'edge', actions: [{label: 'Use all', action: 'remove-argument'}]}
   */
  fillet(radius: number, edgeIds?: readonly EdgeId[]): Model<Elements> {
    assertPositive('radius', radius);
    const source = this.requireGeometry();
    const selectedEdgeIds = resolveEdgeSelection(
      source.value.edgeTopology,
      edgeIds,
    );
    const geometry = evaluateSolidGeometry(
      'fillet',
      [radius, selectedEdgeIds],
      [source],
      () => {
        const result = filletEdges(
          source.value.shape,
          source.value.edgeTopology,
          radius,
          selectedEdgeIds,
        );
        return {shape: result.shape, edgeTopology: result.topology};
      },
    );
    return this.copyWithGeometry(
      geometry,
      {},
      storedOperation('fillet', [{model: this, role: 'source', index: 0}], {
        selections: [{kind: 'edge', input: this, ids: selectedEdgeIds}],
      }),
    );
  }

  /**
   * @code3d.param distance {kind: 'length', label: 'Chamfer distance', constraints: {exclusiveMin: 0}}
   * @code3d.param edgeIds {kind: 'edge', actions: [{label: 'Use all', action: 'remove-argument'}]}
   */
  chamfer(distance: number, edgeIds?: readonly EdgeId[]): Model<Elements> {
    assertPositive('distance', distance);
    const source = this.requireGeometry();
    const selectedEdgeIds = resolveEdgeSelection(
      source.value.edgeTopology,
      edgeIds,
    );
    const geometry = evaluateSolidGeometry(
      'chamfer',
      [distance, selectedEdgeIds],
      [source],
      () => {
        const result = chamferEdges(
          source.value.shape,
          source.value.edgeTopology,
          distance,
          selectedEdgeIds,
        );
        return {shape: result.shape, edgeTopology: result.topology};
      },
    );
    return this.copyWithGeometry(
      geometry,
      {},
      storedOperation('chamfer', [{model: this, role: 'source', index: 0}], {
        selections: [{kind: 'edge', input: this, ids: selectedEdgeIds}],
      }),
    );
  }

  withChildren(children: readonly ModelObject[]): Model<Elements> {
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

  /** Runtime instrumentation hook. Not part of the authoring API. */
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

  /** Runtime instrumentation hook. Not part of the authoring API. */
  attachParameters(parameters: readonly ParameterUsage[]): void {
    appendUniqueParameters(this.parameters, parameters);
  }

  /** Runtime instrumentation hook. Not part of the authoring API. */
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

  /** Runtime graph hook. Not part of the authoring API. */
  relatedObjects(): readonly ModelObject[] {
    return [
      ...this.children,
      ...this.operation.inputs.map(input => input.model),
      ...this.constraints.map(constraint => constraint.target.model),
    ];
  }

  toSnapshot(
    meshCache: Map<AnyShape, RenderMesh> = new Map(),
    solveContext: SolveContext = createSolveContext(),
  ): ModelSnapshotObject {
    const pose = this.solvePose(solveContext);
    const constraints = this.constraints.map(constraint =>
      this.constraintSnapshot(constraint, solveContext),
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
      transform: toTransform(pose),
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
          child.toSnapshot(meshCache, solveContext),
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
        geometry.value.edgeTopology,
      ),
    };
  }

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

  [combineModels](
    operation: BooleanOperation,
    others: readonly ModelObject[],
  ): Model<CanonicalElements> {
    const evaluation = this.evaluateBoolean(operation, others);
    let transferred = false;
    try {
      const combined = new ModelObject<CanonicalElements>({
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
      return combined as Model<CanonicalElements>;
    } finally {
      if (!transferred) {
        evaluation.geometry.value.shape.delete();
        evaluation.regions.forEach(region => region.artifact.value.delete());
      }
    }
  }

  private evaluateBoolean(
    operation: BooleanOperation,
    others: readonly ModelObject[],
  ): BooleanEvaluation {
    const solveContext = createSolveContext();
    const targetPose = this.solvePose(solveContext);
    let geometry = this.requireGeometry();
    let temporaryGeometry: SolidGeometry | undefined;
    const regions: StoredOperationRegion[] = [];
    let evaluated = false;
    try {
      for (const other of others) {
        const otherGeometry = other.requireGeometry();
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
                geometry.value.edgeTopology,
              );
              return {
                shape: result.shape,
                edgeTopology: result.topology,
              };
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
      offsetFrame: toTransform(offsetFrame),
      sourceRefs: [...constraint.sourceRefs],
      parameters: [...constraint.parameters],
    };
  }

  private requireGeometry(): SolidGeometry {
    if (!this.geometry) {
      throw new Error(
        'This operation requires a solid and cannot act on a group.',
      );
    }
    return this.geometry;
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
    geometry: SolidGeometry,
    overrides: Partial<ModelObjectInit>,
    operation: StoredOperation,
  ): Model<Elements> {
    try {
      return this.copy({...overrides, geometry}, operation);
    } catch (error) {
      geometry.value.shape.delete();
      throw error;
    }
  }

  private copy(
    overrides: Partial<ModelObjectInit>,
    operation: StoredOperation,
  ): Model<Elements> {
    return new ModelObject<Elements>({
      kind: this.kind,
      geometry: this.geometry,
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
    }) as Model<Elements>;
  }
}

/**
 * @code3d.param width {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param height {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param depth {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function box(
  width: number,
  height: number,
  depth: number,
): Model<CanonicalElements> {
  assertPositive('width', width);
  assertPositive('height', height);
  assertPositive('depth', depth);
  return new ModelObject<CanonicalElements>({
    kind: 'solid',
    name: 'Box',
    geometry: evaluateSolidGeometry('box', [width, height, depth], [], () => ({
      shape: makeBox(
        [-width / 2, -height / 2, -depth / 2],
        [width / 2, height / 2, depth / 2],
      ),
    })),
    operation: storedOperation('box'),
  }) as Model<CanonicalElements>;
}

/**
 * @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param height {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function cylinder(
  radius: number,
  height: number,
): Model<CanonicalElements> {
  assertPositive('radius', radius);
  assertPositive('height', height);
  return new ModelObject<CanonicalElements>({
    kind: 'solid',
    name: 'Cylinder',
    geometry: evaluateSolidGeometry('cylinder', [radius, height], [], () => ({
      shape: makeCylinder(radius, height, [0, -height / 2, 0], [0, 1, 0]),
    })),
    operation: storedOperation('cylinder'),
  }) as Model<CanonicalElements>;
}

/** @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}} */
export function sphere(radius: number): Model<CanonicalElements> {
  assertPositive('radius', radius);
  return new ModelObject<CanonicalElements>({
    kind: 'solid',
    name: 'Sphere',
    geometry: evaluateSolidGeometry('sphere', [radius], [], () => ({
      shape: makeSphere(radius),
    })),
    operation: storedOperation('sphere'),
  }) as Model<CanonicalElements>;
}

/**
 * @code3d.param bottomRadius {kind: 'length', label: 'Bottom radius', constraints: {exclusiveMin: 0}}
 * @code3d.param topRadius {kind: 'length', label: 'Top radius', constraints: {exclusiveMin: 0}}
 * @code3d.param height {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function frustum(
  bottomRadius: number,
  topRadius: number,
  height: number,
): Model<CanonicalElements> {
  assertPositive('bottomRadius', bottomRadius);
  assertPositive('topRadius', topRadius);
  assertPositive('height', height);
  return new ModelObject<CanonicalElements>({
    kind: 'solid',
    name: 'Frustum',
    geometry: evaluateSolidGeometry(
      'frustum',
      [bottomRadius, topRadius, height],
      [],
      () => {
        const bottom = sketchCircle(bottomRadius, {
          plane: 'XZ',
          origin: [0, -height / 2, 0],
        });
        const top = sketchCircle(topRadius, {
          plane: 'XZ',
          origin: [0, height / 2, 0],
        });
        return {shape: bottom.loftWith(top, {ruled: true})};
      },
    ),
    operation: storedOperation('frustum'),
  }) as Model<CanonicalElements>;
}

/**
 * @code3d.param radius {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param height {kind: 'length', constraints: {exclusiveMin: 0}}
 * @code3d.param sides {kind: 'count', constraints: {min: 3}}
 * @code3d.param rotation {kind: 'angle'}
 */
export function regularPrism(
  radius: number,
  height: number,
  sides: number,
  rotation = 0,
): Model<CanonicalElements> {
  assertPositive('radius', radius);
  assertPositive('height', height);
  if (!Number.isInteger(sides) || sides < 3) {
    throw new Error('sides must be an integer greater than or equal to 3.');
  }
  if (!Number.isFinite(rotation)) {
    throw new Error('rotation must be a finite number.');
  }
  return new ModelObject<CanonicalElements>({
    kind: 'solid',
    name: `${sides}-sided prism`,
    geometry: evaluateSolidGeometry(
      'regular-prism',
      [radius, height, sides, rotation],
      [],
      () => {
        const sketch = sketchPolysides(radius, sides, 0, {
          plane: 'XZ',
          origin: [0, -height / 2, 0],
        });
        let shape = sketch.extrude(height, {
          extrusionDirection: [0, 1, 0],
        });
        if (rotation !== 0) {
          shape = shape.rotate(rotation, [0, 0, 0], [0, 1, 0]);
        }
        return {shape};
      },
    ),
    operation: storedOperation('regularPrism'),
  }) as Model<CanonicalElements>;
}

export type HelicalThreadOptions = Readonly<{
  pitch: number;
  height: number;
  majorDiameter: number;
  minorDiameter: number;
  rootWidth: number;
  crestWidth: number;
  leftHanded?: boolean;
}>;

export function helicalThread(
  options: HelicalThreadOptions,
): Model<CanonicalElements> {
  const {
    pitch,
    height,
    majorDiameter,
    minorDiameter,
    rootWidth,
    crestWidth,
    leftHanded = false,
  } = options;
  assertPositive('pitch', pitch);
  assertPositive('height', height);
  assertPositive('majorDiameter', majorDiameter);
  assertPositive('minorDiameter', minorDiameter);
  assertPositive('rootWidth', rootWidth);
  assertPositive('crestWidth', crestWidth);
  if (height < pitch) {
    throw new Error('height must be at least one thread pitch.');
  }
  if (minorDiameter >= majorDiameter) {
    throw new Error('minorDiameter must be smaller than majorDiameter.');
  }
  if (crestWidth >= rootWidth || rootWidth > pitch) {
    throw new Error(
      'The thread profile requires crestWidth < rootWidth <= pitch.',
    );
  }
  return new ModelObject<CanonicalElements>({
    kind: 'solid',
    name: 'Helical thread',
    geometry: evaluateSolidGeometry(
      'helical-thread',
      [
        pitch,
        height,
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
          height,
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
  }) as Model<CanonicalElements>;
}

export function group(children: readonly ModelObject[], name = 'Group'): Model {
  assertChildren(children);
  return new ModelObject({
    kind: 'group',
    name,
    children,
    operation: storedOperation(
      'group',
      children.map((model, index) => ({model, role: 'child', index})),
    ),
  });
}

export function union(
  operands: readonly ModelObject[],
): Model<CanonicalElements> {
  const {first, others} = booleanOperands('union', operands);
  return first[combineModels]('fuse', others);
}

export function cut(
  stock: ModelObject,
  tools: readonly ModelObject[],
): Model<CanonicalElements> {
  if (!isModelObject(stock)) {
    throw new Error('The cut stock must be a ModelObject.');
  }
  if (tools.length === 0) {
    throw new Error('cut requires at least one tool.');
  }
  for (const tool of tools) {
    if (!isModelObject(tool)) {
      throw new Error('Every cut tool must be a ModelObject.');
    }
  }
  return stock[combineModels]('cut', tools);
}

export function intersect(
  operands: readonly ModelObject[],
): Model<CanonicalElements> {
  const {first, others} = booleanOperands('intersect', operands);
  return first[combineModels]('intersect', others);
}

export function isModelObject(value: unknown): value is ModelObject {
  return value instanceof ModelObject;
}

export function isConstraint(value: unknown): value is Constraint {
  return value instanceof Constraint;
}

export function disposeModelObjects(objects: Iterable<ModelObject>): void {
  const disposed = new Set<AnyShape>();
  for (const object of objects) {
    object.disposeShape(disposed);
  }
}

export const authoringApi = Object.freeze({
  ModelObject,
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

const solidGeometryLifecycle: KernelValueLifecycle<SolidGeometryValue> = {
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

function evaluateSolidGeometry(
  operation: string,
  arguments_: readonly KernelKeyPart[],
  inputs: readonly KernelArtifact<unknown>[],
  compute: () => Readonly<{
    shape: Shape3D;
    edgeTopology?: EdgeTopology;
  }>,
): SolidGeometry {
  return evaluateKernelOperation(
    operation,
    arguments_,
    inputs,
    solidGeometryLifecycle,
    () => {
      const result = compute();
      try {
        return {
          shape: result.shape,
          edgeTopology:
            result.edgeTopology ?? initialEdgeTopology(result.shape),
          localBounds: shapeBounds(result.shape),
        };
      } catch (error) {
        result.shape.delete();
        throw error;
      }
    },
  );
}

function renderMesh(
  artifact: KernelArtifact<unknown>,
  shape: AnyShape,
  cache: Map<AnyShape, RenderMesh>,
  tolerance: number,
  edgeTopology?: EdgeTopology,
): RenderMesh {
  const cached = cache.get(shape);
  if (cached) {
    return cached;
  }
  const mesh = evaluateKernelOperation(
    'render-mesh',
    [tolerance, 0.2, edgeTopology !== undefined],
    [artifact],
    renderMeshLifecycle,
    () => {
      const surface = shape.mesh({tolerance, angularTolerance: 0.2});
      const wire = shape.meshEdges({tolerance, angularTolerance: 0.2});
      return {
        vertices: new Float32Array(surface.vertices),
        normals: new Float32Array(surface.normals),
        triangles: new Uint32Array(surface.triangles),
        edges: new Float32Array(wire.lines),
        faceGroups: surface.faceGroups,
        edgeGroups: edgeTopology
          ? stableEdgeGroups(shape.asShape3D(), edgeTopology, wire.edgeGroups)
          : wire.edgeGroups,
      };
    },
  ).value;
  cache.set(shape, mesh);
  return mesh;
}

function shapeBounds(shape: Shape3D): LocalBounds {
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
      {
        ...element,
        transform: {
          ...element.transform,
          position: [
            element.transform.position[0] * factor,
            element.transform.position[1] * factor,
            element.transform.position[2] * factor,
          ],
        },
      },
    ]),
  );
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
    return {
      model: anchor,
      name: 'origin',
      kind: 'frame',
      transform: identityRigidTransform,
    };
  }
  return (anchor as ModelAnchor).reference;
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

function shapeWithTransform(
  source: Shape3D,
  transform: RigidTransform,
): Shape3D {
  let shape = source.clone();
  const {axis, angleDegrees} = quaternionAxisAngle(transform.quaternion);
  if (Math.abs(angleDegrees) > 1e-9) {
    shape = shape.rotate(angleDegrees, toPoint(origin), toPoint(axis));
  }
  shape = shape.translate(toPoint(transform.position));
  return shape;
}

function assertChildren(children: readonly ModelObject[]): void {
  for (const child of children) {
    if (!isModelObject(child)) {
      throw new Error('Every group child must be a ModelObject.');
    }
  }
}

function booleanOperands(
  operation: 'union' | 'intersect',
  operands: readonly ModelObject[],
): Readonly<{first: ModelObject; others: readonly ModelObject[]}> {
  if (operands.length < 2) {
    throw new Error(`${operation} requires at least two model operands.`);
  }
  for (const operand of operands) {
    if (!isModelObject(operand)) {
      throw new Error(`Every ${operation} operand must be a ModelObject.`);
    }
  }
  return {first: operands[0], others: operands.slice(1)};
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
