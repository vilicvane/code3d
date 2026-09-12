import {cylinder, frustum, union} from '@code3d/core';
import {
  metric,
  headedScrew,
  validateHead,
  hexSocket,
  clearanceHole as buildClearanceHole,
  type MetricSize,
  type HeadSpecification,
  type Screw,
  type ClearanceHole,
  type CounterboredHole,
  type ClearanceHoleOptions,
  type CounterboreOptions,
} from './common.js';
export type {
  ClearanceFit,
  ClearanceHoleOptions,
  CounterboreOptions,
  Screw,
  ClearanceHole,
  CounterboredHole,
  ScrewElements as SocketCapScrewElements,
  HoleElements as SocketCapHoleElements,
  CounterboredHoleElements as CounterboredSocketCapHoleElements,
} from './common.js';

export type Specification = HeadSpecification &
  Readonly<{
    hexSocketWidth: number;
    hexSocketDepth: number;
    counterboreDiameter: number;
  }>;

// ISO 4762 coarse-thread socket-head cap screws; millimetres.
// Clearance series follow ISO 273. Counterbores follow DIN 974-1 normal series.
function specification(
  size: MetricSize,
  headDiameter: number,
  headHeight: number,
  hexSocketWidth: number,
  hexSocketDepth: number,
  underHeadRadius: number,
  counterboreDiameter: number,
): Specification {
  return {
    ...metric(size),
    headDiameter,
    headHeight,
    hexSocketWidth,
    hexSocketDepth,
    underHeadRadius,
    counterboreDiameter,
  };
}
export const specifications = {
  M3: specification('M3', 5.5, 3, 2.5, 1.3, 0.1, 6),
  M4: specification('M4', 7, 4, 3, 2, 0.2, 8),
  M5: specification('M5', 8.5, 5, 4, 2.5, 0.2, 10),
  M6: specification('M6', 10, 6, 5, 3, 0.25, 11),
  M8: specification('M8', 13, 8, 6, 4, 0.4, 15),
  M10: specification('M10', 16, 10, 8, 5, 0.4, 18),
  M12: specification('M12', 18, 12, 10, 6, 0.6, 20),
} as const;

export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;

export type PlainClearanceHoleOptions = ClearanceHoleOptions &
  Readonly<{
    counterbore: false;
  }>;

export type CounterboredHoleOptions = Omit<
  ClearanceHoleOptions,
  'counterbore'
> &
  Readonly<{
    counterbore?: true | CounterboreOptions;
  }>;

/**
 * @code3d.arguments ['M6', 18]
 * @code3d.arguments ['M8', 30]
 * @code3d.param length {kind: 'length'}
 */
export function screw(input: ScrewInput, length: number): Screw {
  const spec = resolveSpecification(input);
  validateHead(spec);
  const headChamfer = Math.min(spec.pitch / 2, spec.headHeight * 0.12);
  const barrel = cylinder(spec.headDiameter / 2, spec.headHeight - headChamfer);
  const crown = frustum(
    spec.headDiameter / 2,
    spec.headDiameter / 2 - headChamfer,
    headChamfer,
  ).relate(part => part.on(barrel.up));
  const head = hexSocket(
    union([barrel, crown]),
    spec.hexSocketWidth,
    spec.hexSocketDepth,
    spec.headHeight,
  );
  return headedScrew(head, spec, length, threadLength(spec, length));
}

/**
 * @code3d.arguments ['M6', 10]
 * @code3d.arguments ['M6', {depth: 10, counterbore: false}]
 * @code3d.param depth {kind: 'length', constraints: {exclusiveMin: 0}}
 */
export function clearanceHole(
  input: ScrewInput,
  depth: number,
): CounterboredHole;
export function clearanceHole(
  input: ScrewInput,
  options: PlainClearanceHoleOptions,
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
  optionsOrDepth: ClearanceHoleOptions | number,
): ClearanceHole | CounterboredHole {
  return buildClearanceHole(resolveSpecification(input), optionsOrDepth, true);
}

export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'string' ? specifications[input] : input;
}

export function threadLength(spec: Specification, length: number): number {
  if (length <= 125) return 2 * spec.nominalDiameter + 12;
  if (length <= 200) return 2 * spec.nominalDiameter + 18;
  return 2 * spec.nominalDiameter + 31;
}
