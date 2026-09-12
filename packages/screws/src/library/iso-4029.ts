import {
  cut,
  frustum,
  intersect,
  type Bound,
  type CanonicalElements,
  type LineAnchor,
  type SolidModel,
} from '@code3d/core';
import {definePrimitive, replicad, type Sketch} from '@code3d/core/replicad';
import {
  metric,
  externalThread,
  hexSocket,
  atY,
  positive,
  type MetricSize,
  type MetricSpecification,
} from './common.js';

export type Specification = MetricSpecification &
  Readonly<{
    hexSocketWidth: number;
    hexSocketDepth: number;
    cupDiameter: number;
  }>;
// ISO 4029 cup-point set screws, nominal driving width and minimum socket depth.
// https://www.jcfasteners.com/wp-content/uploads/DIN-916-Grub-Screw-Cup-PT-B4A07-SS304.pdf
function specification(
  size: MetricSize,
  hexSocketWidth: number,
  hexSocketDepth: number,
  cupDiameter: number,
): Specification {
  return {...metric(size), hexSocketWidth, hexSocketDepth, cupDiameter};
}
export const specifications = {
  M3: specification('M3', 1.5, 1.2, 1.4),
  M4: specification('M4', 2, 1.5, 2),
  M5: specification('M5', 2.5, 2, 2.5),
  M6: specification('M6', 3, 2, 3),
  M8: specification('M8', 4, 3, 5),
  M10: specification('M10', 5, 4, 6),
  M12: specification('M12', 6, 4.8, 8),
} as const;
export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;
export type ScrewElements = CanonicalElements &
  Readonly<{driveTop: Bound; pointBottom: Bound; threadAxis: LineAnchor}>;
export type Screw = SolidModel<ScrewElements>;
export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'string' ? specifications[input] : input;
}
const cupTool = definePrimitive((radius: number, depth: number) => {
  const profile = replicad
    .draw([0, 0])
    .lineTo([radius, 0])
    .lineTo([0, depth])
    .close();
  return (profile.sketchOnPlane('XZ') as Sketch)
    .revolve([0, 0, 1])
    .rotate(-90, [0, 0, 0], [1, 0, 0])
    .translate([0, -depth / 2, 0]);
});
/**
 * Length is the complete headless screw, including its cup point.
 * @code3d.arguments ['M6', 10]
 * @code3d.param length {kind: 'length'}
 */
export function screw(input: ScrewInput, length: number): Screw {
  const spec = resolveSpecification(input);
  positive('Screw length', length);
  positive('Cup diameter', spec.cupDiameter);
  if (spec.cupDiameter >= spec.nominalDiameter)
    throw new Error('Cup diameter must be smaller than the nominal diameter.');
  const cupRadius = spec.cupDiameter / 2;
  const cupDepth = cupRadius / Math.sqrt(3);
  if (length <= spec.hexSocketDepth + cupDepth + spec.pitch)
    throw new Error(
      'Screw length must separate the socket from the cup point.',
    );
  const thread = externalThread(spec, length);
  const outerPoint = frustum(cupRadius, cupRadius + length, length);
  const blank = intersect([thread, outerPoint]);
  const driven = hexSocket(
    blank,
    spec.hexSocketWidth,
    spec.hexSocketDepth,
    length,
  );
  // A narrow annular lip remains at the end of the external point chamfer.
  const cup = atY(
    cupTool(cupRadius * 0.85, cupDepth),
    -length / 2 + cupDepth / 2,
  );
  return cut(driven, [cup]).expose({
    driveTop: thread.up,
    pointBottom: thread.down,
    threadAxis: thread.axis,
  });
}
