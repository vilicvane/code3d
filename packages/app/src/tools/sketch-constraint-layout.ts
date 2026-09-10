import type {SketchPosition} from '@code3d/core/tooling';
import type {SketchConstraintMarker} from './sketch-constraints';

export const sketchConstraintLabelHeight = 20;
export const sketchConstraintLabelBorder = 1;
const geometryGap = 8;
const markerGap = 4;
const lineHalfWidth = 1;
type Bounds = {x: number; y: number; width: number; height: number};
type Label = {marker: SketchConstraintMarker; width: number};
type Anchor = {position: SketchPosition; direction: SketchPosition};
type Row = {indices: number[]; anchor: Anchor; point: boolean};
const extent = (
  size: Pick<Bounds, 'width' | 'height'>,
  direction: SketchPosition,
) =>
  (Math.abs(direction[0]) * size.width + Math.abs(direction[1]) * size.height) /
  2;

function cornerAnchor(
  marker: Extract<SketchConstraintMarker, {kind: 'corner'}>,
  project: (position: SketchPosition) => SketchPosition,
): Anchor {
  const [vertex, a, b] = marker.points.map(project);
  const start = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
  const end = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]);
  const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  // Coincident rays have no open corner; use their normal instead.
  const angle = start + (Math.abs(sweep) < 1e-9 ? Math.PI / 2 : sweep / 2);
  // Axis-aligned bisectors use the side midpoint, not a corner chosen by noise.
  const component = (value: number) => (Math.abs(value) < 1e-9 ? 0 : value);
  const direction: SketchPosition = [
    component(Math.cos(angle)),
    component(Math.sin(angle)),
  ];
  const distance =
    (geometryGap + lineHalfWidth) /
    Math.max(Math.abs(direction[0]), Math.abs(direction[1]));
  return {
    position: [
      vertex[0] + distance * direction[0],
      vertex[1] + distance * direction[1],
    ],
    direction: [Math.sign(direction[0]), Math.sign(direction[1])],
  };
}

const overlaps = (a: Bounds, b: Bounds) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

/** Layout whole line groups, not a first badge followed by one-sided additions.
 * Bounds include the SVG border; gaps therefore measure between visible edges.
 * Point rows merge overlapping corner rows only at the same vertex and quadrant.
 * Different geometric anchors may still overlap; there is no global avoidance.
 */
export function layoutSketchConstraintMarkers(
  labels: readonly Label[],
  project: (position: SketchPosition) => SketchPosition,
): Bounds[] {
  const groups = new Map<string, number[]>();
  const result: Bounds[] = [];
  const sizes = labels.map(label => ({
    width: label.width + sketchConstraintLabelBorder,
    height: sketchConstraintLabelHeight + sketchConstraintLabelBorder,
  }));
  const rows = new Map<string, Row[]>();
  const addressKey = (kind: string, address: {layer: string; id: number}) =>
    JSON.stringify([kind, address.layer, address.id]);
  const placeRow = ({indices, anchor}: Row) => {
    const width =
      indices.reduce((sum, index) => sum + sizes[index].width, 0) +
      markerGap * (indices.length - 1);
    const [dx, dy] = anchor.direction;
    let cursor = anchor.position[0] - (dx === 0 ? width / 2 : 0);
    for (const index of indices) {
      const size = sizes[index];
      result[index] = {
        x: dx < 0 ? cursor - size.width : cursor,
        y: anchor.position[1] + ((dy - 1) * size.height) / 2,
        ...size,
      };
      cursor += (dx < 0 ? -1 : 1) * (size.width + markerGap);
    }
  };
  labels.forEach(({marker}, index) => {
    const key =
      marker.kind === 'line'
        ? addressKey('line', marker.curve)
        : marker.kind === 'point'
          ? addressKey('point', marker.point)
          : marker.kind === 'curve'
            ? addressKey('curve', marker.curve)
            : JSON.stringify(['marker', index]);
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  for (const indices of groups.values()) {
    const marker = labels[indices[0]].marker;
    const groupSizes = indices.map(index => sizes[index]);
    if (marker.kind === 'line') {
      const [a, b] = marker.points.map(project);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const sign = b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? -1 : 1;
      const tangent: SketchPosition = [
        (sign * (b[0] - a[0])) / length,
        (sign * (b[1] - a[1])) / length,
      ];
      const direction: SketchPosition = [tangent[1], -tangent[0]];
      const total =
        groupSizes.reduce((sum, size) => sum + 2 * extent(size, tangent), 0) +
        markerGap * (groupSizes.length - 1);
      let cursor = -total / 2;
      groupSizes.forEach((size, i) => {
        const half = extent(size, tangent);
        const along = cursor + half;
        cursor += half * 2 + markerGap;
        const offset = geometryGap + lineHalfWidth + extent(size, direction);
        result[indices[i]] = {
          x:
            (a[0] + b[0]) / 2 +
            along * tangent[0] +
            offset * direction[0] -
            size.width / 2,
          y:
            (a[1] + b[1]) / 2 +
            along * tangent[1] +
            offset * direction[1] -
            size.height / 2,
          ...size,
        };
      });
    } else {
      const [x, y] = project(
        marker.kind === 'corner' ? marker.points[0] : marker.position,
      );
      const anchor: Anchor =
        marker.kind === 'corner'
          ? cornerAnchor(marker, project)
          : {position: [x + geometryGap, y - geometryGap], direction: [1, -1]};
      const row = {indices, anchor, point: marker.kind === 'point'};
      placeRow(row);
      const key = JSON.stringify([
        marker.kind === 'curve'
          ? addressKey('curve', marker.curve)
          : addressKey(
              'point',
              marker.kind === 'point' ? marker.point : marker.vertex,
            ),
        anchor.direction,
      ]);
      const bucket = rows.get(key) ?? [];
      bucket.push(row);
      rows.set(key, bucket);
    }
  }
  for (const bucket of rows.values()) {
    // Keep the plain point row's anchor, otherwise the first authored corner.
    bucket.sort((a, b) => Number(b.point) - Number(a.point));
    let merged: boolean;
    do {
      merged = false;
      for (let i = 0; i < bucket.length; i++) {
        const row = bucket[i];
        for (let j = i + 1; j < bucket.length; j++) {
          const other = bucket[j];
          if (
            !row.indices.some(a =>
              other.indices.some(b => overlaps(result[a], result[b])),
            )
          )
            continue;
          row.indices = [...row.indices, ...other.indices].sort(
            (a, b) => a - b,
          );
          bucket.splice(j--, 1);
          placeRow(row);
          merged = true;
        }
      }
    } while (merged);
  }
  return result;
}
