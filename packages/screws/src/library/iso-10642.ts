import {frustum, union, type SolidModel} from '@code3d/core';
import {
  metric,
  validateHead,
  headedScrew,
  hexSocket,
  plainHole,
  atY,
  positive,
  type MetricSize,
  type HeadSpecification,
  type Screw,
  type ClearanceHole,
  type HoleElements,
  type ClearanceHoleOptions as CommonHoleOptions,
} from './common.js';
export type {
  ClearanceFit,
  Screw,
  ScrewElements,
  ClearanceHole,
  HoleElements,
} from './common.js';
import type {Bound} from '@code3d/core';

export type Specification = HeadSpecification &
  Readonly<{hexSocketWidth: number; hexSocketDepth: number; headAngle: 90}>;
// ISO 10642 dimensions (not the smaller DIN 7991 head), millimetres.
// https://www.vipafasteners.com/files/0/886-HEXAGON_SOCKET_COUNTERSUNK_HEAD_SCREWS_ISO_10642_UNI_5933_DIN_7991.pdf
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
    headAngle: 90,
  };
}
export const specifications = {
  M3: specification('M3', 6.72, 1.86, 2, 1.1, 0.1),
  M4: specification('M4', 8.96, 2.48, 2.5, 1.5, 0.2),
  M5: specification('M5', 11.2, 3.1, 3, 1.9, 0.2),
  M6: specification('M6', 13.44, 3.72, 4, 2.2, 0.25),
  M8: specification('M8', 17.92, 4.96, 5, 3, 0.4),
  M10: specification('M10', 22.4, 6.2, 6, 3.6, 0.4),
  M12: specification('M12', 26.88, 7.44, 8, 4.3, 0.6),
} as const;
export type Size = keyof typeof specifications;
export type ScrewInput = Size | Specification;
export type CountersinkOptions = Readonly<{diameter?: number}>;
export type ClearanceHoleOptions = Omit<CommonHoleOptions, 'counterbore'> &
  Readonly<{countersink?: boolean | CountersinkOptions}>;
export type PlainHoleOptions = ClearanceHoleOptions &
  Readonly<{countersink: false}>;
export type CountersunkHoleOptions = ClearanceHoleOptions &
  Readonly<{countersink?: true | CountersinkOptions}>;
export type CountersunkHoleElements = HoleElements &
  Readonly<{countersinkTop: Bound; countersinkBottom: Bound}>;
export type CountersunkHole = SolidModel<CountersunkHoleElements>;

export function resolveSpecification(input: ScrewInput): Specification {
  return typeof input === 'string' ? specifications[input] : input;
}
function validateCountersink(spec: Specification): void {
  if (
    spec.headAngle !== 90 ||
    Math.abs(spec.headDiameter - spec.nominalDiameter - 2 * spec.headHeight) >
      1e-6
  )
    throw new Error(
      'Countersunk head dimensions must define a 90-degree cone.',
    );
}
export function threadLength(spec: Specification, length: number): number {
  return (
    2 * spec.nominalDiameter + (length <= 125 ? 6 : length <= 200 ? 12 : 25)
  );
}
/**
 * Length includes the countersunk head.
 * @code3d.arguments ['M6', 20]
 * @code3d.param length {kind: 'length'}
 */
export function screw(input: ScrewInput, length: number): Screw {
  const spec = resolveSpecification(input);
  validateHead(spec);
  validateCountersink(spec);
  const blank = frustum(
    spec.nominalDiameter / 2,
    spec.headDiameter / 2,
    spec.headHeight,
  );
  const head = hexSocket(
    blank,
    spec.hexSocketWidth,
    spec.hexSocketDepth,
    spec.headHeight,
  );
  return headedScrew(
    head,
    spec,
    length - spec.headHeight,
    threadLength(spec, length),
  );
}

/** @code3d.arguments ['M6', 10] */
export function clearanceHole(
  input: ScrewInput,
  depth: number,
): CountersunkHole;
export function clearanceHole(
  input: ScrewInput,
  options: PlainHoleOptions,
): ClearanceHole;
export function clearanceHole(
  input: ScrewInput,
  options: CountersunkHoleOptions,
): CountersunkHole;
export function clearanceHole(
  input: ScrewInput,
  options: ClearanceHoleOptions,
): ClearanceHole | CountersunkHole;
export function clearanceHole(
  input: ScrewInput,
  optionsOrDepth: number | ClearanceHoleOptions,
): ClearanceHole | CountersunkHole {
  const spec = resolveSpecification(input);
  const options =
    typeof optionsOrDepth === 'number'
      ? {depth: optionsOrDepth}
      : optionsOrDepth;
  validateCountersink(spec);
  const shaft = plainHole(spec, options);
  if (options.countersink === false) return shaft;
  const sink =
    options.countersink === true || options.countersink === undefined
      ? {}
      : options.countersink;
  const diameter = sink.diameter ?? spec.headDiameter + 0.5;
  const shaftDiameter =
    options.diameter ?? spec.clearance[options.fit ?? 'normal'];
  positive('Countersink diameter', diameter);
  if (diameter < spec.headDiameter || diameter <= shaftDiameter)
    throw new Error(
      'Countersink must accommodate the screw head and exceed the shaft diameter.',
    );
  const depth =
    (diameter - shaftDiameter) /
    (2 * Math.tan((spec.headAngle * Math.PI) / 360));
  if (!Number.isFinite(depth) || depth <= 0 || depth > options.depth)
    throw new Error('Countersink depth must be within the total hole depth.');
  const recess = atY(
    frustum(shaftDiameter / 2, diameter / 2, depth),
    (options.depth - depth) / 2,
  );
  return union([shaft, recess]).expose({
    shaftTop: shaft.shaftTop,
    shaftBottom: shaft.shaftBottom,
    shaftAxis: shaft.shaftAxis,
    countersinkTop: recess.up,
    countersinkBottom: recess.down,
  });
}
