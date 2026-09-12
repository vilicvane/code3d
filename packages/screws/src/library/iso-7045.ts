import {
  metric,
  validateHead,
  headedScrew,
  panHead,
  crossSocket,
  clearanceHole as buildClearanceHole,
  type CrossRecessType,
  type CrossRecess,
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
  CrossRecessType,
  CrossRecess,
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

export type Specification = HeadSpecification &
  Readonly<{
    headCurvatureRadius: number;
    recesses: Readonly<Record<CrossRecessType, CrossRecess>>;
  }>;
export type ScrewOptions = Readonly<{recess?: CrossRecessType}>;
// ISO 7045:2011 (M3 and M5 heads differ from DIN 7985). H/Z driving envelopes.
// https://www.finesz.com/ISO7045.php
function specification(
  size: MetricSize,
  headDiameter: number,
  headHeight: number,
  headCurvatureRadius: number,
  underHeadRadius: number,
  number: number,
  width: number,
  hDiameter: number,
  hDepth: number,
  zDiameter: number,
  zDepth: number,
): Specification {
  return {
    ...metric(size),
    headDiameter,
    headHeight,
    headCurvatureRadius,
    underHeadRadius,
    recesses: {
      H: {number, width, diameter: hDiameter, depth: hDepth},
      Z: {number, width, diameter: zDiameter, depth: zDepth},
    },
  };
}
export const specifications = {
  M3: specification('M3', 5.6, 2.4, 5, 0.1, 1, 0.97, 3, 1.4, 2.8, 1.5),
  M4: specification('M4', 8, 3.1, 6.5, 0.2, 2, 1.47, 4.4, 1.9, 4.3, 1.89),
  M5: specification('M5', 9.5, 3.7, 8, 0.2, 2, 1.47, 4.9, 2.4, 4.7, 2.29),
  M6: specification('M6', 12, 4.6, 10, 0.25, 3, 2.41, 6.9, 3.1, 6.7, 3.03),
  M8: specification('M8', 16, 6, 13, 0.4, 4, 3.48, 9, 4, 8.8, 4.05),
  M10: specification('M10', 20, 7.5, 16, 0.4, 4, 3.48, 10.1, 5.2, 9.9, 5.24),
} as const;
export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;
export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'string' ? specifications[input] : input;
}
/** ISO minimum b; shorter screws are threaded to the head transition. */
export function threadLength(spec: Specification, _length: number): number {
  return spec.nominalDiameter <= 3 ? 25 : 38;
}
/**
 * @code3d.arguments ['M6', 18]
 * @code3d.param length {kind: 'length'}
 */
export function screw(
  input: ScrewInput,
  length: number,
  options: ScrewOptions = {},
): Screw {
  const spec = resolveSpecification(input);
  validateHead(spec);
  const type = options.recess ?? 'H';
  if (type !== 'H' && type !== 'Z')
    throw new Error('Cross recess type must be H or Z.');
  const recess = spec.recesses[type];
  if (recess.depth >= spec.headHeight || recess.width >= recess.diameter)
    throw new Error('Cross recess must fit inside the head.');
  const blank = panHead(
    spec.headDiameter,
    spec.headHeight,
    recess.diameter * 1.05,
    spec.headCurvatureRadius,
  );
  return headedScrew(
    crossSocket(blank, recess, type),
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
