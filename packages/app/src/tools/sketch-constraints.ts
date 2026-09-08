import type {
  SketchConstraint,
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
} from '@code3d/core/tooling';
import {sameSketchPoint, type SketchPoint} from './sketch-snap';
import {sketchCurveGeometry, sketchCurvePosition} from '@code3d/core/tooling';
import type {DrawingDimension} from './drawing-dimensions';

export const sketchConstraintNames = {
  fixed: 'Fixed',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  coincident: 'Coincident',
  midpoint: 'Midpoint',
  length: 'Length',
  angle: 'Angle',
  radius: 'Radius',
  sweep: 'Sweep',
  x: 'X coordinate',
  y: 'Y coordinate',
} satisfies Record<SketchConstraint[0], string>;

export const sketchConstraintDimensions: Partial<
  Record<SketchConstraint[0], DrawingDimension>
> = {
  length: {id: 'length', label: 'Length', positive: true},
  angle: {id: 'angle', label: 'Angle', unit: '°'},
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

export type SketchConstraintDisplay = Readonly<{
  /** Evaluation-local display identity, never an authored constraint ID. */
  key: string;
  index: number;
  layer: string;
  kind: SketchConstraint[0];
  label: string;
  title: string;
  anchor: SketchPosition;
  points: readonly SketchPoint[];
  curve?: SketchPointAddress;
  guides: readonly (readonly [SketchPosition, SketchPosition])[];
}>;

/** Read persistent relations against the current geometry (including drag preview). */
export function sketchConstraintDisplays(
  layers: readonly SketchSnapshot[],
  points: readonly SketchPoint[],
): SketchConstraintDisplay[] {
  const point = (address: SketchPointAddress) =>
    points.find(p => sameSketchPoint(p, address))!;
  const number = (value: number) => String(Number(value.toPrecision(6)));
  return layers.flatMap(layer =>
    layer.constraints.map(
      ([kind, data, value], index): SketchConstraintDisplay => {
        let related: readonly SketchPoint[],
          curve: SketchPointAddress | undefined;
        let curveAnchor: SketchPosition | undefined;
        let guides: SketchConstraintDisplay['guides'] | undefined;
        let label = '',
          title: string = kind;
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
            const id = data;
            const entity = layer.entities
              .filter(e => e.kind === 'line')
              .find(e => e.id === id)!;
            related = entity.points.map(point);
            curve = {layer: layer.id, id};
            if (value === undefined)
              title = kind === 'horizontal' ? 'Horizontal' : 'Vertical';
            else {
              label = `${number(value)}${kind === 'angle' ? '°' : ''}`;
              title = `${kind === 'length' ? 'Length' : 'Angle'} ${value}${kind === 'angle' ? '°' : ''}`;
            }
            title += ` · line ${id}`;
            break;
          }
        }
        title += ` · ${related.map(p => `point ${p.id}${p.layer === layer.id ? '' : ' (upstream)'}`).join(', ')}`;
        const anchor: SketchPosition =
          curveAnchor ??
          (curve
            ? [
                (related[0].position[0] + related[1].position[0]) / 2,
                (related[0].position[1] + related[1].position[1]) / 2,
              ]
            : related[0].position);
        return {
          key: JSON.stringify([layer.id, index]),
          index,
          layer: layer.id,
          kind,
          label,
          title,
          anchor,
          points: related,
          curve,
          guides:
            guides ??
            (!curve && related.length > 1
              ? related
                  .slice(1)
                  .map(p => [related[0].position, p.position] as const)
              : []),
        };
      },
    ),
  );
}
