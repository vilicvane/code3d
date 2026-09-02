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
} from './spatial';
import {makeHelicalThreadShape} from './thread';

export type {Quaternion, Vec3} from './spatial';

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

export type AnchorKind = 'origin' | 'center' | 'top' | 'bottom' | 'axis';

export type ConstraintSnapshot = Readonly<{
  id: string;
  kind: 'on';
  source: Readonly<{nodeId: string; anchor: AnchorKind}>;
  target: Readonly<{nodeId: string; anchor: AnchorKind}>;
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
  | 'named'
  | 'paint'
  | 'scaled'
  | 'fillet'
  | 'chamfer'
  | 'relate'
  | 'group'
  | 'union'
  | 'cut'
  | 'intersect';

export type ModelOperationInputRole =
  'source' | 'receiver' | 'operand' | 'tool' | 'child' | 'reference';

export type ModelOperationRegionSnapshot = Readonly<{
  kind: 'intersection' | 'section';
  inputNodeId: string;
  mesh: RenderMesh;
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
  color: string;
  children: readonly ModelSnapshotObject[];
  transform: Transform;
  constraints: readonly ConstraintSnapshot[];
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
  operation: ModelOperationSnapshot;
  mesh?: RenderMesh;
}>;

type AnchorReference = Readonly<{
  model: ModelObject;
  kind: AnchorKind;
}>;

type StoredConstraint = Readonly<{
  id: string;
  kind: 'on';
  source: AnchorKind;
  target: AnchorReference;
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
  shape: AnyShape;
}>;

type StoredOperation = {
  runtimeId: string;
  kind: ModelOperationKind;
  inputs: StoredOperationInput[];
  regions: StoredOperationRegion[];
  siteId?: string;
  execution?: number;
  order?: number;
  sourceRef?: SourceRef;
};

type BooleanOperation = 'cut' | 'fuse' | 'intersect';

type BooleanEvaluation = Readonly<{
  result: Shape3D;
  regions: readonly StoredOperationRegion[];
}>;

type ModelObjectInit = Readonly<{
  kind: 'solid' | 'group';
  shape?: Shape3D;
  localBounds?: LocalBounds;
  name?: string;
  color?: string;
  children?: readonly ModelObject[];
  constraints?: readonly StoredConstraint[];
  sourceRefs?: readonly SourceRef[];
  parameters?: readonly ParameterUsage[];
  operation: StoredOperation;
  meshTolerance?: number;
  nodeId?: string;
}>;

type LocalBounds = readonly [minimum: Vec3, maximum: Vec3];

type SolveContext = {
  poses: Map<ModelObject, RigidTransform>;
  visiting: Set<ModelObject>;
};

const unitScale: Vec3 = [1, 1, 1];
let nextNodeId = 1;
let nextConstraintId = 1;
let nextOperationId = 1;
const combineModels = Symbol('combineModels');

export interface Anchor {
  on(target: Anchor): Constraint;
}

class ModelAnchor implements Anchor {
  constructor(readonly reference: AnchorReference) {}

  on(target: Anchor): Constraint {
    return new Constraint(this.reference, anchorReference(target));
  }
}

export class Constraint {
  private readonly sourceRefs: SourceRef[];
  private readonly parameters: ParameterUsage[];

  constructor(
    private readonly source: AnchorReference,
    private readonly target: AnchorReference,
    private readonly displacement: Vec3 = origin,
    private readonly constraintId = `constraint-${nextConstraintId++}`,
    sourceRefs: readonly SourceRef[] = [],
    parameters: readonly ParameterUsage[] = [],
  ) {
    this.sourceRefs = [...sourceRefs];
    this.parameters = [...parameters];
  }

  offset(x: number, y: number, z: number): Constraint {
    assertFiniteVector('offset', [x, y, z]);
    return new Constraint(
      this.source,
      this.target,
      addVectors(this.displacement, [x, y, z]),
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

  storeFor(model: ModelObject): StoredConstraint {
    if (this.source.model !== model) {
      throw new Error(
        'The constraint returned by relate() must originate from the model copy passed to its callback.',
      );
    }
    return {
      id: this.constraintId,
      kind: 'on',
      source: this.source.kind,
      target: this.target,
      offset: this.displacement,
      sourceRefs: [...this.sourceRefs],
      parameters: [...this.parameters],
    };
  }
}

export class ModelObject implements Anchor {
  readonly nodeId: string;
  readonly kind: 'solid' | 'group';
  readonly name: string;
  readonly color: string;
  readonly children: readonly ModelObject[];
  readonly sourceRefs: SourceRef[];
  readonly parameters: ParameterUsage[];
  private readonly shape?: Shape3D;
  private readonly localBounds?: LocalBounds;
  private readonly meshTolerance: number;
  private constraints: StoredConstraint[];
  private readonly operation: StoredOperation;

  constructor(init: ModelObjectInit) {
    if (init.kind === 'solid' && !init.shape) {
      throw new Error(
        'A solid model object must contain an OpenCascade shape.',
      );
    }
    this.nodeId = init.nodeId ?? `node-${nextNodeId++}`;
    this.kind = init.kind;
    this.shape = init.shape;
    this.localBounds =
      init.localBounds ?? (init.shape ? shapeBounds(init.shape) : undefined);
    this.meshTolerance = init.meshTolerance ?? 0.2;
    this.name = init.name ?? (init.kind === 'solid' ? 'Solid' : 'Group');
    this.color = init.color ?? '#c9cec5';
    this.children = init.children ?? [];
    this.constraints = [...(init.constraints ?? [])];
    this.sourceRefs = [...(init.sourceRefs ?? [])];
    this.parameters = [...(init.parameters ?? [])];
    this.operation = init.operation;
  }

  get center(): Anchor {
    return new ModelAnchor({model: this, kind: 'center'});
  }

  get top(): Anchor {
    return new ModelAnchor({model: this, kind: 'top'});
  }

  get bottom(): Anchor {
    return new ModelAnchor({model: this, kind: 'bottom'});
  }

  get axis(): Anchor {
    return new ModelAnchor({model: this, kind: 'axis'});
  }

  on(target: Anchor): Constraint {
    return new Constraint(
      {model: this, kind: 'origin'},
      anchorReference(target),
    );
  }

  relate(
    build: (self: ModelObject) => Constraint | readonly Constraint[],
  ): ModelObject {
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

  named(name: string): ModelObject {
    return this.copy(
      {name},
      storedOperation('named', [{model: this, role: 'source', index: 0}]),
    );
  }

  paint(color: string): ModelObject {
    return this.copy(
      {color},
      storedOperation('paint', [{model: this, role: 'source', index: 0}]),
    );
  }

  scaled(factor: number): ModelObject {
    assertPositive('scale', factor);
    return this.copy(
      {shape: this.requireShape().clone().scale(factor, toPoint(origin))},
      storedOperation('scaled', [{model: this, role: 'source', index: 0}]),
    );
  }

  fillet(radius: number): ModelObject {
    assertPositive('radius', radius);
    return this.copy(
      {shape: this.requireShape().fillet(radius)},
      storedOperation('fillet', [{model: this, role: 'source', index: 0}]),
    );
  }

  chamfer(distance: number): ModelObject {
    assertPositive('distance', distance);
    return this.copy(
      {shape: this.requireShape().chamfer(distance)},
      storedOperation('chamfer', [{model: this, role: 'source', index: 0}]),
    );
  }

  withChildren(children: readonly ModelObject[]): ModelObject {
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

    return {
      ...common,
      children: [],
      mesh: renderMesh(this.requireShape(), meshCache, this.meshTolerance),
    };
  }

  disposeShape(disposed: Set<AnyShape>): void {
    const shapes = [
      ...(this.shape ? [this.shape] : []),
      ...this.operation.regions.map(region => region.shape),
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
  ): ModelObject {
    const evaluation = this.evaluateBoolean(operation, others);
    let transferred = false;
    try {
      const combined = new ModelObject({
        kind: 'solid',
        shape: evaluation.result,
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
          evaluation.regions,
        ),
      });
      transferred = true;
      return combined;
    } finally {
      if (!transferred) {
        evaluation.result.delete();
        evaluation.regions.forEach(region => region.shape.delete());
      }
    }
  }

  private evaluateBoolean(
    operation: BooleanOperation,
    others: readonly ModelObject[],
  ): BooleanEvaluation {
    const solveContext = createSolveContext();
    const targetPose = this.solvePose(solveContext);
    let result: Shape3D = this.requireShape().clone();
    const regions: StoredOperationRegion[] = [];
    let evaluated = false;
    try {
      for (const other of others) {
        const operand = shapeInFrame(
          other.requireShape(),
          other.solvePose(solveContext),
          targetPose,
        );
        const previous = result;
        try {
          if (operation === 'cut' || operation === 'fuse') {
            regions.push({
              kind: 'intersection',
              input: other,
              shape: previous.intersect(operand),
            });
          }
          if (operation === 'fuse') {
            regions.push({
              kind: 'section',
              input: other,
              shape: unionSectionShape(previous, operand),
            });
          }
          result = previous[operation](operand);
        } finally {
          operand.delete();
        }
        previous.delete();
      }
      evaluated = true;
      return {result, regions};
    } finally {
      if (!evaluated) {
        result.delete();
        regions.forEach(region => region.shape.delete());
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
      constraint.target.model.anchorTransform(constraint.target.kind),
      translation(constraint.offset),
      rotation(halfTurnAroundX),
      invertTransform(this.anchorTransform(constraint.source)),
    );
  }

  private constraintSnapshot(
    constraint: StoredConstraint,
    context: SolveContext,
  ): ConstraintSnapshot {
    const targetPose = constraint.target.model.solvePose(context);
    const offsetFrame = composeTransforms(
      targetPose,
      constraint.target.model.anchorTransform(constraint.target.kind),
    );
    return {
      id: constraint.id,
      kind: constraint.kind,
      source: {nodeId: this.nodeId, anchor: constraint.source},
      target: {
        nodeId: constraint.target.model.nodeId,
        anchor: constraint.target.kind,
      },
      offset: constraint.offset,
      offsetFrame: toTransform(offsetFrame),
      sourceRefs: [...constraint.sourceRefs],
      parameters: [...constraint.parameters],
    };
  }

  private anchorTransform(kind: AnchorKind): RigidTransform {
    if (kind === 'origin') {
      return identityRigidTransform;
    }
    this.requireShape();
    const [[minX, minY, minZ], [maxX, maxY, maxZ]] = this.localBounds!;
    const center: Vec3 = [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ];
    if (kind === 'center' || kind === 'axis') {
      return translation(center);
    }
    if (kind === 'top') {
      return translation([center[0], maxY, center[2]]);
    }
    return composeTransforms(
      translation([center[0], minY, center[2]]),
      rotation(halfTurnAroundX),
    );
  }

  private requireShape(): Shape3D {
    if (!this.shape) {
      throw new Error(
        'This operation requires a solid and cannot act on a group.',
      );
    }
    return this.shape;
  }

  private operationSnapshot(
    meshCache: Map<AnyShape, RenderMesh>,
  ): ModelOperationSnapshot {
    const {siteId, execution, kind, order, sourceRef, inputs, regions} =
      this.operation;
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
        mesh: renderMesh(region.shape, meshCache, this.meshTolerance),
      })),
      sourceRef,
    };
  }

  private copy(
    overrides: Partial<ModelObjectInit>,
    operation: StoredOperation,
  ): ModelObject {
    return new ModelObject({
      kind: this.kind,
      shape: this.shape,
      localBounds: overrides.shape ? undefined : this.localBounds,
      name: this.name,
      color: this.color,
      children: this.children,
      constraints: this.constraints,
      sourceRefs: this.sourceRefs,
      parameters: this.parameters,
      meshTolerance: this.meshTolerance,
      operation,
      ...overrides,
    });
  }
}

export function box(width: number, height: number, depth: number): ModelObject {
  assertPositive('width', width);
  assertPositive('height', height);
  assertPositive('depth', depth);
  return new ModelObject({
    kind: 'solid',
    name: 'Box',
    shape: makeBox(
      [-width / 2, -height / 2, -depth / 2],
      [width / 2, height / 2, depth / 2],
    ),
    operation: storedOperation('box'),
  });
}

export function cylinder(radius: number, height: number): ModelObject {
  assertPositive('radius', radius);
  assertPositive('height', height);
  return new ModelObject({
    kind: 'solid',
    name: 'Cylinder',
    shape: makeCylinder(radius, height, [0, -height / 2, 0], [0, 1, 0]),
    operation: storedOperation('cylinder'),
  });
}

export function sphere(radius: number): ModelObject {
  assertPositive('radius', radius);
  return new ModelObject({
    kind: 'solid',
    name: 'Sphere',
    shape: makeSphere(radius),
    operation: storedOperation('sphere'),
  });
}

export function frustum(
  bottomRadius: number,
  topRadius: number,
  height: number,
): ModelObject {
  assertPositive('bottomRadius', bottomRadius);
  assertPositive('topRadius', topRadius);
  assertPositive('height', height);
  const bottom = sketchCircle(bottomRadius, {
    plane: 'XZ',
    origin: [0, -height / 2, 0],
  });
  const top = sketchCircle(topRadius, {
    plane: 'XZ',
    origin: [0, height / 2, 0],
  });
  return new ModelObject({
    kind: 'solid',
    name: 'Frustum',
    shape: bottom.loftWith(top, {ruled: true}),
    operation: storedOperation('frustum'),
  });
}

export function regularPrism(
  radius: number,
  height: number,
  sides: number,
  rotation = 0,
): ModelObject {
  assertPositive('radius', radius);
  assertPositive('height', height);
  if (!Number.isInteger(sides) || sides < 3) {
    throw new Error('sides must be an integer greater than or equal to 3.');
  }
  if (!Number.isFinite(rotation)) {
    throw new Error('rotation must be a finite number.');
  }
  const sketch = sketchPolysides(radius, sides, 0, {
    plane: 'XZ',
    origin: [0, -height / 2, 0],
  });
  let shape = sketch.extrude(height, {extrusionDirection: [0, 1, 0]});
  if (rotation !== 0) {
    shape = shape.rotate(rotation, [0, 0, 0], [0, 1, 0]);
  }
  return new ModelObject({
    kind: 'solid',
    name: `${sides}-sided prism`,
    shape,
    operation: storedOperation('regularPrism'),
  });
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

export function helicalThread(options: HelicalThreadOptions): ModelObject {
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
  return new ModelObject({
    kind: 'solid',
    name: 'Helical thread',
    shape: makeHelicalThreadShape({
      pitch,
      height,
      majorRadius: majorDiameter / 2,
      minorRadius: minorDiameter / 2,
      rootWidth,
      crestWidth,
      leftHanded,
    }),
    meshTolerance: Math.min(0.12, pitch / 8),
    operation: storedOperation('helicalThread'),
  });
}

export function group(
  children: readonly ModelObject[],
  name = 'Group',
): ModelObject {
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
  first: ModelObject,
  ...others: readonly ModelObject[]
): ModelObject {
  return first[combineModels]('fuse', others);
}

export function cut(
  stock: ModelObject,
  ...tools: readonly ModelObject[]
): ModelObject {
  return stock[combineModels]('cut', tools);
}

export function intersect(
  first: ModelObject,
  ...others: readonly ModelObject[]
): ModelObject {
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
  regions: readonly StoredOperationRegion[] = [],
): StoredOperation {
  return {
    runtimeId: `operation-${nextOperationId++}`,
    kind,
    inputs: [...inputs],
    regions: [...regions],
  };
}

function storedOperationId(operation: StoredOperation): string {
  return operation.siteId !== undefined && operation.execution !== undefined
    ? `${operation.siteId}:execution:${operation.execution}`
    : operation.runtimeId;
}

function renderMesh(
  shape: AnyShape,
  cache: Map<AnyShape, RenderMesh>,
  tolerance: number,
): RenderMesh {
  const cached = cache.get(shape);
  if (cached) {
    return cached;
  }
  const surface = shape.mesh({tolerance, angularTolerance: 0.2});
  const wire = shape.meshEdges({tolerance, angularTolerance: 0.2});
  const mesh = {
    vertices: new Float32Array(surface.vertices),
    normals: new Float32Array(surface.normals),
    triangles: new Uint32Array(surface.triangles),
    edges: new Float32Array(wire.lines),
    faceGroups: surface.faceGroups,
    edgeGroups: wire.edgeGroups,
  };
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
    return {model: anchor, kind: 'origin'};
  }
  return (anchor as ModelAnchor).reference;
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

function shapeInFrame(
  source: Shape3D,
  sourceFrame: RigidTransform,
  targetFrame: RigidTransform,
): Shape3D {
  const transform = relativeTransform(sourceFrame, targetFrame);
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

export const authoringTypes = `
declare module "code3d" {
  export type Vec3 = readonly [x: number, y: number, z: number];

  export interface Anchor {
    on(target: Anchor): Constraint;
  }

  export class Constraint {
    private constructor();
    offset(x: number, y: number, z: number): Constraint;
  }

  export class ModelObject implements Anchor {
    private constructor();
    readonly nodeId: string;
    readonly name: string;
    readonly kind: "solid" | "group";
    readonly center: Anchor;
    readonly top: Anchor;
    readonly bottom: Anchor;
    readonly axis: Anchor;
    on(target: Anchor): Constraint;
    relate(build: (self: ModelObject) => Constraint | readonly Constraint[]): ModelObject;
    named(name: string): ModelObject;
    paint(color: string): ModelObject;
    scaled(factor: number): ModelObject;
    fillet(radius: number): ModelObject;
    chamfer(distance: number): ModelObject;
    withChildren(children: readonly ModelObject[]): ModelObject;
  }

  export function box(width: number, height: number, depth: number): ModelObject;
  export function cylinder(radius: number, height: number): ModelObject;
  export function sphere(radius: number): ModelObject;
  export function frustum(bottomRadius: number, topRadius: number, height: number): ModelObject;
  export function regularPrism(radius: number, height: number, sides: number, rotation?: number): ModelObject;
  export type HelicalThreadOptions = Readonly<{
    pitch: number;
    height: number;
    majorDiameter: number;
    minorDiameter: number;
    rootWidth: number;
    crestWidth: number;
    leftHanded?: boolean;
  }>;
  export function helicalThread(options: HelicalThreadOptions): ModelObject;
  export function group(children: readonly ModelObject[], name?: string): ModelObject;
  export function union(first: ModelObject, ...others: readonly ModelObject[]): ModelObject;
  export function cut(stock: ModelObject, ...tools: readonly ModelObject[]): ModelObject;
  export function intersect(first: ModelObject, ...others: readonly ModelObject[]): ModelObject;
}
`;
