import {cylinder, union} from '@code3d/core';
import {
  metric,
  validateHead,
  positive,
  atY,
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
  Readonly<{
    hexSocketWidth: number;
    hexSocketDepth: number;
    buttonDiameter: number;
    collarHeight: number;
  }>;

// ISO 7380-2:2022, collar diameter dc, button diameter dk and total head height k.
// https://www.iso.org/standard/78700.html
// https://eshop-cz.boellhoff.com/out/media/pdf/ISO_7380-2_Edelstahl_A2_Innensechskant___en.pdf
function specification(
  size: MetricSize,
  headDiameter: number,
  buttonDiameter: number,
  headHeight: number,
  collarHeight: number,
  hexSocketWidth: number,
  hexSocketDepth: number,
  underHeadRadius: number,
): Specification {
  return {
    ...metric(size),
    headDiameter,
    buttonDiameter,
    headHeight,
    collarHeight,
    hexSocketWidth,
    hexSocketDepth,
    underHeadRadius,
  };
}
export const specifications = {
  M3: specification('M3', 6.9, 5.2, 1.65, 0.7, 2, 1.04, 0.1),
  M4: specification('M4', 9.4, 7.2, 2.2, 0.8, 2.5, 1.3, 0.2),
  M5: specification('M5', 11.8, 8.8, 2.75, 1, 3, 1.56, 0.2),
  M6: specification('M6', 13.6, 10, 3.3, 1.2, 4, 2.08, 0.25),
  M8: specification('M8', 17.8, 13.2, 4.4, 1.5, 5, 2.6, 0.4),
  M10: specification('M10', 21.9, 16.5, 5.5, 2, 6, 3.12, 0.4),
  M12: specification('M12', 26, 19.4, 6.6, 2.4, 8, 4.16, 0.6),
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
  positive('Collar height', spec.collarHeight);
  positive('Button diameter', spec.buttonDiameter);
  if (
    spec.collarHeight >= spec.headHeight ||
    spec.buttonDiameter >= spec.headDiameter
  )
    throw new Error('Button and collar must fit the head envelope.');
  const collar = cylinder(spec.headDiameter / 2, spec.collarHeight);
  const crown = atY(
    roundHead(
      spec.buttonDiameter,
      spec.headHeight - spec.collarHeight,
      Math.max(spec.nominalDiameter, spec.hexSocketWidth * 1.3),
    ),
    spec.headHeight / 2,
  );
  const blank = union([collar, crown]);
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
