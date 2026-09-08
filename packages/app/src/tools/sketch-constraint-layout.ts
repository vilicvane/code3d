import type {SketchPosition} from '@code3d/core/tooling';
import type {SketchConstraintMarker} from './sketch-constraints';

export const sketchConstraintLabelHeight = 20;
export const sketchConstraintLabelBorder = 1;
const geometryGap = 8;
const markerGap = 4;
const lineHalfWidth = 1;
type Bounds = {x: number; y: number; width: number; height: number};
type Label = {marker: SketchConstraintMarker; width: number};
const extent = (
  size: Pick<Bounds, 'width' | 'height'>,
  direction: SketchPosition,
) =>
  (Math.abs(direction[0]) * size.width + Math.abs(direction[1]) * size.height) /
  2;

/** Layout whole line groups, not a first badge followed by one-sided additions.
 * Bounds include the SVG border; gaps therefore measure between visible edges.
 * Different groups may overlap; their placement depends only on their geometry.
 */
export function layoutSketchConstraintMarkers(
  labels: readonly Label[],
  project: (position: SketchPosition) => SketchPosition,
): Bounds[] {
  const groups = new Map<string, number[]>();
  const result: Bounds[] = [];
  labels.forEach(({marker}, index) => {
    const key =
      marker.kind === 'line'
        ? JSON.stringify(['line', marker.curve.layer, marker.curve.id])
        : JSON.stringify(['marker', index]);
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  for (const indices of groups.values()) {
    const marker = labels[indices[0]].marker;
    const sizes = indices.map(index => ({
      width: labels[index].width + sketchConstraintLabelBorder,
      height: sketchConstraintLabelHeight + sketchConstraintLabelBorder,
    }));
    let centers: SketchPosition[];
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
        sizes.reduce((sum, size) => sum + 2 * extent(size, tangent), 0) +
        markerGap * (sizes.length - 1);
      let cursor = -total / 2;
      centers = sizes.map(size => {
        const half = extent(size, tangent);
        const along = cursor + half;
        cursor += half * 2 + markerGap;
        const offset = geometryGap + lineHalfWidth + extent(size, direction);
        return [
          (a[0] + b[0]) / 2 + along * tangent[0] + offset * direction[0],
          (a[1] + b[1]) / 2 + along * tangent[1] + offset * direction[1],
        ];
      });
    } else if (marker.kind === 'point') {
      const [x, y] = project(marker.position);
      centers = [
        [
          x + geometryGap + sizes[0].width / 2,
          y - geometryGap - sizes[0].height / 2,
        ],
      ];
    } else {
      const [vertex, a, b] = marker.points.map(project);
      const start = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
      const end = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]);
      const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
      // Coincident rays have no open corner; use their normal instead.
      const angle = start + (Math.abs(sweep) < 1e-9 ? Math.PI / 2 : sweep / 2);
      // Axis-aligned bisectors use the side midpoint, not a corner chosen by
      // floating-point noise. Other directions align the corner facing the vertex.
      const component = (value: number) => (Math.abs(value) < 1e-9 ? 0 : value);
      const direction: SketchPosition = [
        component(Math.cos(angle)),
        component(Math.sin(angle)),
      ];
      // Anchor the near edge/corner, not the badge center. At an axis-aligned
      // right angle this leaves the same visible gap to both lines regardless of
      // label width; acute angles do not force the whole rectangle into the wedge.
      const distance =
        (geometryGap + lineHalfWidth) /
        Math.max(Math.abs(direction[0]), Math.abs(direction[1]));
      centers = [
        [
          vertex[0] +
            distance * direction[0] +
            (Math.sign(direction[0]) * sizes[0].width) / 2,
          vertex[1] +
            distance * direction[1] +
            (Math.sign(direction[1]) * sizes[0].height) / 2,
        ],
      ];
    }
    centers.forEach(([x, y], index) => {
      result[indices[index]] = {
        x: x - sizes[index].width / 2,
        y: y - sizes[index].height / 2,
        ...sizes[index],
      };
    });
  }
  return result;
}
