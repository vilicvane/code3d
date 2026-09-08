import type {
  SketchPosition,
  SketchPointAddress,
  SketchConstraint,
} from '@code3d/core/tooling';
import {DrawingDimensions} from './drawing-dimensions';
import {
  SketchDrawingGeometry,
  sketchCoordinateInputs,
  enteredSketchCoordinates,
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

/** A center/radius tool; a clicked circumference point does not create a point entity. */
export class SketchCircleDrawing implements SketchDrawing {
  readonly name = 'Circle';
  start?: SketchEndpoint;
  pointer: SketchPosition = [0, 0];
  dimensions = sketchCoordinateInputs();
  private centerCoordinates: {axis: 'x' | 'y'; value: number}[] = [];

  get title() {
    return this.start ? 'Radius' : 'Center';
  }
  get hasDraft() {
    return !!this.start || this.dimensions.edited;
  }

  resolve(context: SketchSnapContext) {
    return snapSketchPointer(
      this.pointer,
      this.start
        ? {
            kind: 'polar',
            origin: endpointPosition(this.start),
            length: this.dimensions.value('radius'),
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
    return this.start
      ? {radius: sketchDistance(endpointPosition(this.start), position)}
      : {x: position[0], y: position[1]};
  }
  preview(position: SketchPosition): readonly SketchDrawingCurve[] {
    if (!this.start) return [];
    const center = endpointPosition(this.start);
    return [
      {kind: 'circle', center, radius: sketchDistance(center, position)},
      {kind: 'line', points: [center, position]},
    ];
  }
  reset() {
    this.start = undefined;
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
      return undefined;
    }
    const radius = sketchDistance(endpointPosition(this.start), position);
    if (!(radius > 0) || !Number.isFinite(radius))
      return 'Choose a positive finite radius';
    const geometry = new SketchDrawingGeometry(layer, nextId);
    const center = geometry.point(this.start);
    const circle = geometry.circle(center, radius);
    const constraints: SketchConstraint<SketchPointAddress>[] =
      this.centerCoordinates.map(({axis, value}) => [axis, center, value]);
    const enteredRadius = this.dimensions.value('radius');
    if (enteredRadius !== undefined)
      constraints.push(['radius', circle, enteredRadius]);
    if (!commit({kind: 'append', entries: geometry.entries, constraints}))
      return 'The sketch changed; the drawing was not applied';
    this.reset();
    return undefined;
  }
}
