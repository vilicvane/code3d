import {
  cast,
  getOC,
  type AnyShape,
  type Edge,
  type Face,
  type Shape3D,
  type Vertex,
} from 'replicad';
import type {
  NCollection_List_TopoDS_Shape,
  TopoDS_Shape,
} from 'replicad-opencascadejs';

export function centeredBoxShape(x: number, y: number, z: number): Shape3D {
  const oc = getOC();
  const corner = new oc.gp_Pnt(-x / 2, -y / 2, -z / 2);
  try {
    const builder = new oc.BRepPrimAPI_MakeBox(corner, x, y, z);
    try {
      return castOwnedShape3D(builder.Shape());
    } finally {
      builder.delete();
    }
  } finally {
    corner.delete();
  }
}

/** Consumes a raw handle; Replicad's cast creates a separate native handle. */
export function castOwnedShape(shape: TopoDS_Shape): AnyShape {
  try {
    return cast(shape);
  } finally {
    shape.delete();
  }
}

export function castOwnedShape3D(shape: TopoDS_Shape): Shape3D {
  const result = castOwnedShape(shape);
  try {
    return result.asShape3D();
  } catch (error) {
    result.delete();
    throw error;
  }
}

type Subshapes = {vertex: Vertex; edge: Edge; face: Face};

/** Returns owned, distinct subshapes in kernel traversal order. */
export function shapeSubshapes<Kind extends keyof Subshapes>(
  shape: AnyShape,
  kind: Kind,
): Subshapes[Kind][] {
  const oc = getOC();
  const kinds = {
    vertex: oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    edge: oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    face: oc.TopAbs_ShapeEnum.TopAbs_FACE,
  };
  const explorer = new oc.TopExp_Explorer(
    shape.wrapped,
    kinds[kind],
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  const values: Subshapes[Kind][] = [];
  try {
    while (explorer.More()) {
      const raw = explorer.Current();
      try {
        if (!values.some(value => value.wrapped.IsSame(raw))) {
          values.push(cast(raw) as Subshapes[Kind]);
        }
      } finally {
        // Current() owns a handle even for duplicate topology occurrences.
        raw.delete();
      }
      explorer.Next();
    }
    return values;
  } catch (error) {
    values.forEach(value => value.delete());
    throw error;
  } finally {
    explorer.delete();
  }
}

/** Consumes a native list and transfers its owned element handles to the caller. */
export function consumeShapeList(
  list: NCollection_List_TopoDS_Shape,
): TopoDS_Shape[] {
  const shapes: TopoDS_Shape[] = [];
  try {
    while (!list.IsEmpty()) {
      shapes.push(list.First());
      list.RemoveFirst();
    }
    return shapes;
  } catch (error) {
    shapes.forEach(shape => shape.delete());
    throw error;
  } finally {
    list.delete();
  }
}
