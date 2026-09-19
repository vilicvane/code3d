import {definePrimitive, replicad, type Sketch} from '@code3d/core/replicad';
import {resolveToothDimensions, type ToothDimensions} from './specification.js';

const flankSegments = 4;
const radiansToDegrees = 180 / Math.PI;

function involute(angle: number): number {
  return Math.tan(angle) - angle;
}

function polar(radius: number, angle: number): [number, number] {
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

function toothHalfAngle(
  radius: number,
  dimensions: ToothDimensions,
  teeth: number,
  kind: 'external' | 'internal',
): number {
  const profileRadius = Math.max(radius, dimensions.baseRadius);
  const profileAngle = Math.acos(dimensions.baseRadius / profileRadius);
  const change =
    involute(dimensions.transversePressureAngle) - involute(profileAngle);
  return Math.PI / (2 * teeth) + (kind === 'external' ? change : -change);
}

/** Polygonal chord approximation of the nominal involute flank. */
function toothBoundary(
  kind: 'external' | 'internal',
  dimensions: ToothDimensions,
  teeth: number,
): [number, number][] {
  const {baseRadius, tipRadius, rootRadius} = dimensions;
  const points: [number, number][] = [];
  const pitch = (2 * Math.PI) / teeth;
  const half = (radius: number) =>
    toothHalfAngle(radius, dimensions, teeth, kind);

  if (kind === 'external') {
    const start = Math.max(baseRadius, rootRadius);
    const rootHalf = half(start);
    for (let tooth = 0; tooth < teeth; tooth++) {
      const center = tooth * pitch;
      points.push(polar(rootRadius, center - rootHalf));
      for (let segment = 0; segment <= flankSegments; segment++) {
        const radius = start + ((tipRadius - start) * segment) / flankSegments;
        points.push(polar(radius, center - half(radius)));
      }
      points.push(polar(tipRadius, center));
      points.push(polar(tipRadius, center + half(tipRadius)));
      for (let segment = flankSegments - 1; segment >= 0; segment--) {
        const radius = start + ((tipRadius - start) * segment) / flankSegments;
        points.push(polar(radius, center + half(radius)));
      }
      points.push(polar(rootRadius, center + rootHalf));
      points.push(polar(rootRadius, center + pitch / 2));
    }
    return points;
  }

  const tipHalf = half(tipRadius);
  const rootHalf = half(rootRadius);
  for (let tooth = 0; tooth < teeth; tooth++) {
    const center = tooth * pitch;
    points.push(polar(tipRadius, center - tipHalf));
    points.push(polar(tipRadius, center));
    points.push(polar(tipRadius, center + tipHalf));
    for (let segment = 1; segment <= flankSegments; segment++) {
      const radius =
        tipRadius + ((rootRadius - tipRadius) * segment) / flankSegments;
      points.push(polar(radius, center + half(radius)));
    }
    points.push(polar(rootRadius, center + pitch / 2));
    points.push(polar(rootRadius, center + pitch - rootHalf));
    for (let segment = flankSegments - 1; segment >= 1; segment--) {
      const radius =
        tipRadius + ((rootRadius - tipRadius) * segment) / flankSegments;
      points.push(polar(radius, center + pitch - half(radius)));
    }
  }
  return points;
}

function buildToothSolid(
  kind: 'external' | 'internal',
  normalModule: number,
  teeth: number,
  faceWidth: number,
  helixAngle: number,
  handSign: number,
) {
  const dimensions = resolveToothDimensions(
    kind,
    normalModule,
    teeth,
    faceWidth,
    helixAngle,
  );
  const boundary = toothBoundary(kind, dimensions, teeth);
  const pen = replicad.draw(boundary[0]);
  for (const point of boundary.slice(1)) pen.lineTo(point);
  let sketch: Sketch | undefined = pen
    .close()
    .sketchOnPlane('XZ', [0, -faceWidth / 2, 0]) as Sketch;
  try {
    const twist =
      (faceWidth *
        Math.tan((helixAngle * Math.PI) / 180) *
        handSign *
        radiansToDegrees) /
      dimensions.pitchRadius;
    const solid = sketch.extrude(faceWidth, {
      extrusionDirection: [0, 1, 0],
      twistAngle: twist,
    });
    sketch = undefined; // Replicad transfers and consumes the sketch.
    return solid;
  } finally {
    sketch?.delete();
  }
}

export const toothSolid = definePrimitive(buildToothSolid);
