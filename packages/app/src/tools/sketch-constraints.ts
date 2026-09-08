import type {
  SketchConstraint,
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
} from '@code3d/core/tooling';
import {sameSketchPoint, type SketchPoint} from './sketch-snap';
import {
  sketchCurveGeometry,
  sketchCurvePosition,
  sketchPointResolver,
} from '@code3d/core/tooling';
import type {DrawingDimension} from './drawing-dimensions';

/** Direct relation targets; a line constraint does not implicitly target its endpoints. */
export function sketchConstraintTargets(
  layer: string,
  [kind, target]: SketchConstraint<SketchPointAddress>,
): readonly SketchPointAddress[] {
  if (
    kind === 'parallel' ||
    kind === 'perpendicular' ||
    (kind === 'angle' && typeof target !== 'number')
  )
    return (target as readonly number[]).map(id => ({layer, id}));
  if (typeof target === 'number') return [{layer, id: target}];
  if (kind === 'coincident' || kind === 'midpoint') return target;
  return [target as SketchPointAddress];
}

/** One source kind has two target-dependent tools: orientation and line-to-line angle. */
export type SketchConstraintTool = SketchConstraint[0] | 'orientation';
export function sketchConstraintTool([
  kind,
  target,
]: SketchConstraint<SketchPointAddress>): SketchConstraintTool {
  return kind === 'angle' && typeof target === 'number' ? 'orientation' : kind;
}

export const sketchConstraintNames = {
  fixed: 'Fixed',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  coincident: 'Coincident',
  midpoint: 'Midpoint',
  length: 'Length',
  orientation: 'Orientation',
  angle: 'Angle between lines',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  radius: 'Radius',
  sweep: 'Sweep',
  x: 'X coordinate',
  y: 'Y coordinate',
} satisfies Record<SketchConstraintTool, string>;

export const sketchConstraintDimensions: Partial<
  Record<SketchConstraintTool, DrawingDimension>
> = {
  length: {id: 'length', label: 'Length', positive: true},
  orientation: {id: 'angle', label: 'Orientation', unit: '°'},
  angle: {id: 'angle', label: 'Angle between lines', unit: '°'},
  radius: {id: 'radius', label: 'Radius', positive: true},
  sweep: {
    id: 'sweep',
    label: 'Sweep',
    unit: '°',
    positive: true,
    exclusiveMaximum: 360,
  },
  x: {id: 'x', label: 'X coordinate'},
  y: {id: 'y', label: 'Y coordinate'},
};

export type SketchConstraintMarker =
  | Readonly<{kind: 'point'; position: SketchPosition}>
  | Readonly<{
      kind: 'line';
      curve: SketchPointAddress;
      points: readonly [SketchPosition, SketchPosition];
    }>
  | Readonly<{
      kind: 'corner';
      /** Shared vertex, then the opposite endpoint of each participating line. */
      points: readonly [SketchPosition, SketchPosition, SketchPosition];
    }>;

export type SketchConstraintDisplay = Readonly<{
  /** Evaluation-local display identity, never an authored constraint ID. */
  key: string;
  index: number;
  layer: string;
  kind: SketchConstraint[0];
  tool: SketchConstraintTool;
  label: string;
  title: string;
  markers: readonly SketchConstraintMarker[];
  points: readonly SketchPoint[];
  curves: readonly SketchPointAddress[];
  guides: readonly (readonly [SketchPosition, SketchPosition])[];
}>;

/** Read persistent relations against the current geometry (including drag preview). */
export function sketchConstraintDisplays(
  layers: readonly SketchSnapshot[],
  points: readonly SketchPoint[],
): SketchConstraintDisplay[] {
  const resolve = sketchPointResolver(layers);
  const point = (address: SketchPointAddress) =>
    points.find(p => sameSketchPoint(p, address))!;
  const number = (value: number) => String(Number(value.toPrecision(6)));
  return layers.flatMap(layer =>
    layer.constraints.map((constraint, index): SketchConstraintDisplay => {
      const [kind, data, value] = constraint;
      const tool = sketchConstraintTool(constraint);
      let related: readonly SketchPoint[],
        curve: SketchPointAddress | undefined;
      let curves: readonly SketchPointAddress[] = [];
      let markers: readonly SketchConstraintMarker[] | undefined;
      let curveAnchor: SketchPosition | undefined;
      let guides: SketchConstraintDisplay['guides'] | undefined;
      let label = '',
        title: string = kind;
      if (
        kind === 'parallel' ||
        kind === 'perpendicular' ||
        (kind === 'angle' && typeof data !== 'number')
      ) {
        const ids = data as readonly [number, number];
        const lines = ids.map(id =>
          layer.entities.filter(e => e.kind === 'line').find(e => e.id === id)!,
        );
        related = lines.flatMap(line => line.points.map(point));
        curves = ids.map(id => ({layer: layer.id, id}));
        const shared = lines[0].points.find(a =>
          lines[1].points.some(b => sameSketchPoint(resolve(a), resolve(b))),
        );
        if (kind !== 'parallel' && shared) {
          const opposite = (line: (typeof lines)[number]) =>
            point(
              line.points.find(
                p => !sameSketchPoint(resolve(p), resolve(shared)),
              )!,
            ).position;
          markers = [
            {
              kind: 'corner',
              points: [
                point(shared).position,
                opposite(lines[0]),
                opposite(lines[1]),
              ],
            },
          ];
        } else {
          markers = lines.map(line => ({
            kind: 'line',
            curve: {layer: layer.id, id: line.id},
            points: [
              point(line.points[0]).position,
              point(line.points[1]).position,
            ],
          }));
        }
        guides = [];
        title = `${sketchConstraintNames[tool]} · line ${ids[0]} → line ${ids[1]}`;
        if (kind === 'angle') {
          label = `${number(value!)}°`;
          title += ` · ${value}° · authored start → end directions; positive CCW`;
        }
      } else {
        switch (kind) {
          case 'fixed':
            related = [point(data)];
            title = 'Fixed';
            break;
          case 'x':
          case 'y':
            related = [point(data)];
            label = number(value);
            title = `${sketchConstraintNames[kind]}=${value}`;
            break;
          case 'coincident':
          case 'midpoint':
            related = data.map(point);
            title =
              kind === 'midpoint'
                ? 'Midpoint (center, start, end)'
                : 'Coincident';
            break;
          case 'radius': {
            const circle = layer.entities
              .filter(e => e.kind === 'circle' || e.kind === 'arc')
              .find(e => e.id === data)!;
            const center = point(circle.center);
            related = [center];
            curve = {layer: layer.id, id: circle.id};
            curveAnchor = sketchCurvePosition(
              sketchCurveGeometry(circle, ref => point(ref).position),
              circle.kind === 'circle' ? 1 / 8 : 1 / 2,
            );
            label = `R${number(value)}`;
            title = `Radius ${value} · ${circle.kind} ${circle.id}`;
            guides = [[center.position, curveAnchor]];
            break;
          }
          case 'sweep': {
            const arc = layer.entities
              .filter(e => e.kind === 'arc')
              .find(e => e.id === data)!;
            related = [point(arc.center), ...arc.points.map(point)];
            curve = {layer: layer.id, id: arc.id};
            curveAnchor = sketchCurvePosition(
              sketchCurveGeometry(arc, ref => point(ref).position),
              1 / 2,
            );
            label = `${number(value)}°`;
            title = `Sweep ${value}° · ${arc.direction.toUpperCase()} · arc ${arc.id}`;
            guides = related
              .slice(1)
              .map(p => [related[0].position, p.position]);
            break;
          }
          case 'horizontal':
          case 'vertical':
          case 'length':
          case 'angle': {
            const id = data as number;
            const entity = layer.entities
              .filter(e => e.kind === 'line')
              .find(e => e.id === id)!;
            related = entity.points.map(point);
            curve = {layer: layer.id, id};
            markers = [
              {
                kind: 'line',
                curve,
                points: [related[0].position, related[1].position],
              },
            ];
            if (value === undefined)
              title = kind === 'horizontal' ? 'Horizontal' : 'Vertical';
            else {
              label = `${number(value)}${kind === 'angle' ? '°' : ''}`;
              title = `${sketchConstraintNames[tool]} ${value}${kind === 'angle' ? '°' : ''}`;
            }
            title += ` · line ${id}`;
            break;
          }
        }
      }
      title += ` · ${related.map(p => `point ${p.id}${p.layer === layer.id ? '' : ' (upstream)'}`).join(', ')}`;
      return {
        key: JSON.stringify([layer.id, index]),
        index,
        layer: layer.id,
        kind,
        tool,
        label,
        title,
        markers: markers ?? [
          {kind: 'point', position: curveAnchor ?? related[0].position},
        ],
        points: related,
        curves: curve ? [curve] : curves,
        guides:
          guides ??
          (!curve && related.length > 1
            ? related
                .slice(1)
                .map(p => [related[0].position, p.position] as const)
            : []),
      };
    }),
  );
}
