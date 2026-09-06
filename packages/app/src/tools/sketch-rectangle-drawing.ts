import type {
  SketchPosition,
  SketchConstraint,
  SketchPointAddress,
} from '@code3d/core/tooling';
import {DrawingDimensions} from './drawing-dimensions';
import {
  enteredSketchCoordinates,
  sketchCoordinateInputs,
  SketchDrawingGeometry,
  type SketchDrawing,
} from './sketch-drawing';
import {
  endpointPosition,
  snapSketchPointer,
  type SketchEndpoint,
  type SketchSnapContext,
} from './sketch-snap';
import type {SketchChange} from './sketch-source';

/** Rectangle construction modes persist only ordinary points, lines and constraints. */
export class SketchRectangleDrawing implements SketchDrawing {
  constructor(private readonly mode: 'corner' | 'center' = 'corner') {}

  get name(): string {
    return this.mode === 'center' ? 'Center rectangle' : 'Rectangle';
  }
  start?: SketchEndpoint;
  pointer: SketchPosition = [0, 0];
  dimensions = sketchCoordinateInputs();
  private startCoordinates: ReturnType<typeof enteredSketchCoordinates> = [];

  get hasDraft(): boolean {
    return !!this.start || this.dimensions.edited;
  }
  get title(): string {
    return this.start
      ? this.mode === 'center'
        ? 'Corner'
        : 'Opposite corner'
      : this.mode === 'center'
        ? 'Center'
        : 'First corner';
  }
  get instructions(): string {
    return this.start
      ? `${this.title} · Enter full width/height or click · Esc cancels`
      : `${this.title} · Enter X/Y or click`;
  }
  reset(): void {
    this.start = undefined;
    this.startCoordinates = [];
    this.dimensions = sketchCoordinateInputs();
  }
  resolve(context: SketchSnapContext) {
    if (!this.start)
      return snapSketchPointer(
        this.pointer,
        {
          kind: 'cartesian',
          x: this.dimensions.value('x'),
          y: this.dimensions.value('y'),
        },
        context,
      );
    const start = endpointPosition(this.start);
    const coordinate = (axis: 0 | 1, field: string) => {
      const size = this.dimensions.value(field);
      return size === undefined
        ? undefined
        : start[axis] +
            (Math.sign(this.pointer[axis] - start[axis] || 1) * size) /
              this.sizeFactor;
    };
    return snapSketchPointer(
      this.pointer,
      {
        kind: 'cartesian',
        x: coordinate(0, 'width'),
        y: coordinate(1, 'height'),
      },
      context,
    );
  }
  measurements(position: SketchPosition): Readonly<Record<string, number>> {
    if (!this.start) return {x: position[0], y: position[1]};
    const start = endpointPosition(this.start);
    return {
      width: Math.abs(position[0] - start[0]) * this.sizeFactor,
      height: Math.abs(position[1] - start[1]) * this.sizeFactor,
    };
  }
  private get sizeFactor(): number {
    return this.mode === 'center' ? 2 : 1;
  }
  private corners(position: SketchPosition): readonly SketchPosition[] {
    const start = endpointPosition(this.start!);
    const a: SketchPosition =
      this.mode === 'center'
        ? [
            start[0] + (start[0] - position[0]),
            start[1] + (start[1] - position[1]),
          ]
        : start;
    const c = position;
    return [a, [c[0], a[1]], c, [a[0], c[1]]];
  }
  segments(
    position: SketchPosition,
  ): readonly (readonly [SketchPosition, SketchPosition])[] {
    if (!this.start) return [];
    const [a, b, c, d] = this.corners(position);
    return [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ];
  }
  place(
    endpoint: SketchEndpoint,
    layer: string,
    nextId: number,
    commit: (change: SketchChange) => boolean,
  ): string | undefined {
    const error = this.dimensions.definitions
      .map(field => this.dimensions.error(field.id))
      .find(Boolean);
    if (error) return error;
    const end = endpointPosition(endpoint);
    if (!end.every(Number.isFinite))
      return 'The resulting coordinates must be finite';
    if (!this.start) {
      this.start = endpoint;
      this.startCoordinates = enteredSketchCoordinates(this.dimensions);
      this.dimensions = new DrawingDimensions([
        {id: 'width', label: 'Width', positive: true},
        {id: 'height', label: 'Height', positive: true},
      ]);
      return undefined;
    }
    const start = endpointPosition(this.start);
    if (start[0] === end[0] || start[1] === end[1])
      return 'Width and height must be greater than zero';
    const corners = this.corners(end);
    if (!corners.every(p => p.every(Number.isFinite)))
      return 'The resulting coordinates must be finite';
    const geometry = new SketchDrawingGeometry(layer, nextId);
    const center =
      this.mode === 'center' ? geometry.point(this.start) : undefined;
    const a = geometry.point(center ? {position: corners[0]} : this.start);
    const b = geometry.point({position: corners[1]});
    const c = geometry.point(endpoint);
    const d = geometry.point({position: corners[3]});
    const bottom = geometry.line(a, b),
      right = geometry.line(b, c);
    const top = geometry.line(c, d),
      left = geometry.line(d, a);
    const constraints: SketchConstraint<SketchPointAddress>[] = [
      ...this.startCoordinates.map(
        ({axis, value}): SketchConstraint<SketchPointAddress> => [
          axis,
          [center ?? a, value],
        ],
      ),
      ['horizontal', bottom],
      ['vertical', right],
      ['horizontal', top],
      ['vertical', left],
    ];
    if (center) constraints.push(['midpoint', [center, a, c]]);
    const width = this.dimensions.value('width'),
      height = this.dimensions.value('height');
    if (width !== undefined) constraints.push(['length', [bottom, width]]);
    if (height !== undefined) constraints.push(['length', [right, height]]);
    if (!commit({kind: 'append', entries: geometry.entries, constraints}))
      return 'The sketch changed; the drawing was not applied';
    this.pointer = end;
    this.reset();
    return undefined;
  }
}
