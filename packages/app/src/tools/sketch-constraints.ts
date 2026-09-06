import type {
  SketchConstraint,
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
} from '@code3d/core/tooling';
import {sameSketchPoint, type SketchPoint} from './sketch-snap';

export type SketchConstraintDisplay = Readonly<{
  /** Evaluation-local display identity, never an authored constraint ID. */
  key: string;
  layer: string;
  kind: SketchConstraint[0];
  label: string;
  title: string;
  anchor: SketchPosition;
  points: readonly SketchPoint[];
  line?: SketchPointAddress;
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
    layer.constraints.map(([kind, data], index): SketchConstraintDisplay => {
      let related: readonly SketchPoint[], line: SketchPointAddress | undefined;
      let label = '',
        title: string = kind;
      switch (kind) {
        case 'fixed':
          related = [point(data)];
          title = 'Fixed';
          break;
        case 'x':
        case 'y':
          related = [point(data[0])];
          label = `${kind.toUpperCase()}=${number(data[1])}`;
          title = `Coordinate ${kind.toUpperCase()}=${data[1]}`;
          break;
        case 'coincident':
        case 'midpoint':
          related = data.map(point);
          title =
            kind === 'midpoint'
              ? 'Midpoint (center, start, end)'
              : 'Coincident';
          break;
        case 'horizontal':
        case 'vertical':
        case 'length':
        case 'angle': {
          const id = typeof data === 'number' ? data : data[0];
          const entity = layer.entities
            .filter(e => e.kind === 'line')
            .find(e => e.id === id)!;
          related = entity.points.map(point);
          line = {layer: layer.id, id};
          if (typeof data === 'number')
            title = kind === 'horizontal' ? 'Horizontal' : 'Vertical';
          else {
            label = `${number(data[1])}${kind === 'angle' ? '°' : ''}`;
            title = `${kind === 'length' ? 'Length' : 'Angle'} ${data[1]}${kind === 'angle' ? '°' : ''}`;
          }
          title += ` · line ${id}`;
          break;
        }
      }
      title += ` · ${related.map(p => `point ${p.id}${p.layer === layer.id ? '' : ' (upstream)'}`).join(', ')}`;
      const anchor: SketchPosition = line
        ? [
            (related[0].position[0] + related[1].position[0]) / 2,
            (related[0].position[1] + related[1].position[1]) / 2,
          ]
        : related[0].position;
      return {
        key: JSON.stringify([layer.id, index]),
        layer: layer.id,
        kind,
        label,
        title,
        anchor,
        points: related,
        line,
        guides:
          !line && related.length > 1
            ? related
                .slice(1)
                .map(p => [related[0].position, p.position] as const)
            : [],
      };
    }),
  );
}
