import type {
  SketchPosition,
  SketchConstraint,
  SketchPointAddress,
} from '@code3d/core/tooling';
import {DrawingDimensions} from './drawing-dimensions';
import type {SketchChange, SketchDraftEntry} from './sketch-source';
import {
  endpointPosition,
  sketchDistance,
  snapSketchPointer,
  type SketchAxis,
  type SketchEndpoint,
  type SketchSnapContext,
  type SketchSnap,
} from './sketch-snap';

export const sketchCoordinateInputs = () =>
  new DrawingDimensions([
    {id: 'x', label: 'X'},
    {id: 'y', label: 'Y'},
  ]);

/** Drawing tools share interaction and preview contracts, not persistent entities. */
export interface SketchDrawing {
  readonly name: string;
  readonly title: string;
  readonly instructions: string;
  readonly hasDraft: boolean;
  readonly axis?: SketchAxis;
  start?: SketchEndpoint;
  pointer: SketchPosition;
  dimensions: DrawingDimensions;
  toggleAxis?(axis: SketchAxis): void;
  reset(): void;
  resolve(context: SketchSnapContext): SketchSnap;
  measurements(position: SketchPosition): Readonly<Record<string, number>>;
  segments(
    position: SketchPosition,
  ): readonly (readonly [SketchPosition, SketchPosition])[];
  place(
    endpoint: SketchEndpoint,
    layer: string,
    nextId: number,
    commit: (change: SketchChange) => boolean,
  ): string | undefined;
}

export const enteredSketchCoordinates = (dimensions: DrawingDimensions) =>
  (['x', 'y'] as const).flatMap(axis => {
    const value = dimensions.value(axis);
    return value === undefined ? [] : [{axis, value}];
  });

/** Allocate identities only in an atomic draft, reusing actual snapped references. */
export class SketchDrawingGeometry {
  readonly entries: SketchDraftEntry[] = [];
  constructor(
    private readonly layer: string,
    private nextId: number,
  ) {}

  point(endpoint: SketchEndpoint): SketchPointAddress {
    if ('point' in endpoint)
      return {layer: endpoint.point.layer, id: endpoint.point.id};
    const id = this.nextId++;
    this.entries.push(['point', id, endpoint.position]);
    return {layer: this.layer, id};
  }

  line(a: SketchPointAddress, b: SketchPointAddress): number {
    const id = this.nextId++;
    this.entries.push(['line', id, [a, b]]);
    return id;
  }
}

/** A continuous line chain, independent of DOM focus, rendering, and source parsing. */
export class SketchLineDrawing implements SketchDrawing {
  readonly name = 'Line';
  start?: SketchEndpoint;
  dimensions = sketchCoordinateInputs();
  pointer: SketchPosition = [0, 0];
  axis?: SketchAxis;
  private startCoordinates: {axis: 'x' | 'y'; value: number}[] = [];

  get title(): string {
    return this.start
      ? this.axis
        ? `${this.axis.toUpperCase()} locked`
        : 'Next point'
      : 'Start point';
  }

  get instructions(): string {
    return this.start
      ? 'Next point · Enter length/angle or click · X/Y locks direction · Esc ends the chain'
      : 'Start point · Enter X/Y or click';
  }

  segments(
    position: SketchPosition,
  ): readonly (readonly [SketchPosition, SketchPosition])[] {
    return this.start ? [[endpointPosition(this.start), position]] : [];
  }

  get hasDraft(): boolean {
    return !!this.start || this.dimensions.edited;
  }

  resolve(context: SketchSnapContext) {
    const angle = this.start ? this.dimensions.value('angle') : undefined;
    return snapSketchPointer(
      this.pointer,
      this.start
        ? {
            kind: 'polar',
            origin: endpointPosition(this.start),
            length: this.dimensions.value('length'),
            direction: this.axis
              ? {kind: 'axis', axis: this.axis}
              : angle === undefined
                ? undefined
                : {kind: 'angle', degrees: angle},
          }
        : {
            kind: 'cartesian',
            x: this.dimensions.value('x'),
            y: this.dimensions.value('y'),
          },
      context,
    );
  }

  measurements(position: SketchPosition): Readonly<Record<string, number>> {
    if (!this.start) return {x: position[0], y: position[1]};
    const origin = endpointPosition(this.start);
    return {
      length: sketchDistance(origin, position),
      angle:
        (Math.atan2(position[1] - origin[1], position[0] - origin[0]) * 180) /
        Math.PI,
    };
  }

  reset(): void {
    this.start = undefined;
    this.axis = undefined;
    this.startCoordinates = [];
    this.dimensions = sketchCoordinateInputs();
  }

  /** Axis and numeric angle are two mutually exclusive ways to set direction. */
  toggleAxis(axis: SketchAxis): void {
    const next = this.axis === axis ? undefined : axis;
    this.dimensions.set('angle', '');
    this.axis = next;
  }

  private segmentDimensions(): DrawingDimensions {
    return new DrawingDimensions(
      [
        {id: 'length', label: 'Length', positive: true},
        {id: 'angle', label: 'Angle', unit: '°'},
      ],
      id => {
        if (id === 'angle') this.axis = undefined;
      },
    );
  }

  /** A rejected transaction retains the entire editable draft, including IDs. */
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
    if (!endpointPosition(endpoint).every(Number.isFinite))
      return 'The resulting coordinates must be finite';
    if (!this.start) {
      this.start = endpoint;
      this.startCoordinates = enteredSketchCoordinates(this.dimensions);
      this.dimensions = this.segmentDimensions();
      return undefined;
    }
    if (
      sketchDistance(
        endpointPosition(this.start),
        endpointPosition(endpoint),
      ) === 0
    )
      return 'Choose a different end point';
    const geometry = new SketchDrawingGeometry(layer, nextId);
    const start = geometry.point(this.start),
      end = geometry.point(endpoint);
    const segment = geometry.line(start, end);
    const constraints: SketchConstraint<SketchPointAddress>[] =
      this.startCoordinates.map(({axis, value}) => [axis, [start, value]]);
    const length = this.dimensions.value('length');
    const angle = this.dimensions.value('angle');
    if (length !== undefined) constraints.push(['length', [segment, length]]);
    if (this.axis)
      constraints.push([
        this.axis === 'x' ? 'horizontal' : 'vertical',
        segment,
      ]);
    else if (angle !== undefined) constraints.push(['angle', [segment, angle]]);
    if (!commit({kind: 'append', entries: geometry.entries, constraints}))
      return 'The sketch changed; the drawing was not applied';
    // Reuse the committed endpoint's identity, including a newly allocated ID.
    // Advance only after the transaction succeeds; each segment is one undo step.
    this.pointer = endpointPosition(endpoint);
    this.start = {point: {...end, position: this.pointer}};
    this.axis = undefined;
    this.startCoordinates = [];
    this.dimensions = this.segmentDimensions();
    return undefined;
  }
}
