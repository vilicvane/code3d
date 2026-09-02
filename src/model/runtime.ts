import {
  makeBox,
  makeCylinder,
  makeSphere,
  type Shape3D,
} from "replicad";

export type Vec3 = readonly [x: number, y: number, z: number];

export type SourceRef = Readonly<{
  start: number;
  end: number;
}>;

export type Transform = Readonly<{
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
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
  kind: "solid" | "group";
  name: string;
  color: string;
  children: readonly ModelSnapshotObject[];
  transform: Transform;
  sourceRefs: readonly SourceRef[];
  mesh?: RenderMesh;
}>;

type ModelObjectInit = Readonly<{
  kind: "solid" | "group";
  shape?: Shape3D;
  name?: string;
  color?: string;
  children?: readonly ModelObject[];
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  sourceRefs?: readonly SourceRef[];
  nodeId?: string;
}>;

const origin: Vec3 = [0, 0, 0];
const unitScale: Vec3 = [1, 1, 1];
const identityTransform: Transform = {
  position: origin,
  rotation: origin,
  scale: unitScale,
};
let nextNodeId = 1;

export class ModelObject {
  readonly nodeId: string;
  readonly kind: "solid" | "group";
  readonly name: string;
  readonly color: string;
  readonly children: readonly ModelObject[];
  readonly sourceRefs: SourceRef[];
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
  private readonly shape?: Shape3D;

  constructor(init: ModelObjectInit) {
    if (init.kind === "solid" && !init.shape) {
      throw new Error("solid 模型对象必须包含 OpenCascade shape。");
    }
    this.nodeId = init.nodeId ?? `node-${nextNodeId++}`;
    this.kind = init.kind;
    this.shape = init.shape;
    this.name = init.name ?? (init.kind === "solid" ? "Solid" : "Group");
    this.color = init.color ?? "#d6ff45";
    this.children = init.children ?? [];
    this.position = init.position ?? origin;
    this.rotation = init.rotation ?? origin;
    this.scale = init.scale ?? unitScale;
    this.sourceRefs = [...(init.sourceRefs ?? [])];
  }

  named(name: string): ModelObject {
    return this.copy({ name });
  }

  paint(color: string): ModelObject {
    return this.copy({ color });
  }

  at(x: number, y: number, z: number): ModelObject {
    return this.move(
      x - this.position[0],
      y - this.position[1],
      z - this.position[2],
    );
  }

  move(x: number, y: number, z: number): ModelObject {
    const nextPosition: Vec3 = [
      this.position[0] + x,
      this.position[1] + y,
      this.position[2] + z,
    ];
    if (this.kind === "group") {
      return this.copy({
        children: this.children.map((child) => child.move(x, y, z)),
        position: nextPosition,
      });
    }
    return this.copy({
      shape: this.requireShape().clone().translate(x, y, z),
      position: nextPosition,
    });
  }

  rotate(x: number, y: number, z: number): ModelObject {
    const nextRotation: Vec3 = [
      this.rotation[0] + x,
      this.rotation[1] + y,
      this.rotation[2] + z,
    ];
    if (this.kind === "group") {
      return this.copy({
        children: this.children.map((child) =>
          child.rotateAround(this.position, x, y, z),
        ),
        rotation: nextRotation,
      });
    }
    return this.copy({
      shape: rotateShape(this.requireShape(), this.position, x, y, z),
      rotation: nextRotation,
    });
  }

  scaled(factor: number): ModelObject {
    assertPositive("scale", factor);
    const nextScale: Vec3 = [
      this.scale[0] * factor,
      this.scale[1] * factor,
      this.scale[2] * factor,
    ];
    if (this.kind === "group") {
      return this.copy({
        children: this.children.map((child) =>
          child.scaleAround(this.position, factor),
        ),
        scale: nextScale,
      });
    }
    return this.copy({
      shape: this.requireShape().clone().scale(factor, toPoint(this.position)),
      scale: nextScale,
    });
  }

  cut(tool: ModelObject): ModelObject {
    return this.booleanResult("cut", tool);
  }

  fuse(other: ModelObject): ModelObject {
    return this.booleanResult("fuse", other);
  }

  intersect(other: ModelObject): ModelObject {
    return this.booleanResult("intersect", other);
  }

  fillet(radius: number): ModelObject {
    assertPositive("radius", radius);
    return this.copy({
      shape: this.requireShape().fillet(radius),
      position: origin,
      rotation: origin,
      scale: unitScale,
    });
  }

  chamfer(distance: number): ModelObject {
    assertPositive("distance", distance);
    return this.copy({
      shape: this.requireShape().chamfer(distance),
      position: origin,
      rotation: origin,
      scale: unitScale,
    });
  }

  withChildren(children: readonly ModelObject[]): ModelObject {
    if (this.kind !== "group") {
      throw new Error("只有 group 或 model 可以包含子对象。");
    }
    assertChildren(children);
    return this.copy({ children });
  }

  /** Runtime instrumentation hook. Not part of the authoring API. */
  attachSource(sourceRef: SourceRef): void {
    const previous = this.sourceRefs.at(-1);
    if (previous?.start === sourceRef.start && previous.end === sourceRef.end) {
      return;
    }
    this.sourceRefs.push(sourceRef);
  }

  toSnapshot(): ModelSnapshotObject {
    if (this.kind === "group") {
      return {
        nodeId: this.nodeId,
        kind: this.kind,
        name: this.name,
        color: this.color,
        children: this.children.map((child) => child.toSnapshot()),
        transform: identityTransform,
        sourceRefs: [...this.sourceRefs],
      };
    }

    const shape = this.requireShape();
    const surface = shape.mesh({ tolerance: 0.2, angularTolerance: 0.25 });
    const wire = shape.meshEdges({ tolerance: 0.2, angularTolerance: 0.25 });
    return {
      nodeId: this.nodeId,
      kind: this.kind,
      name: this.name,
      color: this.color,
      children: [],
      transform: identityTransform,
      sourceRefs: [...this.sourceRefs],
      mesh: {
        vertices: new Float32Array(surface.vertices),
        normals: new Float32Array(surface.normals),
        triangles: new Uint32Array(surface.triangles),
        edges: new Float32Array(wire.lines),
        faceGroups: surface.faceGroups,
        edgeGroups: wire.edgeGroups,
      },
    };
  }

  disposeShape(disposed: Set<Shape3D>): void {
    if (this.shape && !disposed.has(this.shape)) {
      disposed.add(this.shape);
      this.shape.delete();
    }
    this.children.forEach((child) => child.disposeShape(disposed));
  }

  private booleanResult(
    operation: "cut" | "fuse" | "intersect",
    other: ModelObject,
  ): ModelObject {
    const left = this.requireShape();
    const right = other.requireShape();
    const shape = left[operation](right);
    return new ModelObject({
      kind: "solid",
      shape,
      name: this.name,
      color: this.color,
      sourceRefs: this.sourceRefs,
    });
  }

  private rotateAround(center: Vec3, x: number, y: number, z: number): ModelObject {
    if (this.kind === "group") {
      return this.copy({
        children: this.children.map((child) => child.rotateAround(center, x, y, z)),
        position: rotatePoint(this.position, center, x, y, z),
      });
    }
    return this.copy({
      shape: rotateShape(this.requireShape(), center, x, y, z),
      position: rotatePoint(this.position, center, x, y, z),
    });
  }

  private scaleAround(center: Vec3, factor: number): ModelObject {
    if (this.kind === "group") {
      return this.copy({
        children: this.children.map((child) => child.scaleAround(center, factor)),
        position: scalePoint(this.position, center, factor),
      });
    }
    return this.copy({
      shape: this.requireShape().clone().scale(factor, toPoint(center)),
      position: scalePoint(this.position, center, factor),
    });
  }

  private requireShape(): Shape3D {
    if (!this.shape) {
      throw new Error("该操作需要 solid，不能直接作用于 group。");
    }
    return this.shape;
  }

  private copy(overrides: Partial<ModelObjectInit>): ModelObject {
    return new ModelObject({
      kind: this.kind,
      shape: this.shape,
      name: this.name,
      color: this.color,
      children: this.children,
      position: this.position,
      rotation: this.rotation,
      scale: this.scale,
      sourceRefs: this.sourceRefs,
      ...overrides,
    });
  }
}

export function box(width: number, height: number, depth: number): ModelObject {
  assertPositive("width", width);
  assertPositive("height", height);
  assertPositive("depth", depth);
  return new ModelObject({
    kind: "solid",
    name: "Box",
    shape: makeBox(
      [-width / 2, -height / 2, -depth / 2],
      [width / 2, height / 2, depth / 2],
    ),
  });
}

export function cylinder(radius: number, height: number): ModelObject {
  assertPositive("radius", radius);
  assertPositive("height", height);
  return new ModelObject({
    kind: "solid",
    name: "Cylinder",
    shape: makeCylinder(radius, height, [0, -height / 2, 0], [0, 1, 0]),
  });
}

export function sphere(radius: number): ModelObject {
  assertPositive("radius", radius);
  return new ModelObject({
    kind: "solid",
    name: "Sphere",
    shape: makeSphere(radius),
  });
}

export function group(
  children: readonly ModelObject[],
  name = "Group",
): ModelObject {
  assertChildren(children);
  return new ModelObject({
    kind: "group",
    name,
    children,
  });
}

export function model(
  name: string,
  children: ModelObject | readonly ModelObject[],
): ModelObject {
  const normalizedChildren = Array.isArray(children) ? children : [children];
  return group(normalizedChildren, name);
}

export function isModelObject(value: unknown): value is ModelObject {
  return value instanceof ModelObject;
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
  model,
});

function assertChildren(children: readonly ModelObject[]): void {
  for (const child of children) {
    if (!isModelObject(child)) {
      throw new Error("group 的 children 必须全部是 ModelObject。");
    }
  }
}

function assertPositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} 必须是大于 0 的有限数值。`);
  }
}

function rotateShape(
  source: Shape3D,
  center: Vec3,
  x: number,
  y: number,
  z: number,
): Shape3D {
  let shape = source.clone();
  if (x) shape = shape.rotate(x, toPoint(center), [1, 0, 0]);
  if (y) shape = shape.rotate(y, toPoint(center), [0, 1, 0]);
  if (z) shape = shape.rotate(z, toPoint(center), [0, 0, 1]);
  return shape;
}

function toPoint(vector: Vec3): [number, number, number] {
  return [vector[0], vector[1], vector[2]];
}

function rotatePoint(point: Vec3, center: Vec3, x: number, y: number, z: number): Vec3 {
  let [px, py, pz] = [
    point[0] - center[0],
    point[1] - center[1],
    point[2] - center[2],
  ];
  for (const [angle, axis] of [
    [x, "x"],
    [y, "y"],
    [z, "z"],
  ] as const) {
    if (!angle) continue;
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    if (axis === "x") [py, pz] = [py * cos - pz * sin, py * sin + pz * cos];
    if (axis === "y") [px, pz] = [px * cos + pz * sin, -px * sin + pz * cos];
    if (axis === "z") [px, py] = [px * cos - py * sin, px * sin + py * cos];
  }
  return [px + center[0], py + center[1], pz + center[2]];
}

function scalePoint(point: Vec3, center: Vec3, factor: number): Vec3 {
  return [
    center[0] + (point[0] - center[0]) * factor,
    center[1] + (point[1] - center[1]) * factor,
    center[2] + (point[2] - center[2]) * factor,
  ];
}

export const authoringTypes = `
declare module "code3d" {
  export type Vec3 = readonly [x: number, y: number, z: number];

  export class ModelObject {
    readonly nodeId: string;
    readonly name: string;
    readonly kind: "solid" | "group";
    named(name: string): ModelObject;
    paint(color: string): ModelObject;
    at(x: number, y: number, z: number): ModelObject;
    move(x: number, y: number, z: number): ModelObject;
    rotate(x: number, y: number, z: number): ModelObject;
    scaled(factor: number): ModelObject;
    cut(tool: ModelObject): ModelObject;
    fuse(other: ModelObject): ModelObject;
    intersect(other: ModelObject): ModelObject;
    fillet(radius: number): ModelObject;
    chamfer(distance: number): ModelObject;
    withChildren(children: readonly ModelObject[]): ModelObject;
  }

  export function box(width: number, height: number, depth: number): ModelObject;
  export function cylinder(radius: number, height: number): ModelObject;
  export function sphere(radius: number): ModelObject;
  export function group(children: readonly ModelObject[], name?: string): ModelObject;
  export function model(name: string, children: ModelObject | readonly ModelObject[]): ModelObject;
}
`;
