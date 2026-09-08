import {getOC, Vector, type Shape3D} from 'replicad';
import {castOwnedShape3D} from './kernel-shapes.js';
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
