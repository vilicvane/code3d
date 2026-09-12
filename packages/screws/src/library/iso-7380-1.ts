import {
  metric,
  validateHead,
  headedScrew,
  hexSocket,
  roundHead,
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

export type Specification = HeadSpecification &
  Readonly<{hexSocketWidth: number; hexSocketDepth: number}>;

// ISO 7380-1, k/dk maxima and nominal drive dimensions; millimetres.
// https://eshop-ro.boellhoff.com/out/media/pdf/ISO_7380-1_Stahl_10.9_Innensechskant___en.pdf
function specification(
  size: MetricSize,
  headDiameter: number,
  headHeight: number,
  hexSocketWidth: number,
  hexSocketDepth: number,
  underHeadRadius: number,
): Specification {
  return {
    ...metric(size),
    headDiameter,
    headHeight,
    hexSocketWidth,
    hexSocketDepth,
    underHeadRadius,
  };
}
export const specifications = {
  M3: specification('M3', 5.7, 1.65, 2, 1.04, 0.1),
  M4: specification('M4', 7.6, 2.2, 2.5, 1.3, 0.2),
  M5: specification('M5', 9.5, 2.75, 3, 1.56, 0.2),
  M6: specification('M6', 10.5, 3.3, 4, 2.08, 0.25),
  M8: specification('M8', 14, 4.4, 5, 2.6, 0.4),
  M10: specification('M10', 17.5, 5.5, 6, 3.12, 0.4),
  M12: specification('M12', 21, 6.6, 8, 4.16, 0.6),
} as const;
export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;
export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'string' ? specifications[input] : input;
}
/** Nominal partial thread b; the builder limits it to the available shank. */
export function threadLength(spec: Specification, _length: number): number {
  return 2 * spec.nominalDiameter + 12;
}
/**
 * @code3d.arguments ['M6', 18]
 * @code3d.param length {kind: 'length'}
 */
export function screw(input: ScrewInput, length: number): Screw {
  const spec = resolveSpecification(input);
  validateHead(spec);
  const blank = roundHead(
    spec.headDiameter,
    spec.headHeight,
    Math.max(spec.nominalDiameter, spec.hexSocketWidth * 1.3),
  );
  return headedScrew(
    hexSocket(blank, spec.hexSocketWidth, spec.hexSocketDepth, spec.headHeight),
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
