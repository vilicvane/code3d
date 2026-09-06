import {
  cast,
  getOC,
  type AnyShape,
  type Face,
  type Wire,
  type Shape3D,
} from 'replicad';
import type {TopoDS_Shape} from 'replicad-opencascadejs';
import {
  castOwnedShape,
  castOwnedShape3D,
  consumeShapeList,
  shapeSubshapes,
} from './kernel-shapes.js';
import {
  transferShapeTopology,
  type TopologyInput,
  type ShapeTopology,
} from './topology.js';

export function loftWithTopology(
  sections: readonly TopologyInput[],
  spine: Wire | undefined,
  ruled: boolean,
): Readonly<{shape: Shape3D; topology: ShapeTopology}> {
  const oc = getOC();
  const builder = spine
    ? new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped)
    : new oc.BRepOffsetAPI_ThruSections(true, ruled, 1e-6);
  const wires: Wire[] = [];
  let result: Shape3D | undefined;
  const caps: (Face | undefined)[] = [];
  try {
    for (const section of sections)
      wires.push((section.shape as Face).clone().outerWire());
    if (builder instanceof oc.BRepOffsetAPI_MakePipeShell) {
      builder.SetMode(false);
      for (const wire of wires) builder.Add(wire.wrapped, false, false);
      if (!builder.IsReady())
        throw new Error(
          'The loft sections could not be associated with the spine.',
        );
      builder.Build();
      if (!builder.IsDone() || !builder.MakeSolid())
        throw new Error('Could not construct a solid loft along the spine.');
    } else {
      builder.SetMutableInput(false);
      for (const wire of wires) builder.AddWire(wire.wrapped);
      builder.Build();
    }
    result = castOwnedShape3D(builder.Shape());
    caps[0] = castOwnedShape(builder.FirstShape()) as Face;
    caps[sections.length - 1] = castOwnedShape(builder.LastShape()) as Face;
    const topology = transferShapeTopology(
      sections,
      result,
      (input, kind, index) => {
        const cap = caps[index];
        // The builder consumes wires, so the profile faces need explicit cap history.
        if (kind === 'surface')
          return cap ? [copyShapeHandle(cap.wrapped)] : [];
        const modified = consumeShapeList(builder.Modified(input));
        if (!cap && kind === 'vertex') return modified;
        let generated: TopoDS_Shape[] = [];
        let capParts: AnyShape[] = [];
        let source: AnyShape | undefined;
        try {
          generated = consumeShapeList(builder.Generated(input));
          if (cap) capParts = shapeSubshapes(cap, kind);
          else source = cast(input);
          // Sweeps generate side faces from edges and side edges from vertices.
          // Their intersection with this section's cap identifies its descendants,
          // including splits, without relying on traversal or geometric proximity.
          for (const raw of generated) {
            const shape = cast(raw);
            try {
              const parts = shapeSubshapes(shape, kind);
              try {
                for (const part of capParts) {
                  if (parts.some(candidate => candidate.isSame(part)))
                    modified.push(copyShapeHandle(part.wrapped));
                }
                // Ruled lofts can copy intermediate profile edges while
                // retaining their vertices. Generated side faces plus the
                // exact endpoint identities establish the copied edge history.
                if (source)
                  for (const part of parts)
                    if (sameVertices(source, part))
                      modified.push(copyShapeHandle(part.wrapped));
              } finally {
                parts.forEach(part => part.delete());
              }
            } finally {
              shape.delete();
            }
          }
          return modified;
        } catch (error) {
          modified.forEach(shape => shape.delete());
          throw error;
        } finally {
          generated.forEach(shape => shape.delete());
          capParts.forEach(part => part.delete());
          source?.delete();
        }
      },
    );
    return {shape: result, topology};
  } catch (error) {
    result?.delete();
    throw error;
  } finally {
    caps.forEach(cap => cap?.delete());
    wires.forEach(wire => wire.delete());
    builder.delete();
  }
}

function copyShapeHandle(shape: TopoDS_Shape): TopoDS_Shape {
  return shape.Oriented(shape.Orientation());
}

function sameVertices(left: AnyShape, right: AnyShape): boolean {
  const leftVertices = shapeSubshapes(left, 'vertex');
  let rightVertices: AnyShape[] = [];
  try {
    rightVertices = shapeSubshapes(right, 'vertex');
    return (
      leftVertices.length > 0 &&
      leftVertices.length === rightVertices.length &&
      leftVertices.every(vertex =>
        rightVertices.some(candidate => candidate.isSame(vertex)),
      )
    );
  } finally {
    leftVertices.forEach(vertex => vertex.delete());
    rightVertices.forEach(vertex => vertex.delete());
  }
}
