import {
  sketchArcGeometry,
  type SketchArcDirection,
  type SketchConstraint,
  type SketchPointAddress,
  type SketchPosition,
} from '@code3d/core/tooling';
import {DrawingDimensions} from './drawing-dimensions';
import {
  enteredSketchCoordinates,
  sketchCoordinateInputs,
  SketchDrawingGeometry,
  type SketchDrawing,
  type SketchDrawingCurve,
} from './sketch-drawing';
import {
  endpointPosition,
  sketchDistance,
  snapSketchPointer,
  type SketchEndpoint,
  type SketchSnapContext,
} from './sketch-snap';
import type {SketchChange} from './sketch-source';

/** Center → start → end. Direction is explicit; no inferred branch survives in the source. */
export class SketchArcDrawing implements SketchDrawing {
  readonly name = 'Arc';
  start?: SketchEndpoint;
  private arcStart?: SketchEndpoint;
  private direction: SketchArcDirection = 'cw';
  private centerCoordinates: {axis: 'x' | 'y'; value: number}[] = [];
  private radius?: number;
  pointer: SketchPosition = [0, 0];
  dimensions = sketchCoordinateInputs();

  get title() {
    return this.arcStart
      ? `End point · ${this.direction.toUpperCase()}`
      : this.start
        ? 'Start point'
        : 'Center';
  }
  get hasDraft() {
    return !!this.start || this.dimensions.edited;
  }
  toggleDirection() {
    this.direction = this.direction === 'ccw' ? 'cw' : 'ccw';
  }

  resolve(context: SketchSnapContext) {
    const sweep = this.arcStart && this.dimensions.value('sweep');
    const curve =
      this.arcStart &&
      sketchArcGeometry(
        endpointPosition(this.start!),
        endpointPosition(this.arcStart),
        this.pointer,
        this.direction,
      );
    return snapSketchPointer(
      this.pointer,
      this.start
        ? {
            kind: 'polar',
            origin: endpointPosition(this.start),
            length: this.arcStart
              ? sketchDistance(
                  endpointPosition(this.start),
                  endpointPosition(this.arcStart),
                )
              : this.dimensions.value('radius'),
            direction:
              sweep !== undefined && curve
                ? {
                    kind: 'angle',
                    degrees:
                      (curve.start * 180) / Math.PI +
                      (this.direction === 'ccw' ? sweep : -sweep),
                  }
                : undefined,
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
    if (this.arcStart)
      return {
        sweep:
          (Math.abs(
            sketchArcGeometry(
              endpointPosition(this.start!),
              endpointPosition(this.arcStart),
              position,
              this.direction,
            ).sweep,
          ) *
            180) /
          Math.PI,
      };
    return this.start
      ? {radius: sketchDistance(endpointPosition(this.start), position)}
      : {x: position[0], y: position[1]};
  }
  preview(position: SketchPosition): readonly SketchDrawingCurve[] {
    if (!this.start) return [];
    const center = endpointPosition(this.start);
    if (!this.arcStart)
      return [
        {kind: 'circle', center, radius: sketchDistance(center, position)},
        {kind: 'line', points: [center, position]},
      ];
    const start = endpointPosition(this.arcStart);
    return [
      sketchArcGeometry(center, start, position, this.direction),
      {kind: 'line', points: [center, start]},
      {kind: 'line', points: [center, position]},
    ];
  }
  reset() {
    this.start = undefined;
    this.arcStart = undefined;
    this.radius = undefined;
    this.direction = 'cw';
    this.centerCoordinates = [];
    this.dimensions = sketchCoordinateInputs();
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
    const position = endpointPosition(endpoint);
    if (!position.every(Number.isFinite))
      return 'The resulting coordinates must be finite';
    if (!this.start) {
      this.start = endpoint;
      this.centerCoordinates = enteredSketchCoordinates(this.dimensions);
      this.dimensions = new DrawingDimensions([
        {id: 'radius', label: 'Radius', positive: true},
      ]);
      return;
    }
    const center = endpointPosition(this.start),
      radius = sketchDistance(center, position);
    if (!(radius > 0) || !Number.isFinite(radius))
      return 'Choose a positive finite radius';
    if (!this.arcStart) {
      this.arcStart = endpoint;
      this.radius = this.dimensions.value('radius');
      this.dimensions = new DrawingDimensions([
        {
          id: 'sweep',
          label: 'Sweep',
          unit: '°',
          positive: true,
          exclusiveMaximum: 360,
        },
      ]);
      return;
    }
    if (
      sketchDistance(endpointPosition(this.arcStart), position) <=
      radius * 1e-10
    )
      return 'Choose a distinct end point; use Circle for a full circle';
    const geometry = new SketchDrawingGeometry(layer, nextId);
    const c = geometry.point(this.start),
      a = geometry.point(this.arcStart),
      b = geometry.point(endpoint);
    const arc = geometry.arc(c, radius, a, b, this.direction);
    const constraints: SketchConstraint<SketchPointAddress>[] =
      this.centerCoordinates.map(({axis, value}) => [axis, c, value]);
    if (this.radius !== undefined)
      constraints.push(['radius', arc, this.radius]);
    const sweep = this.dimensions.value('sweep');
    if (sweep !== undefined) constraints.push(['sweep', arc, sweep]);
    if (!commit({kind: 'append', entries: geometry.entries, constraints}))
      return 'The sketch changed; the drawing was not applied';
    this.reset();
    return;
  }
}
