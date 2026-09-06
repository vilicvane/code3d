import type {
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
  SketchLineSnapshot,
} from '@code3d/core/tooling';
import {formatSourceNumber} from './source-expression';
import type {SketchChange, SketchDraftEntry} from './sketch-source';
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

const subtract = (a: SketchPosition, b: SketchPosition): SketchPosition => [
  a[0] - b[0],
  a[1] - b[1],
];
const cross = (a: SketchPosition, b: SketchPosition) =>
  a[0] * b[1] - a[1] * b[0];
const dot = (a: SketchPosition, b: SketchPosition) => a[0] * b[0] + a[1] * b[1];
const lineTolerance = (a: SketchPosition, b: SketchPosition, length: number) =>
  Math.max(
    length * 1e-9,
    Number.EPSILON * 16 * Math.max(...a.map(Math.abs), ...b.map(Math.abs)),
  );
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
  const lines = layers.flatMap(layer =>
    layer.entities.flatMap(entity => {
      if (entity.kind !== 'line') return [];
      const [a, b] = entity.points.map(ref =>
        points.find(p => sameSketchPoint(p, ref))!,
      );
      const vector = subtract(b.position, a.position);
      const length = Math.hypot(...vector);
      return [{layer: layer.id, id: entity.id, a, b, vector, length}];
    }),
  );
  return lines.flatMap(line => {
    if (!line.length) return [];
    const {a, b, vector, length} = line;
    const unit: SketchPosition = [vector[0] / length, vector[1] / length];
    const tolerance = lineTolerance(a.position, b.position, length);
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
      const delta = subtract(point.position, a.position);
      if (Math.abs(cross(unit, delta)) <= tolerance)
        add(dot(delta, unit) / length, {point});
    }
    for (const other of lines) {
      if (other === line || !other.length) continue;
      // Collinear endpoints already supply all overlap boundaries. Testing
      // distance before dividing by the angle avoids spurious intersections
      // when translated/rotated collinear lines differ by roundoff.
      if (
        [other.a, other.b].every(
          point =>
            Math.abs(cross(unit, subtract(point.position, a.position))) <=
            tolerance,
        )
      )
        continue;
      const direction: SketchPosition = [
        other.vector[0] / other.length,
        other.vector[1] / other.length,
      ];
      const denominator = cross(unit, direction);
      if (Math.abs(denominator) <= Number.EPSILON * 16) continue;
      const delta = subtract(other.a.position, a.position);
      const t = cross(delta, direction) / denominator / length;
      const u = cross(delta, unit) / denominator / other.length;
      if (u < 0 || u > 1) continue;
      add(t, {
        position: [
          a.position[0] + t * vector[0],
          a.position[1] + t * vector[1],
        ],
      });
    }
    cuts.sort((p, q) => p.t - q.t);
    return cuts.slice(1).map((end, index) => ({
      layer: line.layer,
      id: line.id,
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
  const tolerance = lineTolerance(a, b, sketchDistance(a, b));
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
  const a = endpointPosition(segment.start.endpoint),
    b = endpointPosition(segment.end.endpoint);
  const vector = subtract(b, a);
  const length = Math.hypot(...vector);
  if (!length) return sketchDistance(p, a);
  const unit: SketchPosition = [vector[0] / length, vector[1] / length];
  const along = Math.max(0, Math.min(length, dot(subtract(p, a), unit)));
  return sketchDistance(p, [a[0] + along * unit[0], a[1] + along * unit[1]]);
}

/** Only points connected to removed lines are candidates; unrelated standalone points remain. */
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
  const removedLines = local.entities.flatMap(e =>
    e.kind === 'line' && removed.includes(e.id) ? [e.points] : [],
  );
  const lines = layers.flatMap(layer =>
    layer.entities.flatMap(e =>
      e.kind === 'line' && !(layer.id === local.id && removed.includes(e.id))
        ? [e.points]
        : [],
    ),
  );
  lines.push(
    ...entries.flatMap(([kind, , data]) => (kind === 'line' ? [data] : [])),
  );
  const connected = (
    point: SketchPoint,
    lines: readonly (readonly SketchPointAddress[])[],
  ) =>
    lines.some(refs => {
      // Authored references also count for collapsed lines. Geometric
      // connections count at T junctions before source is explicitly split.
      if (refs.some(ref => sameSketchPoint(ref, point))) return true;
      const [a, b] = refs.map(
        ref => points.find(p => sameSketchPoint(p, ref))!.position,
      );
      const vector = subtract(b, a),
        length = Math.hypot(...vector);
      const tolerance = lineTolerance(a, b, length);
      if (!length) return sketchDistance(point.position, a) <= tolerance;
      const unit: SketchPosition = [vector[0] / length, vector[1] / length];
      const delta = subtract(point.position, a),
        along = dot(delta, unit);
      return (
        along >= -tolerance &&
        along <= length + tolerance &&
        Math.abs(cross(unit, delta)) <= tolerance
      );
    });
  return points
    .filter(
      point =>
        point.layer === local.id &&
        !removed.includes(point.id) &&
        connected(point, removedLines) &&
        !connected(point, lines),
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
        deleted = ids.includes(data[0]);
        break;
    }
    return deleted ? [index] : [];
  });
}

export function deleteSketchPoint(
  layers: readonly SketchSnapshot[],
  id: number,
): SketchChange {
  const local = layers.at(-1)!;
  const ids = [
    id,
    ...local.entities.flatMap(e =>
      e.kind === 'line' &&
      e.points.some(p => p.layer === local.id && p.id === id)
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
  const a = endpointPosition(segment.start.endpoint),
    b = endpointPosition(segment.end.endpoint);
  const tolerance = lineTolerance(a, b, sketchDistance(a, b));
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
