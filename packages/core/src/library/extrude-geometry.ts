import {
  assembleWire,
  getOC,
  makeHelix,
  makeLine,
  measureVolume,
  Vector,
  type Face,
  type Shape3D,
} from 'replicad';
import {castOwnedShape3D, shapeSubshapes} from './kernel-shapes.js';
import {
  transferShapeTopology,
  type TopologyInput,
  type ShapeTopology,
} from './topology.js';
import type {Vec3} from './spatial.js';

export function extrudeWithTopology(
  source: TopologyInput,
  direction: Vec3,
): {shape: Shape3D; topology: ShapeTopology} {
  const oc = getOC();
  const vector = new Vector([...direction]);
  let shape: Shape3D | undefined;
  try {
    const builder = new oc.BRepPrimAPI_MakePrism(
      source.shape.wrapped,
      vector.wrapped,
      false,
      true,
    );
    try {
      if (!builder.IsDone())
        throw new Error('Could not extrude the face into a solid.');
      shape = castOwnedShape3D(builder.Shape());
      return {shape, topology: transferShapeTopology([source], shape, builder)};
    } finally {
      builder.delete();
    }
  } catch (error) {
    shape?.delete();
    throw error;
  } finally {
    vector.delete();
  }
}

/** Sweep a face around a directed axis, optionally advancing along it. */
export function revolveWithTopology(
  source: TopologyInput,
  center: Vec3,
  direction: Vec3,
  angle: number,
  advance: number,
): {shape: Shape3D; topology?: ShapeTopology} {
  const oc = getOC();
  if (advance === 0) {
    const point = new oc.gp_Pnt(...center);
    let dir: InstanceType<typeof oc.gp_Dir> | undefined;
    let axis: InstanceType<typeof oc.gp_Ax1> | undefined;
    let shape: Shape3D | undefined;
    try {
      dir = new oc.gp_Dir(...direction);
      axis = new oc.gp_Ax1(point, dir);
      const builder = new oc.BRepPrimAPI_MakeRevol(
        source.shape.wrapped,
        axis,
        angle * (Math.PI / 180),
        false,
      );
      try {
        if (!builder.IsDone()) throw new Error('Could not revolve the face.');
        shape = castOwnedShape3D(builder.Shape());
        requireRevolvedVolume(shape);
        return {
          shape,
          topology: transferShapeTopology([source], shape, builder),
        };
      } finally {
        builder.delete();
      }
    } catch (error) {
      shape?.delete();
      throw error;
    } finally {
      axis?.delete();
      dir?.delete();
      point.delete();
    }
  }

  const boundaries = shapeSubshapes(source.shape, 'wire');
  try {
    if (boundaries.length !== 1)
      throw new Error('Helical revolution requires a face without holes.');
  } finally {
    boundaries.forEach(boundary => boundary.delete());
  }
  const end: Vec3 = [
    center[0] + direction[0] * advance,
    center[1] + direction[1] * advance,
    center[2] + direction[2] * advance,
  ];
  let startVector: Vector | undefined;
  let endVector: Vector | undefined;
  let line: ReturnType<typeof makeLine> | undefined;
  let spine: ReturnType<typeof assembleWire> | undefined;
  let guide: ReturnType<typeof makeHelix> | undefined;
  let wire: ReturnType<Face['outerWire']> | undefined;
  let shape: Shape3D | undefined;
  try {
    startVector = new Vector([...center]);
    endVector = new Vector([...end]);
    line = makeLine(startVector, endVector);
    spine = assembleWire([line]);
    guide = makeHelix(
      (advance * 360) / angle,
      advance,
      1,
      [...center],
      [...direction],
    );
    // Replicad's outerWire consumes its cloned Face wrapper.
    wire = (source.shape as Face).clone().outerWire();
    const builder = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
    try {
      builder.SetMode(
        guide.wrapped,
        false,
        oc.BRepFill_TypeOfContact.BRepFill_NoContact,
      );
      builder.Add(wire.wrapped, false, false);
      if (!builder.IsReady())
        throw new Error(
          'Could not associate the profile with the rotation axis.',
        );
      builder.Build();
      if (!builder.IsDone() || !builder.MakeSolid())
        throw new Error('Could not construct a solid helical revolution.');
      shape = castOwnedShape3D(builder.Shape());
      requireRevolvedVolume(shape);
      // PipeShell does not expose face-cap history for an input face. Assign
      // stable output IDs without guessing an inherited input correspondence.
      return {shape};
    } finally {
      builder.delete();
    }
  } catch (error) {
    shape?.delete();
    throw error;
  } finally {
    wire?.delete();
    guide?.delete();
    spine?.delete();
    line?.delete();
    endVector?.delete();
    startVector?.delete();
  }
}

function requireRevolvedVolume(shape: Shape3D): void {
  if (!(Math.abs(measureVolume(shape)) > 0))
    throw new Error('Revolution did not produce a non-degenerate solid.');
}
