import {makeBox, makeCylinder, makeSphere, type Shape3D} from 'replicad';
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

export type {Quaternion, Vec3} from './spatial';

export type SourceRef = Readonly<{
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

type ModelObjectInit = Readonly<{
  kind: 'solid' | 'group';
  shape?: Shape3D;
  name?: string;
  color?: string;
  children?: readonly ModelObject[];
  constraints?: readonly StoredConstraint[];
  sourceRefs?: readonly SourceRef[];
  parameters?: readonly ParameterUsage[];
  nodeId?: string;
}>;

type SolveContext = {
  poses: Map<ModelObject, RigidTransform>;
  visiting: Set<ModelObject>;
};

const unitScale: Vec3 = [1, 1, 1];
let nextNodeId = 1;
let nextConstraintId = 1;
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
    if (previous?.start !== sourceRef.start || previous.end !== sourceRef.end) {
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
        'relate() 返回的 constraint 必须以回调中的模型副本为源。',
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
  private constraints: StoredConstraint[];

  constructor(init: ModelObjectInit) {
    if (init.kind === 'solid' && !init.shape) {
      throw new Error('solid 模型对象必须包含 OpenCascade shape。');
    }
    this.nodeId = init.nodeId ?? `node-${nextNodeId++}`;
    this.kind = init.kind;
    this.shape = init.shape;
    this.name = init.name ?? (init.kind === 'solid' ? 'Solid' : 'Group');
    this.color = init.color ?? '#d6ff45';
    this.children = init.children ?? [];
    this.constraints = [...(init.constraints ?? [])];
    this.sourceRefs = [...(init.sourceRefs ?? [])];
    this.parameters = [...(init.parameters ?? [])];
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
    const related = this.copy();
    const built = build(related);
    const constraints = Array.isArray(built) ? built : [built];
    related.constraints.push(
      ...constraints.map(constraint => constraint.storeFor(related)),
    );
    return related;
  }

  named(name: string): ModelObject {
    return this.copy({name});
  }

  paint(color: string): ModelObject {
    return this.copy({color});
  }

  scaled(factor: number): ModelObject {
    assertPositive('scale', factor);
    return this.copy({
      shape: this.requireShape().clone().scale(factor, toPoint(origin)),
    });
  }

  fillet(radius: number): ModelObject {
    assertPositive('radius', radius);
    return this.copy({shape: this.requireShape().fillet(radius)});
  }

  chamfer(distance: number): ModelObject {
    assertPositive('distance', distance);
    return this.copy({shape: this.requireShape().chamfer(distance)});
  }

  withChildren(children: readonly ModelObject[]): ModelObject {
    if (this.kind !== 'group') {
      throw new Error('只有 group 可以包含子对象。');
    }
    assertChildren(children);
    return this.copy({children});
  }

  /** Runtime instrumentation hook. Not part of the authoring API. */
  attachSource(sourceRef: SourceRef): void {
    const previous = this.sourceRefs.at(-1);
    if (previous?.start !== sourceRef.start || previous.end !== sourceRef.end) {
      this.sourceRefs.push(sourceRef);
    }
  }

  /** Runtime instrumentation hook. Not part of the authoring API. */
  attachParameters(parameters: readonly ParameterUsage[]): void {
    appendUniqueParameters(this.parameters, parameters);
  }

  toSnapshot(
    meshCache: Map<Shape3D, RenderMesh> = new Map(),
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
    } as const;

    if (this.kind === 'group') {
      return {
        ...common,
        children: this.children.map(child =>
          child.toSnapshot(meshCache, solveContext),
        ),
      };
    }

    const shape = this.requireShape();
    let mesh = meshCache.get(shape);
    if (!mesh) {
      const surface = shape.mesh({tolerance: 0.2, angularTolerance: 0.25});
      const wire = shape.meshEdges({tolerance: 0.2, angularTolerance: 0.25});
      mesh = {
        vertices: new Float32Array(surface.vertices),
        normals: new Float32Array(surface.normals),
        triangles: new Uint32Array(surface.triangles),
        edges: new Float32Array(wire.lines),
        faceGroups: surface.faceGroups,
        edgeGroups: wire.edgeGroups,
      };
      meshCache.set(shape, mesh);
    }
    return {...common, children: [], mesh};
  }

  disposeShape(disposed: Set<Shape3D>): void {
    if (this.shape && !disposed.has(this.shape)) {
      disposed.add(this.shape);
      this.shape.delete();
    }
    this.children.forEach(child => child.disposeShape(disposed));
  }

  [combineModels](
    operation: 'cut' | 'fuse' | 'intersect',
    others: readonly ModelObject[],
  ): ModelObject {
    const solveContext = createSolveContext();
    const targetPose = this.solvePose(solveContext);
    let result: Shape3D = this.requireShape().clone();
    let transferred = false;
    try {
      for (const other of others) {
        const operand = shapeInFrame(
          other.requireShape(),
          other.solvePose(solveContext),
          targetPose,
        );
        const previous = result;
        try {
          result = previous[operation](operand);
        } finally {
          operand.delete();
        }
        previous.delete();
      }

      const combined = new ModelObject({
        kind: 'solid',
        shape: result,
        name: this.name,
        color: this.color,
        constraints: this.constraints,
        sourceRefs: [this, ...others].flatMap(model => model.sourceRefs),
        parameters: uniqueParameters(
          [this, ...others].flatMap(model => model.allParameters()),
        ),
      });
      transferred = true;
      return combined;
    } finally {
      if (!transferred) {
        result.delete();
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
      throw new Error(`模型 ${this.name} 的关系形成了循环。`);
    }

    context.visiting.add(this);
    let pose: RigidTransform | undefined;
    for (const constraint of this.constraints) {
      const candidate = this.solveConstraint(constraint, context);
      if (pose && !transformsAreEquivalent(pose, candidate)) {
        throw new Error(`模型 ${this.name} 的 constraints 没有一致的唯一解。`);
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
    const boundingBox = this.requireShape().boundingBox;
    const [[minX, minY, minZ], [maxX, maxY, maxZ]] = boundingBox.bounds;
    boundingBox.delete();
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
      throw new Error('该操作需要 solid，不能直接作用于 group。');
    }
    return this.shape;
  }

  private copy(overrides: Partial<ModelObjectInit> = {}): ModelObject {
    return new ModelObject({
      kind: this.kind,
      shape: this.shape,
      name: this.name,
      color: this.color,
      children: this.children,
      constraints: this.constraints,
      sourceRefs: this.sourceRefs,
      parameters: this.parameters,
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
  });
}

export function cylinder(radius: number, height: number): ModelObject {
  assertPositive('radius', radius);
  assertPositive('height', height);
  return new ModelObject({
    kind: 'solid',
    name: 'Cylinder',
    shape: makeCylinder(radius, height, [0, -height / 2, 0], [0, 1, 0]),
  });
}

export function sphere(radius: number): ModelObject {
  assertPositive('radius', radius);
  return new ModelObject({
    kind: 'solid',
    name: 'Sphere',
    shape: makeSphere(radius),
  });
}

export function group(
  children: readonly ModelObject[],
  name = 'Group',
): ModelObject {
  assertChildren(children);
  return new ModelObject({kind: 'group', name, children});
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
  const disposed = new Set<Shape3D>();
  for (const object of objects) {
    object.disposeShape(disposed);
  }
}

export const authoringApi = Object.freeze({
  ModelObject,
  box,
  cylinder,
  sphere,
  group,
  union,
  cut,
  intersect,
});

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
      throw new Error('group 的 children 必须全部是 ModelObject。');
    }
  }
}

function assertPositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} 必须是大于 0 的有限数值。`);
  }
}

function assertFiniteVector(label: string, value: Vec3): void {
  if (value.some(component => !Number.isFinite(component))) {
    throw new Error(`${label} 必须使用有限数值。`);
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
      candidate.operationRef.start === parameter.operationRef.start &&
      candidate.operationRef.end === parameter.operationRef.end &&
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
  export function group(children: readonly ModelObject[], name?: string): ModelObject;
  export function union(first: ModelObject, ...others: readonly ModelObject[]): ModelObject;
  export function cut(stock: ModelObject, ...tools: readonly ModelObject[]): ModelObject;
  export function intersect(first: ModelObject, ...others: readonly ModelObject[]): ModelObject;
}
`;
