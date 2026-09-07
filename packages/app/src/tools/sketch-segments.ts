import type {
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
  SketchLineSnapshot,
  SketchEntitySnapshot,
  SketchCurve,
} from '@code3d/core/tooling';
import {
  sketchCurveGeometry,
  sketchCurveClosestParameter,
  sketchCurvePosition,
  sketchCurveTolerance,
  sketchCurveIntersections,
} from '@code3d/core/tooling';
import {formatSourceNumber} from './source-expression';
import {
  sketchDraftEntity,
  type SketchChange,
  type SketchDraftEntry,
} from './sketch-source';
import {
  endpointPosition,
  sameSketchPoint,
  sketchDistance,
  type SketchEndpoint,
  type SketchPoint,
} from './sketch-snap';

export type SketchCut = {t: number; endpoint: SketchEndpoint};
export type SketchSegment = SketchPointAddress & {
  start: SketchCut;
  end: SketchCut;
};

const segmentCurve = (
  segment: SketchSegment,
): Extract<SketchCurve, {kind: 'line'}> => ({
  kind: 'line',
  points: [
    endpointPosition(segment.start.endpoint),
    endpointPosition(segment.end.endpoint),
  ],
});
const snapshotPoints = (layers: readonly SketchSnapshot[]): SketchPoint[] =>
  layers.flatMap(layer =>
    layer.entities.flatMap(e =>
      e.kind === 'point' ? [{...e, layer: layer.id}] : [],
    ),
  );

/** Geometric boundaries do not depend on zoom, snapping, or persistent IDs. */
export function sketchSegments(
  layers: readonly SketchSnapshot[],
  points: readonly SketchPoint[],
): SketchSegment[] {
  const curves = layers.flatMap(layer =>
    layer.entities.flatMap(entity => {
      const geometry = sketchCurveGeometry(
        entity,
        ref => points.find(p => sameSketchPoint(p, ref))!.position,
      );
      return geometry ? [{layer: layer.id, entity, geometry}] : [];
    }),
  );
  return curves.flatMap(line => {
    if (line.entity.kind !== 'line' || line.geometry.kind !== 'line') return [];
    const {geometry, entity} = line;
    const [a, b] = entity.points.map(ref =>
      points.find(p => sameSketchPoint(p, ref))!,
    );
    const length = sketchDistance(a.position, b.position);
    if (!length) return [];
    const tolerance = sketchCurveTolerance(geometry);
    const parameterTolerance = tolerance / length;
    const cuts: SketchCut[] = [
      {t: 0, endpoint: {point: a}},
      {t: 1, endpoint: {point: b}},
    ];
    const add = (t: number, endpoint: SketchEndpoint) => {
      if (t <= parameterTolerance || t >= 1 - parameterTolerance) return;
      if (cuts.some(cut => Math.abs(cut.t - t) <= parameterTolerance)) return;
      cuts.push({t, endpoint});
    };
    // Real points take precedence over computed intersections; prefer local
    // ownership when several distinct point identities share a coordinate.
    const ordered = [...points].sort(
      (p, q) => Number(q.layer === line.layer) - Number(p.layer === line.layer),
    );
    for (const point of ordered) {
      const t = sketchCurveClosestParameter(geometry, point.position);
      if (
        sketchDistance(sketchCurvePosition(geometry, t), point.position) <=
        tolerance
      )
        add(t, {point});
    }
    for (const other of curves)
      if (other !== line)
        for (const contact of sketchCurveIntersections(
          geometry,
          other.geometry,
        ))
          add(contact.parameters[0], {position: contact.position});
    cuts.sort((p, q) => p.t - q.t);
    return cuts.slice(1).map((end, index) => ({
      layer: line.layer,
      id: entity.id,
      start: cuts[index],
      end,
    }));
  });
}

export function sameSketchSegment(a: SketchSegment, b: SketchSegment): boolean {
  return (
    sameSketchPoint(a, b) && a.start.t === b.start.t && a.end.t === b.end.t
  );
}

/** All lines share the same geometric cuts, so an overlap is an equal interval,
 * possibly reversed. Never group by screen-space picking distance. */
export function overlappingSketchSegments(
  segments: readonly SketchSegment[],
  selected: SketchSegment,
): SketchSegment[] {
  const a = endpointPosition(selected.start.endpoint);
  const b = endpointPosition(selected.end.endpoint);
  const tolerance = sketchCurveTolerance(segmentCurve(selected));
  const near = (p: SketchPosition, q: SketchPosition) =>
    sketchDistance(p, q) <= tolerance;
  return segments.filter(segment => {
    if (segment.layer !== selected.layer) return false;
    const start = endpointPosition(segment.start.endpoint);
    const end = endpointPosition(segment.end.endpoint);
    return (near(a, start) && near(b, end)) || (near(a, end) && near(b, start));
  });
}

export function sketchSegmentDistance(
  p: SketchPosition,
  segment: SketchSegment,
): number {
  const curve = segmentCurve(segment);
  return sketchDistance(
    p,
    sketchCurvePosition(curve, sketchCurveClosestParameter(curve, p)),
  );
}

/** Only points connected to removed geometry are candidates; unrelated points remain. */
function disconnectedPoints(
  layers: readonly SketchSnapshot[],
  removed: readonly number[],
  entries: readonly SketchDraftEntry[] = [],
): number[] {
  const local = layers.at(-1)!;
  const points = snapshotPoints(layers);
  points.push(
    ...entries.flatMap(([kind, id, position]) =>
      kind === 'point' ? [{kind, id, position, layer: local.id}] : [],
    ),
  );
  const removedConnections = local.entities.filter(e => removed.includes(e.id));
  const connections = layers.flatMap(layer =>
    layer.entities.filter(
      e => !(layer.id === local.id && removed.includes(e.id)),
    ),
  );
  connections.push(...entries.map(sketchDraftEntity));
  const connected = (
    point: SketchPoint,
    connections: readonly SketchEntitySnapshot[],
  ) =>
    connections.some(entity => {
      const refs =
        entity.kind === 'line'
          ? entity.points
          : entity.kind === 'circle'
            ? [entity.center]
            : entity.kind === 'arc'
              ? [entity.center, ...entity.points]
              : [];
      if (refs.some(ref => sameSketchPoint(ref, point))) return true;
      const curve = sketchCurveGeometry(
        entity,
        ref => points.find(p => sameSketchPoint(p, ref))!.position,
      );
      return (
        !!curve &&
        sketchDistance(
          point.position,
          sketchCurvePosition(
            curve,
            sketchCurveClosestParameter(curve, point.position),
          ),
        ) <= sketchCurveTolerance(curve)
      );
    });
  return points
    .filter(
      point =>
        point.layer === local.id &&
        !removed.includes(point.id) &&
        connected(point, removedConnections) &&
        !connected(point, connections),
    )
    .map(point => point.id);
}

function deletedConstraints(
  local: SketchSnapshot,
  ids: readonly number[],
): number[] {
  const pointDeleted = (point: SketchPointAddress) =>
    point.layer === local.id && ids.includes(point.id);
  return local.constraints.flatMap(([kind, data], index) => {
    let deleted: boolean;
    switch (kind) {
      case 'fixed':
        deleted = pointDeleted(data);
        break;
      case 'horizontal':
      case 'vertical':
        deleted = ids.includes(data);
        break;
      case 'coincident':
      case 'midpoint':
        deleted = data.some(pointDeleted);
        break;
      case 'x':
      case 'y':
        deleted = pointDeleted(data[0]);
        break;
      case 'length':
      case 'angle':
      case 'radius':
      case 'sweep':
        deleted = ids.includes(data[0]);
        break;
    }
    return deleted ? [index] : [];
  });
}

export function deleteSketchEntity(
  layers: readonly SketchSnapshot[],
  id: number,
): SketchChange {
  const local = layers.at(-1)!;
  const ids = [
    id,
    ...local.entities.flatMap(e =>
      (e.kind === 'line'
        ? e.points
        : e.kind === 'circle'
          ? [e.center]
          : e.kind === 'arc'
            ? [e.center, ...e.points]
            : []
      ).some(p => p.layer === local.id && p.id === id)
        ? [e.id]
        : [],
    ),
  ];
  ids.push(...disconnectedPoints(layers, ids));
  return {kind: 'delete', ids, constraints: deletedConstraints(local, ids)};
}

/** Remove one geometric interval from all overlapping local lines, atomically. */
export function trimSketchSegment(
  layers: readonly SketchSnapshot[],
  segment: SketchSegment,
): Extract<SketchChange, {kind: 'trim'}> {
  const local = layers.at(-1)!;
  const segments = overlappingSketchSegments(
    sketchSegments(layers, snapshotPoints(layers)),
    segment,
  );
  const lines = segments.map(
    segment =>
      local.entities.find(e => e.id === segment.id) as SketchLineSnapshot,
  );
  let nextId = Math.max(0, ...local.entities.map(e => e.id)) + 1;
  const entries: SketchDraftEntry[] = [];
  const generated: {position: SketchPosition; address: SketchPointAddress}[] =
    [];
  const tolerance = sketchCurveTolerance(segmentCurve(segment));
  const point = (cut: SketchCut): SketchPointAddress => {
    if ('point' in cut.endpoint) {
      const {layer, id} = cut.endpoint.point;
      return {layer, id};
    }
    const raw = cut.endpoint.position;
    const existing = generated.find(
      p => sketchDistance(p.position, raw) <= tolerance,
    );
    if (existing) return existing.address;
    const id = nextId++;
    const position: SketchPosition = [
      Number(formatSourceNumber(cut.endpoint.position[0])),
      Number(formatSourceNumber(cut.endpoint.position[1])),
    ];
    entries.push(['point', id, position]);
    const address = {layer: local.id, id};
    generated.push({position: raw, address});
    return address;
  };
  const replacements = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    const line = lines[index];
    const remains = Number(segment.start.t > 0) + Number(segment.end.t < 1);
    const ids: number[] = [];
    replacements.set(line.id, ids);
    const add = (points: readonly [SketchPointAddress, SketchPointAddress]) => {
      const id = remains === 1 ? line.id : nextId++;
      ids.push(id);
      entries.push(['line', id, points]);
    };
    if (segment.start.t > 0) add([line.points[0], point(segment.start)]);
    if (segment.end.t < 1) add([point(segment.end), line.points[1]]);
  });
  const lineConstraints = local.constraints.flatMap(([kind, data], index) => {
    const id =
      kind === 'horizontal' || kind === 'vertical'
        ? data
        : kind === 'length' || kind === 'angle'
          ? data[0]
          : undefined;
    const targets = id === undefined ? undefined : replacements.get(id);
    if (!targets) return [];
    return [{index, lines: kind === 'length' ? [] : targets}];
  });
  const ids = lines.map(line => line.id);
  const orphaned = disconnectedPoints(layers, ids, entries);
  return {
    kind: 'trim',
    lines,
    entries,
    lineConstraints,
    ids: [...ids, ...orphaned],
    constraints: deletedConstraints(local, orphaned),
  };
}
