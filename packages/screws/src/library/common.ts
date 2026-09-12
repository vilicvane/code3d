import {
  offset,
  cylinder,
  cut,
  frustum,
  intersect,
  loft,
  rectangle,
  regularPrism,
  sphere,
  union,
  type Bound,
  type CanonicalElements,
  type LineAnchor,
  type SolidModel,
} from '@code3d/core';
import {helicalThread} from './thread.js';

export type ClearanceFit = 'close' | 'normal' | 'loose';
export type MetricSpecification = Readonly<{
  designation: string;
  nominalDiameter: number;
  pitch: number;
  clearance: Readonly<Record<ClearanceFit, number>>;
}>;

// ISO metric coarse pitches and ISO 273 clearance series, millimetres.
const metricDimensions = {
  M3: [3, 0.5, 3.2, 3.4, 3.6],
  M4: [4, 0.7, 4.3, 4.5, 4.8],
  M5: [5, 0.8, 5.3, 5.5, 5.8],
  M6: [6, 1, 6.4, 6.6, 7],
  M8: [8, 1.25, 8.4, 9, 10],
  M10: [10, 1.5, 10.5, 11, 12],
  M12: [12, 1.75, 13, 13.5, 14.5],
} as const;
export type MetricSize = keyof typeof metricDimensions;

export function metric(designation: MetricSize): MetricSpecification {
  const [nominalDiameter, pitch, close, normal, loose] =
    metricDimensions[designation];
  return {
    designation,
    nominalDiameter,
    pitch,
    clearance: {close, normal, loose},
  };
}

export type ShankElements = Readonly<{
  shankTop: Bound;
  shankBottom: Bound;
  shankAxis: LineAnchor;
}>;
export type ScrewElements = CanonicalElements &
  ShankElements &
  Readonly<{
    headTop: Bound;
    headBottom: Bound;
  }>;
export type Screw = SolidModel<ScrewElements>;
export type HoleElements = CanonicalElements &
  Readonly<{
    shaftTop: Bound;
    shaftBottom: Bound;
    shaftAxis: LineAnchor;
  }>;
export type CounterboredHoleElements = HoleElements &
  Readonly<{
    counterboreTop: Bound;
    counterboreBottom: Bound;
  }>;
export type ClearanceHole = SolidModel<HoleElements>;
export type CounterboredHole = SolidModel<CounterboredHoleElements>;

export type HeadSpecification = MetricSpecification &
  Readonly<{
    headDiameter: number;
    headHeight: number;
    underHeadRadius: number;
  }>;
export type CounterboreOptions = Readonly<{
  diameter?: number;
  depth?: number;
  axialClearance?: number;
}>;
export type ClearanceHoleOptions = Readonly<{
  depth: number;
  fit?: ClearanceFit;
  diameter?: number;
  counterbore?: boolean | CounterboreOptions;
}>;
export type PlainHoleOptions = ClearanceHoleOptions &
  Readonly<{counterbore?: false}>;
export type CounterboredHoleOptions = ClearanceHoleOptions &
  Readonly<{
    counterbore: true | CounterboreOptions;
  }>;

export function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive finite number.`);
}

export function validateMetric(spec: MetricSpecification): void {
  positive('Nominal diameter', spec.nominalDiameter);
  positive('Pitch', spec.pitch);
  if (spec.pitch >= spec.nominalDiameter)
    throw new Error('Pitch must be smaller than the nominal diameter.');
}

export function validateHead(spec: HeadSpecification): void {
  validateMetric(spec);
  positive('Head diameter', spec.headDiameter);
  positive('Head height', spec.headHeight);
  positive('Under-head radius', spec.underHeadRadius);
  if (spec.headDiameter <= spec.nominalDiameter)
    throw new Error('Head diameter must exceed the nominal diameter.');
}

/** Translate geometry within the package's common Y-axis frame. */
export function atY<T extends SolidModel>(model: T, y: number) {
  return model.originOffset(0, -y, 0);
}

export function externalThread(spec: MetricSpecification, length: number) {
  validateMetric(spec);
  positive('Thread length', length);
  const fundamentalHeight = (Math.sqrt(3) / 2) * spec.pitch;
  return helicalThread({
    pitch: spec.pitch,
    y: length,
    majorDiameter: spec.nominalDiameter,
    minorDiameter: spec.nominalDiameter - 2 * ((5 / 8) * fundamentalHeight),
    rootWidth: (3 / 4) * spec.pitch,
    crestWidth: (1 / 8) * spec.pitch,
  });
}

/** Shaft top is Y=0; its tip is Y=-length, including the blended ends. */
export function shank(
  spec: MetricSpecification,
  length: number,
  threadedLength: number,
  radius: number,
) {
  positive('Screw length', length);
  positive('Thread length', threadedLength);
  if (length <= spec.pitch + radius)
    throw new Error(
      'Screw length must leave room for at least one full thread pitch.',
    );
  const bodyLength = length - radius;
  const threadLength = Math.min(bodyLength, threadedLength);
  const plainLength = bodyLength - threadLength;
  const overlap = Math.min(0.08, spec.pitch / 10);
  const transition = atY(
    frustum(
      spec.nominalDiameter / 2,
      spec.nominalDiameter / 2 + radius,
      radius,
    ),
    -radius / 2,
  );
  const parts: SolidModel[] = [transition];
  if (plainLength > 0)
    parts.push(
      atY(
        cylinder(spec.nominalDiameter / 2, plainLength + overlap),
        -radius - plainLength / 2 + overlap / 2,
      ),
    );
  const thread = atY(
    externalThread(spec, threadLength + overlap),
    -length + (threadLength + overlap) / 2,
  );
  parts.push(thread);
  return union(parts).expose({
    shankTop: transition.up,
    shankBottom: thread.down,
    shankAxis: thread.axis,
  });
}

export function headedScrew(
  head: SolidModel,
  spec: HeadSpecification,
  length: number,
  threadedLength: number,
): Screw {
  validateHead(spec);
  const shaft = shank(
    spec,
    length,
    threadedLength,
    spec.underHeadRadius,
  ).relate(part => part.on(head.down));
  return union([head, shaft]).expose({
    headTop: head.up,
    headBottom: head.down,
    shankTop: shaft.shankTop,
    shankBottom: shaft.shankBottom,
    shankAxis: shaft.shankAxis,
  });
}

export function hexSocket(
  head: SolidModel,
  width: number,
  depth: number,
  height: number,
): SolidModel {
  positive('Hex socket width', width);
  positive('Hex socket depth', depth);
  if (depth >= height)
    throw new Error('Hex socket depth must be smaller than the head height.');
  const tool = regularPrism(width / Math.sqrt(3), depth + 0.2, 6, 30).relate(
    part => [part.down.on(head.up), offset(0, -depth, 0)],
  );
  return cut(head, [tool]);
}

/** Spherical head with a small flat crown surrounding the driving recess. */
export function roundHead(
  diameter: number,
  height: number,
  crownDiameter: number,
): SolidModel {
  positive('Head diameter', diameter);
  positive('Head height', height);
  positive('Crown diameter', crownDiameter);
  if (crownDiameter >= diameter)
    throw new Error('Crown diameter must be smaller than the head diameter.');
  const radius = diameter / 2;
  const crown = crownDiameter / 2;
  const center =
    (height * height + crown * crown - radius * radius) / (2 * height);
  const ball = atY(sphere(Math.hypot(radius, center)), center - height / 2);
  return intersect([cylinder(radius, height), ball]);
}

export function panHead(
  diameter: number,
  height: number,
  crownDiameter: number,
  curvatureRadius: number,
): SolidModel {
  positive('Head curvature radius', curvatureRadius);
  if (curvatureRadius <= diameter / 2)
    throw new Error(
      'Head curvature radius must exceed half the head diameter.',
    );
  const capHeight =
    Math.sqrt(curvatureRadius ** 2 - (crownDiameter / 2) ** 2) -
    Math.sqrt(curvatureRadius ** 2 - (diameter / 2) ** 2);
  if (!Number.isFinite(capHeight) || capHeight <= 0 || capHeight >= height)
    throw new Error('Pan head crown must leave a cylindrical barrel.');
  const barrel = cylinder(diameter / 2, height - capHeight);
  const cap = atY(roundHead(diameter, capHeight, crownDiameter), height / 2);
  return union([barrel, cap]);
}

export type CrossRecessType = 'H' | 'Z';
export type CrossRecess = Readonly<{
  number: number;
  diameter: number;
  depth: number;
  width: number;
}>;

/** Tapered cruciform drive; type Z adds its four intermediate ribs. */
export function crossSocket(
  head: SolidModel,
  recess: CrossRecess,
  type: CrossRecessType,
): SolidModel {
  const {diameter, depth, width} = recess;
  positive('Cross recess diameter', diameter);
  positive('Cross recess depth', depth);
  positive('Cross recess width', width);
  const bottom = rectangle(width * 0.7, diameter * 0.5);
  const top = rectangle(width, diameter).originOffset(0, -depth, 0);
  const wing = loft([bottom, top]);
  const tools = [wing, wing.rotate(0, 90, 0)];
  if (type === 'Z') {
    const rib = loft([
      rectangle(width * 0.2, diameter * 0.45),
      rectangle(width * 0.35, diameter * 0.85).originOffset(0, -depth, 0),
    ]);
    tools.push(rib.rotate(0, 45, 0), rib.rotate(0, 135, 0));
  }
  const tool = union(tools).relate(part => part.up.on(head.up));
  return cut(head, [tool]);
}

export function plainHole(
  spec: MetricSpecification,
  options: Omit<ClearanceHoleOptions, 'counterbore'>,
): ClearanceHole {
  validateMetric(spec);
  positive('Hole depth', options.depth);
  const diameter = options.diameter ?? spec.clearance[options.fit ?? 'normal'];
  positive('Clearance diameter', diameter);
  if (diameter <= spec.nominalDiameter)
    throw new Error(
      'Clearance-hole diameter must exceed the nominal screw diameter.',
    );
  const shaft = cylinder(diameter / 2, options.depth);
  return shaft.expose({
    shaftTop: shaft.up,
    shaftBottom: shaft.down,
    shaftAxis: shaft.axis,
  });
}

export function clearanceHole(
  spec: HeadSpecification & {counterboreDiameter?: number},
  optionsOrDepth: number | ClearanceHoleOptions,
  defaultCounterbore = false,
): ClearanceHole | CounterboredHole {
  const options =
    typeof optionsOrDepth === 'number'
      ? {depth: optionsOrDepth}
      : optionsOrDepth;
  return withCounterbore(
    plainHole(spec, options),
    spec,
    options,
    defaultCounterbore,
  );
}

/** Add a head recess to a centered Y-axis passage, preserving its references. */
export function withCounterbore(
  shaft: ClearanceHole,
  spec: Pick<HeadSpecification, 'headDiameter' | 'headHeight'> &
    Readonly<{counterboreDiameter?: number}>,
  options: Pick<ClearanceHoleOptions, 'depth' | 'counterbore'>,
  defaultCounterbore = false,
): ClearanceHole | CounterboredHole {
  const counterboreOption = options.counterbore ?? defaultCounterbore;
  if (counterboreOption === false) return shaft;
  const counterbore = counterboreOption === true ? {} : counterboreOption;
  const axialClearance = counterbore.axialClearance ?? 0.5;
  if (!Number.isFinite(axialClearance) || axialClearance < 0)
    throw new Error('Axial clearance must be a nonnegative finite number.');
  const depth = counterbore.depth ?? spec.headHeight + axialClearance;
  const diameter =
    counterbore.diameter ?? spec.counterboreDiameter ?? spec.headDiameter + 1;
  positive('Counterbore depth', depth);
  positive('Counterbore diameter', diameter);
  if (depth > options.depth)
    throw new Error('Counterbore depth must be within the total hole depth.');
  if (diameter < spec.headDiameter)
    throw new Error('Counterbore diameter must accommodate the screw head.');
  const recess = atY(
    cylinder(diameter / 2, depth),
    (options.depth - depth) / 2,
  );
  return union([shaft, recess]).expose({
    shaftTop: shaft.shaftTop,
    shaftBottom: shaft.shaftBottom,
    shaftAxis: shaft.shaftAxis,
    counterboreTop: recess.up,
    counterboreBottom: recess.down,
  });
}
