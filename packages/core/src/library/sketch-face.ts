import {
  getOC,
  makeCircle,
  makeLine,
  makeThreePointArc,
  type Edge,
  type Face,
  type Wire,
} from 'replicad';
import {castOwnedShape} from './kernel-shapes.js';
import {sketchCurvePosition, type SketchCurve} from './sketch-curves.js';
import type {SketchPosition} from './sketch.js';
import type {SketchRegion} from './sketch-regions.js';

/** A right-handed horizontal sketch plane: (x, y) -> (x, 0, -y), normal +Y. */
type KernelPoint = [number, number, number];
const position = (p: SketchPosition): KernelPoint => [p[0], 0, -p[1]];

function boundaryEdge(curve: SketchCurve): Edge {
  if (curve.kind === 'line')
    return makeLine(position(curve.points[0]), position(curve.points[1]));
  if (curve.kind === 'circle' || Math.abs(curve.sweep) === 2 * Math.PI)
    return makeCircle(curve.radius, position(curve.center), [
      0,
      curve.kind === 'circle' || curve.sweep > 0 ? 1 : -1,
      0,
    ]);
  return makeThreePointArc(
    ...([0, 0.5, 1].map(t => position(sketchCurvePosition(curve, t))) as [
      KernelPoint,
      KernelPoint,
      KernelPoint,
    ]),
  );
}

function boundaryWire(curves: readonly SketchCurve[]): Wire {
  const oc = getOC();
  const builder = new oc.BRepBuilderAPI_MakeWire();
  const edges: Edge[] = [];
  try {
    for (const curve of curves) {
      const edge = boundaryEdge(curve);
      edges.push(edge);
      builder.Add(edge.wrapped);
    }
    if (!builder.IsDone())
      throw new Error('Could not connect the sketch contour into a wire.');
    return castOwnedShape(builder.Wire()) as Wire;
  } finally {
    builder.delete();
    edges.forEach(edge => edge.delete());
  }
}

export function sketchRegionFace(region: SketchRegion): Face {
  const oc = getOC();
  const wires: Wire[] = [];
  try {
    for (const curves of [region.outer, ...region.holes])
      wires.push(boundaryWire(curves));
    const builder = new oc.BRepBuilderAPI_MakeFace(wires[0].wrapped, true);
    try {
      for (const hole of wires.slice(1)) builder.Add(hole.wrapped);
      if (!builder.IsDone())
        throw new Error('Could not create a planar sketch face.');
      const face = castOwnedShape(builder.Face()) as Face;
      try {
        const analyzer = new oc.BRepCheck_Analyzer(face.wrapped, true, false);
        try {
          if (!analyzer.IsValid())
            throw new Error(
              'The sketch contours do not form a valid planar face.',
            );
        } finally {
          analyzer.delete();
        }
        return face;
      } catch (error) {
        face.delete();
        throw error;
      }
    } finally {
      builder.delete();
    }
  } finally {
    wires.forEach(wire => wire.delete());
  }
}
