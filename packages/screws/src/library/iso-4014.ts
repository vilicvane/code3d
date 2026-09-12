import {
  headedScrew,
  clearanceHole as buildClearanceHole,
  type Screw,
  type ClearanceHole,
  type CounterboredHole,
  type ClearanceHoleOptions,
  type PlainHoleOptions,
  type CounterboredHoleOptions,
} from './common.js';
import {hexHead, specifications, type Specification} from './hex-head.js';
export {specifications};
export type {Specification};
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
export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;
export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'string' ? specifications[input] : input;
}
export function threadLength(spec: Specification, length: number): number {
  return (
    2 * spec.nominalDiameter + (length <= 125 ? 6 : length <= 200 ? 12 : 25)
  );
}
/**
 * @code3d.arguments ['M6', 30]
 * @code3d.param length {kind: 'length'}
 */
export function screw(input: ScrewInput, length: number): Screw {
  const spec = resolveSpecification(input);
  return headedScrew(hexHead(spec), spec, length, threadLength(spec, length));
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
