export const metricFastenerLibrarySource = `import {
  cylinder,
  cut,
  frustum,
  helicalThread,
  regularPrism,
  union,
  type ModelObject,
} from 'code3d';

export type ClearanceFit = 'close' | 'normal' | 'loose';

export type SocketCapScrewSpec = Readonly<{
  designation: string;
  nominalDiameter: number;
  pitch: number;
  headDiameter: number;
  headHeight: number;
  hexSocketWidth: number;
  hexSocketDepth: number;
  underHeadRadius: number;
  clearance: Readonly<Record<ClearanceFit, number>>;
  counterboreDiameter: number;
}>;

// ISO 4762 coarse-thread socket-head cap screws; millimetres.
// Clearance series follow ISO 273. Counterbores follow DIN 974-1 normal series.
export const socketCapScrewSpecs = {
  M3: {
    designation: 'M3',
    nominalDiameter: 3,
    pitch: 0.5,
    headDiameter: 5.5,
    headHeight: 3,
    hexSocketWidth: 2.5,
    hexSocketDepth: 1.3,
    underHeadRadius: 0.1,
    clearance: {close: 3.2, normal: 3.4, loose: 3.6},
    counterboreDiameter: 6,
  },
  M4: {
    designation: 'M4',
    nominalDiameter: 4,
    pitch: 0.7,
    headDiameter: 7,
    headHeight: 4,
    hexSocketWidth: 3,
    hexSocketDepth: 2,
    underHeadRadius: 0.2,
    clearance: {close: 4.3, normal: 4.5, loose: 4.8},
    counterboreDiameter: 8,
  },
  M5: {
    designation: 'M5',
    nominalDiameter: 5,
    pitch: 0.8,
    headDiameter: 8.5,
    headHeight: 5,
    hexSocketWidth: 4,
    hexSocketDepth: 2.5,
    underHeadRadius: 0.2,
    clearance: {close: 5.3, normal: 5.5, loose: 5.8},
    counterboreDiameter: 10,
  },
  M6: {
    designation: 'M6',
    nominalDiameter: 6,
    pitch: 1,
    headDiameter: 10,
    headHeight: 6,
    hexSocketWidth: 5,
    hexSocketDepth: 3,
    underHeadRadius: 0.25,
    clearance: {close: 6.4, normal: 6.6, loose: 7},
    counterboreDiameter: 11,
  },
  M8: {
    designation: 'M8',
    nominalDiameter: 8,
    pitch: 1.25,
    headDiameter: 13,
    headHeight: 8,
    hexSocketWidth: 6,
    hexSocketDepth: 4,
    underHeadRadius: 0.4,
    clearance: {close: 8.4, normal: 9, loose: 10},
    counterboreDiameter: 15,
  },
  M10: {
    designation: 'M10',
    nominalDiameter: 10,
    pitch: 1.5,
    headDiameter: 16,
    headHeight: 10,
    hexSocketWidth: 8,
    hexSocketDepth: 5,
    underHeadRadius: 0.4,
    clearance: {close: 10.5, normal: 11, loose: 12},
    counterboreDiameter: 18,
  },
  M12: {
    designation: 'M12',
    nominalDiameter: 12,
    pitch: 1.75,
    headDiameter: 18,
    headHeight: 12,
    hexSocketWidth: 10,
    hexSocketDepth: 6,
    underHeadRadius: 0.6,
    clearance: {close: 13, normal: 13.5, loose: 14.5},
    counterboreDiameter: 20,
  },
} as const satisfies Readonly<Record<string, SocketCapScrewSpec>>;

export type SocketCapScrewPreset = keyof typeof socketCapScrewSpecs;
export type SocketCapScrewInput = SocketCapScrewPreset | SocketCapScrewSpec;

export type SocketCapHoleOptions = Readonly<{
  depth: number;
  fit?: ClearanceFit;
  diameter?: number;
  counterbore?:
    | boolean
    | Readonly<{
        diameter?: number;
        depth?: number;
        axialClearance?: number;
      }>;
}>;

/**
 * @code3d.arguments ['M6', 18]
 * @code3d.arguments ['M8', 30]
 */
export function socketCapScrew(
  input: SocketCapScrewInput,
  length: number,
): ModelObject {
  const spec = resolveSocketCapScrewSpec(input);
  validateSpec(spec);
  if (!Number.isFinite(length) || length <= spec.pitch + spec.underHeadRadius) {
    throw new Error('Screw length must leave room for at least one full thread pitch.');
  }

  const headChamfer = Math.min(spec.pitch / 2, spec.headHeight * 0.12);
  const headBarrel = cylinder(
    spec.headDiameter / 2,
    spec.headHeight - headChamfer,
  );
  const headTop = frustum(
    spec.headDiameter / 2,
    spec.headDiameter / 2 - headChamfer,
    headChamfer,
  ).relate(top => top.bottom.on(headBarrel.top));
  const headBlank = union(headBarrel, headTop);

  const socketToolHeight = spec.hexSocketDepth + 0.2;
  const socketTool = regularPrism(
    spec.hexSocketWidth / Math.sqrt(3),
    socketToolHeight,
    6,
    30,
  ).relate(tool =>
    tool.center
      .on(headBlank.top)
      .offset(0, -spec.hexSocketDepth / 2 + 0.1, 0),
  );
  const head = cut(headBlank, socketTool).named(spec.designation + ' socket head');

  const transition = frustum(
    spec.nominalDiameter / 2,
    spec.nominalDiameter / 2 + spec.underHeadRadius,
    spec.underHeadRadius,
  ).relate(part => part.top.on(head.bottom));
  const bodyLength = length - spec.underHeadRadius;
  const threadLength = Math.min(bodyLength, referenceThreadLength(spec, length));
  const plainLength = bodyLength - threadLength;
  const overlap = Math.min(0.08, spec.pitch / 10);
  const parts: ModelObject[] = [head, transition];
  let previous = transition;

  if (plainLength > overlap) {
    const shank = cylinder(
      spec.nominalDiameter / 2,
      plainLength + overlap,
    ).relate(part => part.top.on(previous.bottom).offset(0, -overlap, 0));
    parts.push(shank);
    previous = shank;
  }

  const fundamentalHeight = (Math.sqrt(3) / 2) * spec.pitch;
  const minorDiameter =
    spec.nominalDiameter - 2 * ((5 / 8) * fundamentalHeight);
  const thread = helicalThread({
    pitch: spec.pitch,
    height: threadLength + overlap,
    majorDiameter: spec.nominalDiameter,
    minorDiameter,
    rootWidth: (3 / 4) * spec.pitch,
    crestWidth: (1 / 8) * spec.pitch,
  }).relate(part => part.top.on(previous.bottom).offset(0, -overlap, 0));
  parts.push(thread);

  return union(parts[0], ...parts.slice(1)).named(
    spec.designation + ' × ' + length + ' socket cap screw',
  );
}

/**
 * @code3d.arguments ['M6', {depth: 10, fit: 'normal', counterbore: true}]
 */
export function socketCapHole(
  input: SocketCapScrewInput,
  options: SocketCapHoleOptions,
): ModelObject {
  const spec = resolveSocketCapScrewSpec(input);
  validateSpec(spec);
  if (!Number.isFinite(options.depth) || options.depth <= 0) {
    throw new Error('Hole depth must be a positive finite number.');
  }
  const fit = options.fit ?? 'normal';
  const diameter = options.diameter ?? spec.clearance[fit];
  if (!Number.isFinite(diameter) || diameter <= spec.nominalDiameter) {
    throw new Error('Clearance-hole diameter must exceed the nominal screw diameter.');
  }
  const shaft = cylinder(diameter / 2, options.depth);
  if (!options.counterbore) {
    return shaft.named(spec.designation + ' ' + fit + ' clearance hole');
  }

  const counterbore =
    options.counterbore === true ? {} : options.counterbore;
  const axialClearance = counterbore.axialClearance ?? 0.5;
  const counterboreDepth =
    counterbore.depth ?? spec.headHeight + axialClearance;
  const counterboreDiameter =
    counterbore.diameter ?? spec.counterboreDiameter;
  if (
    !Number.isFinite(counterboreDepth) ||
    counterboreDepth <= 0 ||
    counterboreDepth > options.depth
  ) {
    throw new Error('Counterbore depth must be within the total hole depth.');
  }
  if (
    !Number.isFinite(counterboreDiameter) ||
    counterboreDiameter < spec.headDiameter
  ) {
    throw new Error('Counterbore diameter must accommodate the screw head.');
  }
  const recess = cylinder(
    counterboreDiameter / 2,
    counterboreDepth + 0.2,
  ).relate(tool =>
    tool.center
      .on(shaft.top)
      .offset(0, -counterboreDepth / 2 + 0.1, 0),
  );
  return union(shaft, recess).named(
    spec.designation + ' ' + fit + ' counterbored hole',
  );
}

export function resolveSocketCapScrewSpec(
  input: SocketCapScrewInput,
): SocketCapScrewSpec {
  return typeof input === 'string' ? socketCapScrewSpecs[input] : input;
}

export function referenceThreadLength(
  spec: SocketCapScrewSpec,
  length: number,
): number {
  if (length <= 125) return 2 * spec.nominalDiameter + 12;
  if (length <= 200) return 2 * spec.nominalDiameter + 18;
  return 2 * spec.nominalDiameter + 31;
}

function validateSpec(spec: SocketCapScrewSpec): void {
  const values = [
    spec.nominalDiameter,
    spec.pitch,
    spec.headDiameter,
    spec.headHeight,
    spec.hexSocketWidth,
    spec.hexSocketDepth,
    spec.underHeadRadius,
    spec.clearance.close,
    spec.clearance.normal,
    spec.clearance.loose,
    spec.counterboreDiameter,
  ];
  if (values.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Fastener specifications must contain positive finite dimensions.');
  }
  if (spec.headDiameter <= spec.nominalDiameter) {
    throw new Error('Head diameter must exceed the nominal thread diameter.');
  }
  if (spec.hexSocketDepth >= spec.headHeight) {
    throw new Error('Hex socket depth must be smaller than the head height.');
  }
}
`;
