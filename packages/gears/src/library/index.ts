import {
  coupleRotation,
  box,
  cut,
  cylinder,
  getModelData,
  group,
  inspectGroupMembers,
  offset,
  setModelData,
  union,
} from '@code3d/core';
import type {
  Bound,
  CanonicalElements,
  InspectContext,
  InspectResult,
  LineAnchor,
  SolidModel,
} from '@code3d/core';
import {
  resolveToothDimensions,
  validateMounting,
  validateRing,
  type Mounting,
  type ToothDimensions,
  type SpurGearOptions,
  type HelicalGearOptions,
  type InternalGearOptions,
} from './specification.js';
import {toothSolid} from './tooth-solid.js';

export type {
  BoltPattern,
  BoreMounting,
  HelicalGearOptions,
  InternalGearOptions,
  Mounting,
  ShaftMounting,
  SpurGearOptions,
  ToothStandards,
} from './specification.js';
export {moduleSeriesI, moduleSeriesII} from './specification.js';

export type GearElements = CanonicalElements &
  Readonly<{
    gearAxis: LineAnchor;
    gearFaceUp: Bound;
    gearFaceDown: Bound;
  }>;
export type Gear = SolidModel<GearElements>;

type GearProfile = Readonly<{
  kind: 'external' | 'internal';
  teeth: number;
  normalModule: number;
  faceWidth: number;
  helixAngle: number;
  hand?: 'right' | 'left';
  pitchRadius: number;
}>;

const gearProfileKey = Symbol('gearProfile');

function withGearProfile(gear: Gear, profile: GearProfile): Gear {
  setModelData(gear, gearProfileKey, profile);
  return gear;
}

function profileOf(gear: Gear): GearProfile {
  const profile = getModelData<GearProfile>(gear, gearProfileKey);
  if (!profile)
    throw new Error(
      'Gear assembly requires a gear created by @code3d/gears, optionally followed by relate() or material().',
    );
  return profile;
}

/** Adjust the pair at the corresponding adjacent position in the gear array. */
export type GearPairConfig = Readonly<{
  /**
   * Turn from the preceding center-line direction, in degrees. Defaults to 0
   * (straight). Positive turns go from +X toward +Z in the assembly XZ plane;
   * the first pair starts from +X. Successive turns accumulate.
   */
  angle?: number;
  /** Signed change to the nominal shaft center distance, in millimetres. */
  centerDistanceDelta?: number;
  /** Driven gear's face midplane displacement along +Y, in millimetres. */
  axialOffset?: number;
}>;

/** Shared adjustments and optional overrides for adjacent gear pairs. */
export type GearAssemblyConfig = Readonly<{
  centerDistanceDelta?: number;
  axialOffset?: number;
  /** Pair 0 joins gears 0–1, pair 1 joins gears 1–2, and so on. */
  pairs?: readonly GearPairConfig[];
}>;

function equalDimension(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, left, right);
}

/** Nominal parallel-axis shaft distance for a compatible gear pair. */
export function nominalCenterDistance(first: Gear, second: Gear): number {
  const a = profileOf(first);
  const b = profileOf(second);
  if (
    !equalDimension(a.normalModule, b.normalModule) ||
    !equalDimension(a.helixAngle, b.helixAngle)
  )
    throw new Error(
      'Meshing gears need the same normal module and helix angle.',
    );
  if (a.kind === 'internal' && b.kind === 'internal')
    throw new Error('Two internal gears cannot form this parallel-axis mesh.');
  if (a.helixAngle > 0 && a.hand === b.hand)
    throw new Error(
      'Parallel-axis external helical gears need opposite hands.',
    );
  const internal =
    a.kind === 'internal' ? a : b.kind === 'internal' ? b : undefined;
  if (!internal) return a.pitchRadius + b.pitchRadius;
  const external = internal === a ? b : a;
  if (internal.pitchRadius <= external.pitchRadius)
    throw new Error(
      'An internal gear must have a larger pitch radius than its pinion.',
    );
  return internal.pitchRadius - external.pitchRadius;
}

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}

function toothTwist(profile: GearProfile, localY: number): number {
  if (!profile.helixAngle) return 0;
  return (
    ((localY + profile.faceWidth / 2) *
      Math.tan((profile.helixAngle * Math.PI) / 180) *
      (profile.hand === 'right' ? 1 : -1)) /
    profile.pitchRadius
  );
}

/** Solve the driven gear's tooth datum at the common axial contact plane. */
function alignedToothAngle(
  source: GearProfile,
  target: GearProfile,
  sourceAngle: number,
  directionAngle: number,
  sourceY: number,
  targetY: number,
): number {
  const internal = source.kind === 'internal' || target.kind === 'internal';
  const sourceContact =
    internal && source.kind === 'external'
      ? directionAngle + Math.PI
      : directionAngle;
  const targetContact = internal ? sourceContact : directionAngle + Math.PI;
  const ratio = ((internal ? 1 : -1) * source.teeth) / target.teeth;
  const raw =
    ratio * sourceAngle +
    (Math.PI -
      source.teeth * (sourceContact + toothTwist(source, sourceY)) -
      target.teeth * (targetContact + toothTwist(target, targetY))) /
      target.teeth;
  const pitch = (2 * Math.PI) / target.teeth;
  return raw - Math.round(raw / pitch) * pitch;
}

/**
 * Mesh each adjacent pair in array order, returning related gear values.
 * @code3d.inspect assembleGears.inspect
 * @code3d.inspect gears assembleGears.inspect
 * @code3d.inspect config assembleGears.inspect
 */
export function assembleGears(
  gears: readonly Gear[],
  config: GearAssemblyConfig = {},
): Gear[] {
  if (config.pairs && config.pairs.length !== Math.max(0, gears.length - 1))
    throw new Error(
      'Pair overrides must match the number of adjacent gear pairs.',
    );

  const assembled = [...gears];
  const toothAngles = gears.map(() => 0);
  const axisY = gears.map(() => 0);
  let centerLineAngle = 0;
  for (let index = 1; index < gears.length; index++) {
    const pair = config.pairs?.[index - 1];
    const source = assembled[index - 1];
    const target = gears[index];
    const sourceProfile = profileOf(source);
    const targetProfile = profileOf(target);
    const distance =
      nominalCenterDistance(source, target) +
      finite(
        'Center distance delta',
        pair?.centerDistanceDelta ?? config.centerDistanceDelta ?? 0,
      );
    if (distance <= 0)
      throw new Error('Adjusted center distance must be positive.');
    const axialOffset = finite(
      'Axial offset',
      pair?.axialOffset ?? config.axialOffset ?? 0,
    );
    if (
      Math.abs(axialOffset) >=
      (sourceProfile.faceWidth + targetProfile.faceWidth) / 2
    )
      throw new Error('Meshing gear faces must overlap axially.');
    const turnAngle = finite('Pair angle', pair?.angle ?? 0);
    centerLineAngle = (centerLineAngle + (turnAngle % 360)) % 360;
    const directionAngle = (centerLineAngle * Math.PI) / 180;

    axisY[index] = axisY[index - 1] + axialOffset;
    const contactY =
      (Math.max(
        axisY[index - 1] - sourceProfile.faceWidth / 2,
        axisY[index] - targetProfile.faceWidth / 2,
      ) +
        Math.min(
          axisY[index - 1] + sourceProfile.faceWidth / 2,
          axisY[index] + targetProfile.faceWidth / 2,
        )) /
      2;
    toothAngles[index] = alignedToothAngle(
      sourceProfile,
      targetProfile,
      toothAngles[index - 1],
      directionAngle,
      contactY - axisY[index - 1],
      contactY - axisY[index],
    );
    const ratio =
      ((sourceProfile.kind === 'internal' || targetProfile.kind === 'internal'
        ? 1
        : -1) *
        sourceProfile.teeth) /
      targetProfile.teeth;
    const phase =
      ((toothAngles[index] - ratio * toothAngles[index - 1]) * 180) / Math.PI;

    assembled[index] = target.relate(self => [
      self.origin.align(source.origin),
      coupleRotation(source, {ratio, phase}),
      offset(
        distance * Math.cos(directionAngle),
        axialOffset,
        distance * Math.sin(directionAngle),
      ),
    ]);
  }
  return assembled;
}

/** @internal */
export namespace assembleGears {
  export function inspect(
    [gears]: [readonly Gear[], GearAssemblyConfig?],
    context: InspectContext<Gear[]>,
  ): InspectResult | undefined {
    return (
      context.return &&
      inspectGroupMembers(
        context.return,
        context.focused.parameter === 'gears' ? gears : context.return,
      )
    );
  }
}

function addMounting(
  toothed: SolidModel,
  faceWidth: number,
  dimensions: ToothDimensions,
  mounting?: Mounting,
): SolidModel {
  if (!mounting || mounting.kind === 'solid') return toothed;
  if (mounting.kind === 'shaft') {
    const length = faceWidth + mounting.upExtension + mounting.downExtension;
    const center = (mounting.upExtension - mounting.downExtension) / 2;
    const shaft = cylinder(mounting.diameter / 2, length).originOffset(
      0,
      -center,
      0,
    );
    return union([toothed, shaft]);
  }

  let blank: SolidModel = toothed;
  const hub = mounting.hub;
  if (hub) {
    const overlap = Math.min(hub.length / 10, dimensions.normalModule / 10);
    const center =
      (hub.side === 'up' ? 1 : -1) *
      (faceWidth / 2 + (hub.length - overlap) / 2);
    blank = union([
      toothed,
      cylinder(hub.diameter / 2, hub.length + overlap).originOffset(
        0,
        -center,
        0,
      ),
    ]);
  }

  const toolLength = faceWidth + (hub?.length ?? 0) + 2;
  const toolCenter = hub ? ((hub.side === 'up' ? 1 : -1) * hub.length) / 2 : 0;
  const tools: SolidModel[] = [
    cylinder(mounting.diameter / 2, toolLength).originOffset(0, -toolCenter, 0),
  ];
  if (mounting.keyway) {
    const radius = mounting.diameter / 2;
    const depth = mounting.keyway.depth;
    tools.push(
      box(radius + depth, toolLength, mounting.keyway.width).originOffset(
        -(radius + depth) / 2,
        -toolCenter,
        0,
      ),
    );
  }
  return cut(blank, tools);
}

/** Make a complete unshifted external spur gear. */
export function spurGear(options: SpurGearOptions): Gear {
  const dimensions = resolveToothDimensions(
    'external',
    options.module,
    options.teeth,
    options.faceWidth,
    0,
    options.standards,
  );
  validateMounting(options.mounting, dimensions);
  const toothed = toothSolid(
    'external',
    options.module,
    options.teeth,
    options.faceWidth,
    0,
    1,
  );
  return withGearProfile(
    addMounting(
      toothed,
      options.faceWidth,
      dimensions,
      options.mounting,
    ).expose({
      gearAxis: toothed.axis,
      gearFaceUp: toothed.up,
      gearFaceDown: toothed.down,
    }),
    {
      kind: 'external',
      teeth: options.teeth,
      normalModule: options.module,
      faceWidth: options.faceWidth,
      helixAngle: 0,
      pitchRadius: dimensions.pitchRadius,
    },
  );
}

/** Make a complete unshifted external helical gear from normal-system inputs. */
export function helicalGear(options: HelicalGearOptions): Gear {
  if (options.helixAngle <= 0)
    throw new Error('Helical gears need a positive helix angle.');
  const dimensions = resolveToothDimensions(
    'external',
    options.normalModule,
    options.teeth,
    options.faceWidth,
    options.helixAngle,
    options.standards,
  );
  validateMounting(options.mounting, dimensions);
  const toothed = toothSolid(
    'external',
    options.normalModule,
    options.teeth,
    options.faceWidth,
    options.helixAngle,
    options.hand === 'right' ? 1 : -1,
  );
  return withGearProfile(
    addMounting(
      toothed,
      options.faceWidth,
      dimensions,
      options.mounting,
    ).expose({
      gearAxis: toothed.axis,
      gearFaceUp: toothed.up,
      gearFaceDown: toothed.down,
    }),
    {
      kind: 'external',
      teeth: options.teeth,
      normalModule: options.normalModule,
      faceWidth: options.faceWidth,
      helixAngle: options.helixAngle,
      hand: options.hand,
      pitchRadius: dimensions.pitchRadius,
    },
  );
}

/** Make an internal spur ring gear, optionally drilled on a bolt circle. */
export function internalGear(options: InternalGearOptions): Gear {
  const dimensions = resolveToothDimensions(
    'internal',
    options.module,
    options.teeth,
    options.faceWidth,
    0,
    options.standards,
  );
  validateRing(options, dimensions);
  const rim = cylinder(options.outerDiameter / 2, options.faceWidth);
  const toothSpace = toothSolid(
    'internal',
    options.module,
    options.teeth,
    options.faceWidth + 2,
    0,
    1,
  );
  const tools: SolidModel[] = [toothSpace];
  const bolt = options.boltPattern;
  if (bolt) {
    for (let index = 0; index < bolt.count; index++) {
      const angle = (index * 2 * Math.PI) / bolt.count;
      const radius = bolt.circleDiameter / 2;
      tools.push(
        cylinder(bolt.holeDiameter / 2, options.faceWidth + 2).originOffset(
          -radius * Math.cos(angle),
          0,
          -radius * Math.sin(angle),
        ),
      );
    }
  }
  return withGearProfile(
    cut(rim, tools).expose({
      gearAxis: rim.axis,
      gearFaceUp: rim.up,
      gearFaceDown: rim.down,
    }),
    {
      kind: 'internal',
      teeth: options.teeth,
      normalModule: options.module,
      faceWidth: options.faceWidth,
      helixAngle: 0,
      pitchRadius: dimensions.pitchRadius,
    },
  );
}
