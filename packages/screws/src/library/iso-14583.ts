import {cut} from '@code3d/core';
import {
  definePrimitive,
  replicad,
  type Point2D,
  type Sketch,
} from '@code3d/core/replicad';
import {
  metric,
  validateHead,
  headedScrew,
  panHead,
  positive,
  clearanceHole as buildClearanceHole,
  type HeadSpecification,
  type MetricSize,
  type Screw,
  type ClearanceHole,
  type CounterboredHole,
  type ClearanceHoleOptions,
  type PlainHoleOptions,
  type CounterboredHoleOptions,
} from './common.js';
export type {
  ClearanceFit,
  Screw,
  ScrewElements,
  ClearanceHole,
  HoleElements,
  CounterboredHole,
  CounterboredHoleElements,
  ClearanceHoleOptions,
  PlainHoleOptions,
  CounterboredHoleOptions,
  CounterboreOptions,
} from './common.js';

export type HexalobularRecess = Readonly<{
  number: number;
  diameter: number;
  innerDiameter: number;
  depth: number;
}>;
export type Specification = HeadSpecification &
  Readonly<{headCurvatureRadius: number; recess: HexalobularRecess}>;
// ISO 14583:2011 head dimensions and minimum recess penetration.
// https://www.finesz.com/ISO14583.php
// ISO 10664:2014 nominal driving envelopes A/B (size 45 A = 7.93).
function specification(
  size: MetricSize,
  headDiameter: number,
  headHeight: number,
  headCurvatureRadius: number,
  underHeadRadius: number,
  number: number,
  diameter: number,
  innerDiameter: number,
  depth: number,
): Specification {
  return {
    ...metric(size),
    headDiameter,
    headHeight,
    headCurvatureRadius,
    underHeadRadius,
    recess: {number, diameter, innerDiameter, depth},
  };
}
export const specifications = {
  M3: specification('M3', 5.6, 2.4, 5, 0.1, 10, 2.8, 2.05, 1.01),
  M4: specification('M4', 8, 3.1, 6.5, 0.2, 20, 3.95, 2.85, 1.27),
  M5: specification('M5', 9.5, 3.7, 8, 0.2, 25, 4.5, 3.25, 1.52),
  M6: specification('M6', 12, 4.6, 10, 0.25, 30, 5.6, 4.05, 2.02),
  M8: specification('M8', 16, 6, 13, 0.4, 45, 7.93, 5.64, 2.79),
  M10: specification('M10', 20, 7.5, 16, 0.4, 50, 8.95, 6.45, 3.62),
} as const;
export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;
export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'string' ? specifications[input] : input;
}
export function threadLength(spec: Specification, _length: number): number {
  return spec.nominalDiameter <= 3 ? 25 : 38;
}

/** Nominal representation: twelve tangent circular arcs, not an inspection gauge. */
const hexalobularTool = definePrimitive(
  (diameter: number, innerDiameter: number, depth: number) => {
    positive('Recess diameter', diameter);
    positive('Inner recess diameter', innerDiameter);
    positive('Recess depth', depth);
    const a = diameter / 2,
      b = innerDiameter / 2,
      re = diameter * 0.1;
    const p = a - re,
      c = Math.cos(Math.PI / 6);
    const ri =
      (re ** 2 - p ** 2 - b ** 2 + 2 * p * b * c) / (2 * (b - p * c - re));
    positive('Recess inner arc radius', ri);
    const radial = (radius: number, angle: number): Point2D => [
      radius * Math.cos(angle),
      radius * Math.sin(angle),
    ];
    const tangent = (angle: number, side: number): Point2D => {
      const outer = radial(p, angle),
        inner = radial(b + ri, angle + (side * Math.PI) / 6);
      return [
        outer[0] + (re / (re + ri)) * (inner[0] - outer[0]),
        outer[1] + (re / (re + ri)) * (inner[1] - outer[1]),
      ];
    };
    const start = tangent(0, -1);
    const drawing = replicad.draw(start);
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      drawing.threePointsArcTo(tangent(angle, 1), radial(a, angle));
      drawing.threePointsArcTo(
        i === 5 ? start : tangent(angle + Math.PI / 3, -1),
        radial(b, angle + Math.PI / 6),
      );
    }
    const profile = drawing.close();
    return (profile.sketchOnPlane('XY') as Sketch)
      .extrude(depth)
      .rotate(-90, [0, 0, 0], [1, 0, 0])
      .translate([0, -depth / 2, 0]);
  },
);

/**
 * @code3d.arguments ['M6', 18]
 * @code3d.param length {kind: 'length'}
 */
export function screw(input: ScrewInput, length: number): Screw {
  const spec = resolveSpecification(input);
  validateHead(spec);
  const recess = spec.recess;
  if (
    recess.innerDiameter >= recess.diameter ||
    recess.diameter >= spec.headDiameter ||
    recess.depth >= spec.headHeight
  )
    throw new Error('Recess must fit inside the head.');
  const head = panHead(
    spec.headDiameter,
    spec.headHeight,
    recess.diameter * 1.05,
    spec.headCurvatureRadius,
  );
  const tool = hexalobularTool(
    recess.diameter,
    recess.innerDiameter,
    recess.depth,
  ).relate(part => part.up.on(head.up));
  return headedScrew(
    cut(head, [tool]),
    spec,
    length,
    threadLength(spec, length),
  );
}
/** @code3d.arguments ['M6', 10] */
export function clearanceHole(input: ScrewInput, depth: number): ClearanceHole;
export function clearanceHole(
  input: ScrewInput,
  options: PlainHoleOptions,
): ClearanceHole;
export function clearanceHole(
  input: ScrewInput,
  options: CounterboredHoleOptions,
): CounterboredHole;
export function clearanceHole(
  input: ScrewInput,
  options: ClearanceHoleOptions,
): ClearanceHole | CounterboredHole;
export function clearanceHole(
  input: ScrewInput,
  options: number | ClearanceHoleOptions,
): ClearanceHole | CounterboredHole {
  return buildClearanceHole(resolveSpecification(input), options);
}
