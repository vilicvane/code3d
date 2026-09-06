import {formatTopologyId, TopologyIdSet} from './topology-id.js';
import {getOC, type Shape3D} from 'replicad';
import {castOwnedShape3D, shapeSubshapes} from './kernel-shapes.js';
import {describeOpenCascadeException} from './open-cascade-error.js';
import {
  transferShapeTopology,
  type ShapeTopology,
  type SurfaceId,
} from './topology.js';

const tolerance = 0.001;

export function shellWithTopology(
  shape: Shape3D,
  topology: ShapeTopology,
  thickness: number,
  removedSurfaceIds: readonly SurfaceId[],
): {shape: Shape3D; topology: ShapeTopology} {
  const selection = removedSurfaceIds.length
    ? removedSurfaceIds.map(id => formatTopologyId('surface', id)).join(', ')
    : 'no openings';
  try {
    if (removedSurfaceIds.length === topology.surfaces.ids.length) {
      throw new Error('At least one surface must remain as a wall.');
    }
    const solid = singleSolid(shape);
    try {
      const volume = validVolume(solid);
      return removedSurfaceIds.length
        ? openShell(solid, topology, thickness, removedSurfaceIds, volume)
        : closedShell(solid, topology, thickness, volume);
    } finally {
      solid.delete();
    }
  } catch (error) {
    const detail =
      describeOpenCascadeException(error) ??
      (error instanceof Error ? error.message : String(error));
    throw new Error(
      `Could not construct shell with thickness ${thickness} and ${selection}.\n` +
        `${detail} Try simplifying the geometry or changing the thickness or openings.`,
      {cause: error},
    );
  }
}

function openShell(
  shape: Shape3D,
  topology: ShapeTopology,
  thickness: number,
  removedIds: readonly SurfaceId[],
  sourceVolume: number,
): {shape: Shape3D; topology: ShapeTopology} {
  const oc = getOC();
  const faces = shapeSubshapes(shape, 'face');
  const selected = new TopologyIdSet(removedIds);
  const closingFaces = new oc.NCollection_List_TopoDS_Shape();
  const builder = new oc.BRepOffsetAPI_MakeThickSolid();
  let result: Shape3D | undefined;
  try {
    faces.forEach((face, index) => {
      if (selected.has(topology.surfaces.ids[index]))
        closingFaces.Append(face.wrapped);
    });
    builder.MakeThickSolidByJoin(
      shape.wrapped,
      closingFaces,
      -thickness,
      tolerance,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
    );
    if (!builder.IsDone())
      throw new Error('OpenCascade could not build the offset walls.');
    const raw = castOwnedShape3D(builder.Shape());
    try {
      result = singleSolid(raw);
    } finally {
      raw.delete();
    }
    const volume = validVolume(result);
    const outputFaces = shapeSubshapes(result, 'face');
    try {
      // IsDone/IsValid can both succeed without offset walls, including on
      // mixed-profile lofts. Diagnose that before comparing solid volumes.
      const hasOffsetWall = faces.some((face, index) => {
        if (selected.has(topology.surfaces.ids[index])) return false;
        const generated = builder.Generated(face.wrapped);
        try {
          while (!generated.IsEmpty()) {
            const candidate = generated.First();
            generated.RemoveFirst();
            try {
              if (outputFaces.some(output => output.wrapped.IsSame(candidate)))
                return true;
            } finally {
              candidate.delete();
            }
          }
          return false;
        } finally {
          generated.delete();
        }
      });
      if (!hasOffsetWall) {
        throw new Error(
          'OpenCascade generated no offset walls for this geometry; the result is not hollow.',
        );
      }
    } finally {
      outputFaces.forEach(face => face.delete());
    }
    if (thickness > 0 && volume >= sourceVolume) {
      throw new Error('The inward offset did not leave a cavity.');
    }
    return {
      shape: result,
      topology: transferShapeTopology(
        [{shape, topology, index: 1}],
        result,
        builder,
      ),
    };
  } catch (error) {
    result?.delete();
    throw error;
  } finally {
    builder.delete();
    closingFaces.delete();
    faces.forEach(face => face.delete());
  }
}

function closedShell(
  shape: Shape3D,
  topology: ShapeTopology,
  thickness: number,
  sourceVolume: number,
): {shape: Shape3D; topology: ShapeTopology} {
  const oc = getOC();
  const offset = new oc.BRepOffsetAPI_MakeOffsetShape();
  let parallel: Shape3D | undefined;
  try {
    // MakeThickSolidByJoin with no closing faces returns only the offset solid.
    offset.PerformByJoin(
      shape.wrapped,
      -thickness,
      tolerance,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
    );
    if (!offset.IsDone())
      throw new Error('OpenCascade could not build the cavity offset.');
    const raw = castOwnedShape3D(offset.Shape());
    try {
      parallel = singleSolid(raw);
    } finally {
      raw.delete();
    }
    const offsetVolume = validVolume(parallel);
    if (
      thickness > 0
        ? offsetVolume >= sourceVolume
        : offsetVolume <= sourceVolume
    ) {
      throw new Error('The offset did not produce a distinct cavity boundary.');
    }
    const cut = new oc.BRepAlgoAPI_Cut(
      thickness > 0 ? shape.wrapped : parallel.wrapped,
      thickness > 0 ? parallel.wrapped : shape.wrapped,
    );
    let result: Shape3D | undefined;
    try {
      cut.Build();
      if (!cut.IsDone())
        throw new Error('OpenCascade could not subtract the cavity.');
      const rawResult = castOwnedShape3D(cut.Shape());
      try {
        result = singleSolid(rawResult);
      } finally {
        rawResult.delete();
      }
      validVolume(result);
      const shells = new oc.TopExp_Explorer(
        result.wrapped,
        oc.TopAbs_ShapeEnum.TopAbs_SHELL,
      );
      try {
        let count = 0;
        while (shells.More()) {
          count++;
          shells.Next();
        }
        if (count < 2)
          throw new Error('The offset did not form an enclosed cavity.');
      } finally {
        shells.delete();
      }
      // Original boundaries retain their input paths for either direction. Offset
      // boundaries are new topology, even when OCCT has generation history.
      return {
        shape: result,
        topology: transferShapeTopology(
          [{shape, topology, index: 1}],
          result,
          cut,
        ),
      };
    } catch (error) {
      result?.delete();
      throw error;
    } finally {
      cut.delete();
    }
  } finally {
    parallel?.delete();
    offset.delete();
  }
}

/** Own one solid independently of its enclosing boolean compound or builder. */
function singleSolid(shape: Shape3D): Shape3D {
  const oc = getOC();
  const explorer = new oc.TopExp_Explorer(
    shape.wrapped,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
  );
  let solid: Shape3D | undefined;
  try {
    if (!explorer.More())
      throw new Error('Shell requires one connected solid.');
    solid = castOwnedShape3D(explorer.Current());
    explorer.Next();
    if (explorer.More()) throw new Error('Shell requires one connected solid.');
    return solid;
  } catch (error) {
    solid?.delete();
    throw error;
  } finally {
    explorer.delete();
  }
}

function validVolume(shape: Shape3D): number {
  const check = new (getOC().BRepCheck_Analyzer)(
    shape.wrapped,
    true,
    false,
    false,
  );
  try {
    if (!check.IsValid())
      throw new Error('The offset geometry is invalid or self-intersecting.');
  } finally {
    check.delete();
  }
  const oc = getOC();
  const properties = new oc.GProp_GProps();
  try {
    oc.BRepGProp.VolumeProperties(
      shape.wrapped,
      properties,
      false,
      false,
      false,
    );
    const volume = properties.Mass();
    if (!(Number.isFinite(volume) && volume > 0)) {
      throw new Error('The offset geometry has no positive solid volume.');
    }
    return volume;
  } finally {
    properties.delete();
  }
}
