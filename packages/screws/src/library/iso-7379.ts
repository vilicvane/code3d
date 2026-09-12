import {
  cylinder,
  frustum,
  union,
  type Bound,
  type CanonicalElements,
  type LineAnchor,
  type SolidModel,
} from '@code3d/core';
import {
  metric,
  atY,
  externalThread,
  hexSocket,
  positive,
  validateHead,
  withCounterbore,
  type HeadSpecification,
  type MetricSize,
  type ClearanceHole,
  type ClearanceHoleOptions as CommonClearanceHoleOptions,
  type CounterboredHole,
  type CounterboreOptions,
} from './common.js';
export type {
  ClearanceHole,
  HoleElements,
  CounterboredHole,
  CounterboredHoleElements,
  CounterboreOptions,
} from './common.js';

export type Specification = HeadSpecification &
  Readonly<{
    shoulderDiameter: number;
    shoulderBodyDiameter: number;
    threadLength: number;
    neckDiameter: number;
    headReliefLength: number;
    threadReliefLength: number;
    hexSocketWidth: number;
    hexSocketDepth: number;
  }>;
// ISO 7379:1983, plain heads, maximum h8 shoulder diameter and nominal b.
// https://www.finesz.com/ISO7379.php
function specification(
  size: MetricSize,
  shoulderDiameter: number,
  shoulderBodyDiameter: number,
  threadLength: number,
  headDiameter: number,
  headHeight: number,
  neckDiameter: number,
  threadReliefLength: number,
  underHeadRadius: number,
  hexSocketWidth: number,
  hexSocketDepth: number,
): Specification {
  return {
    ...metric(size),
    shoulderDiameter,
    shoulderBodyDiameter,
    threadLength,
    headDiameter,
    headHeight,
    neckDiameter,
    headReliefLength: 2.5,
    threadReliefLength,
    underHeadRadius,
    hexSocketWidth,
    hexSocketDepth,
  };
}
export const specifications = {
  6.5: specification('M5', 6.5, 6.49, 9.5, 10, 4.5, 3.86, 2, 0.25, 3, 2.4),
  8: specification('M6', 8, 7.99, 11, 13, 5.5, 4.58, 2.5, 0.4, 4, 3.3),
  10: specification('M8', 10, 9.99, 13, 16, 7, 6.25, 3.1, 0.6, 5, 4.2),
  13: specification('M10', 13, 12.98, 16, 18, 9, 7.91, 3.7, 0.6, 6, 4.9),
  16: specification('M12', 16, 15.98, 18, 24, 11, 9.57, 4.4, 0.6, 8, 6.6),
} as const;
export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;
export type ScrewElements = CanonicalElements &
  Readonly<{
    headTop: Bound;
    headBottom: Bound;
    shoulderTop: Bound;
    shoulderBottom: Bound;
    shoulderAxis: LineAnchor;
    threadTop: Bound;
    threadBottom: Bound;
    threadAxis: LineAnchor;
  }>;
export type Screw = SolidModel<ScrewElements>;
export type ClearanceHoleOptions = Omit<CommonClearanceHoleOptions, 'fit'>;
export type PlainHoleOptions = ClearanceHoleOptions &
  Readonly<{counterbore?: false}>;
export type CounterboredHoleOptions = ClearanceHoleOptions &
  Readonly<{counterbore: true | CounterboreOptions}>;
export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'number' ? specifications[input] : input;
}
/**
 * Length is the shoulder length L; the fixed threaded projection b is additional.
 * @code3d.arguments [8, 20]
 * @code3d.param shoulderLength {kind: 'length'}
 */
export function screw(input: ScrewInput, shoulderLength: number): Screw {
  const spec = resolveSpecification(input);
  validateHead(spec);
  for (const key of [
    'shoulderDiameter',
    'shoulderBodyDiameter',
    'threadLength',
    'neckDiameter',
    'headReliefLength',
    'threadReliefLength',
  ] as const)
    positive(key, spec[key]);
  positive('Shoulder length', shoulderLength);
  if (shoulderLength <= spec.headReliefLength)
    throw new Error('Shoulder length must exceed the head relief length.');
  if (
    spec.shoulderBodyDiameter <= spec.nominalDiameter ||
    spec.shoulderBodyDiameter > spec.shoulderDiameter ||
    spec.shoulderDiameter >= spec.headDiameter
  )
    throw new Error(
      'Shoulder diameter must lie between thread and head diameters.',
    );
  if (
    spec.neckDiameter >= spec.nominalDiameter ||
    spec.threadLength - spec.threadReliefLength < spec.pitch
  )
    throw new Error(
      'Thread relief must leave a reduced neck and at least one thread pitch.',
    );
  const chamfer = Math.min(0.3, spec.headHeight / 10);
  const barrel = atY(
    cylinder(spec.headDiameter / 2, spec.headHeight - chamfer),
    (spec.headHeight - chamfer) / 2,
  );
  const crown = atY(
    frustum(spec.headDiameter / 2, spec.headDiameter / 2 - chamfer, chamfer),
    spec.headHeight - chamfer / 2,
  );
  const head = hexSocket(
    union([barrel, crown]),
    spec.hexSocketWidth,
    spec.hexSocketDepth,
    spec.headHeight,
  );
  const shoulderDatum = atY(
    cylinder(spec.shoulderBodyDiameter / 2, shoulderLength),
    -shoulderLength / 2,
  );
  const relief = atY(
    cylinder(
      spec.shoulderBodyDiameter / 2 - spec.underHeadRadius,
      spec.headReliefLength,
    ),
    -spec.headReliefLength / 2,
  );
  const shoulder = atY(
    cylinder(
      spec.shoulderBodyDiameter / 2,
      shoulderLength - spec.headReliefLength,
    ),
    -(shoulderLength + spec.headReliefLength) / 2,
  );
  const neck = atY(
    cylinder(spec.neckDiameter / 2, spec.threadReliefLength + 0.05),
    -shoulderLength - (spec.threadReliefLength + 0.05) / 2,
  );
  const thread = atY(
    externalThread(spec, spec.threadLength - spec.threadReliefLength),
    -shoulderLength - (spec.threadLength + spec.threadReliefLength) / 2,
  );
  return union([head, relief, shoulder, neck, thread]).expose({
    headTop: head.up,
    headBottom: head.down,
    shoulderTop: shoulderDatum.up,
    shoulderBottom: shoulderDatum.down,
    shoulderAxis: shoulderDatum.axis,
    threadTop: neck.up,
    threadBottom: thread.down,
    threadAxis: thread.axis,
  });
}
/**
 * Shoulder passage with 0.2 mm diametral clearance and an optional head recess.
 * @code3d.arguments [8, 10]
 */
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
  options: number | ClearanceHoleOptions,
): ClearanceHole | CounterboredHole;
export function clearanceHole(
  input: ScrewInput,
  depth: number | ClearanceHoleOptions,
): ClearanceHole | CounterboredHole {
  const spec = resolveSpecification(input);
  const options = typeof depth === 'number' ? {depth} : depth;
  positive('Hole depth', options.depth);
  const diameter = options.diameter ?? spec.shoulderDiameter + 0.2;
  positive('Clearance diameter', diameter);
  if (diameter <= spec.shoulderBodyDiameter)
    throw new Error(
      'Clearance diameter must exceed the shoulder body diameter.',
    );
  const shaft = cylinder(diameter / 2, options.depth);
  return withCounterbore(
    shaft.expose({
      shaftTop: shaft.up,
      shaftBottom: shaft.down,
      shaftAxis: shaft.axis,
    }),
    spec,
    options,
  );
}
