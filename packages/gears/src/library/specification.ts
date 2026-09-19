/** Dimensions are millimetres; angles are degrees. */
export type ToothStandards = Readonly<{
  /** Selects the equivalent 20° basic-rack reference used for nominal teeth. */
  toothProfile?: 'ISO53' | 'GBT1356';
  /** Requires the normal module to belong to either series in the standard. */
  moduleSeries?: 'ISO54' | 'GBT1357';
}>;

export type BoreMounting = Readonly<{
  kind: 'bore';
  diameter: number;
  keyway?: Readonly<{width: number; depth: number}>;
  hub?: Readonly<{diameter: number; length: number; side: 'up' | 'down'}>;
}>;

export type ShaftMounting = Readonly<{
  kind: 'shaft';
  diameter: number;
  upExtension: number;
  downExtension: number;
}>;

export type Mounting = Readonly<{kind: 'solid'}> | BoreMounting | ShaftMounting;

type CommonOptions = Readonly<{
  teeth: number;
  faceWidth: number;
  standards?: ToothStandards;
}>;

export type SpurGearOptions = CommonOptions &
  Readonly<{module: number; mounting?: Mounting}>;

export type HelicalGearOptions = CommonOptions &
  Readonly<{
    normalModule: number;
    helixAngle: number;
    hand: 'right' | 'left';
    mounting?: Mounting;
  }>;

export type BoltPattern = Readonly<{
  count: number;
  circleDiameter: number;
  holeDiameter: number;
}>;

export type InternalGearOptions = CommonOptions &
  Readonly<{
    module: number;
    outerDiameter: number;
    boltPattern?: BoltPattern;
  }>;

export type ToothDimensions = Readonly<{
  normalModule: number;
  transverseModule: number;
  transversePressureAngle: number;
  pitchRadius: number;
  baseRadius: number;
  tipRadius: number;
  rootRadius: number;
}>;

// ISO 54:1996 / GB/T 1357-2008 normal modules, including both series.
export const moduleSeriesI = [
  1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 32, 40, 50,
] as const;
export const moduleSeriesII = [
  1.125, 1.375, 1.75, 2.25, 2.75, 3.5, 4.5, 5.5, 6.5, 7, 9, 11, 14, 18, 22, 28,
  36, 45,
] as const;

function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive finite number.`);
}

function nonnegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name} must be a nonnegative finite number.`);
}

function validateModule(module: number, standards?: ToothStandards): void {
  positive('Normal module', module);
  if (
    standards?.moduleSeries &&
    !moduleSeriesI.includes(module as (typeof moduleSeriesI)[number]) &&
    !moduleSeriesII.includes(module as (typeof moduleSeriesII)[number])
  )
    throw new Error(`${module} is outside ${standards.moduleSeries} modules.`);
}

export function resolveToothDimensions(
  kind: 'external' | 'internal',
  normalModule: number,
  teeth: number,
  faceWidth: number,
  helixAngle: number,
  standards?: ToothStandards,
): ToothDimensions {
  validateModule(normalModule, standards);
  positive('Face width', faceWidth);
  if (!Number.isInteger(teeth) || teeth < (kind === 'internal' ? 35 : 18))
    throw new Error(
      `Teeth must be an integer of at least ${kind === 'internal' ? 35 : 18} for this unshifted profile.`,
    );
  if (!Number.isFinite(helixAngle) || helixAngle < 0 || helixAngle >= 45)
    throw new Error('Helix angle must be in [0, 45) degrees.');

  const beta = (helixAngle * Math.PI) / 180;
  const transverseModule = normalModule / Math.cos(beta);
  const transversePressureAngle = Math.atan(
    Math.tan((20 * Math.PI) / 180) / Math.cos(beta),
  );
  const pitchRadius = (teeth * transverseModule) / 2;
  const baseRadius = pitchRadius * Math.cos(transversePressureAngle);
  const tipRadius =
    pitchRadius + (kind === 'internal' ? -normalModule : normalModule);
  const rootRadius =
    pitchRadius + (kind === 'internal' ? 1.25 : -1.25) * normalModule;
  if (kind === 'internal' && tipRadius <= baseRadius)
    throw new Error('Internal tooth tips must lie outside the base circle.');
  return {
    normalModule,
    transverseModule,
    transversePressureAngle,
    pitchRadius,
    baseRadius,
    tipRadius,
    rootRadius,
  };
}

export function validateMounting(
  mounting: Mounting | undefined,
  dimensions: ToothDimensions,
): void {
  if (!mounting || mounting.kind === 'solid') return;
  positive('Mounting diameter', mounting.diameter);
  if (mounting.diameter >= 2 * dimensions.rootRadius)
    throw new Error('Mounting diameter must fit inside the root circle.');
  if (mounting.kind === 'shaft') {
    nonnegative('Up extension', mounting.upExtension);
    nonnegative('Down extension', mounting.downExtension);
    if (!mounting.upExtension && !mounting.downExtension)
      throw new Error('A shaft needs an extension on at least one side.');
    return;
  }
  if (mounting.keyway) {
    positive('Keyway width', mounting.keyway.width);
    positive('Keyway depth', mounting.keyway.depth);
    if (
      mounting.keyway.width >= mounting.diameter ||
      mounting.diameter / 2 + mounting.keyway.depth >= dimensions.rootRadius
    )
      throw new Error('Keyway must fit between the bore and root circle.');
  }
  if (mounting.hub) {
    positive('Hub diameter', mounting.hub.diameter);
    positive('Hub length', mounting.hub.length);
    if (
      mounting.hub.diameter <= mounting.diameter ||
      mounting.hub.diameter >= 2 * dimensions.rootRadius
    )
      throw new Error(
        'Hub must surround the bore and fit inside the root circle.',
      );
  }
}

export function validateRing(
  options: InternalGearOptions,
  dimensions: ToothDimensions,
): void {
  positive('Outer diameter', options.outerDiameter);
  const outerRadius = options.outerDiameter / 2;
  if (outerRadius <= dimensions.rootRadius)
    throw new Error('Outer diameter must exceed the internal root diameter.');
  const bolt = options.boltPattern;
  if (!bolt) return;
  if (!Number.isInteger(bolt.count) || bolt.count < 2)
    throw new Error('Bolt count must be an integer of at least two.');
  positive('Bolt circle diameter', bolt.circleDiameter);
  positive('Bolt hole diameter', bolt.holeDiameter);
  const center = bolt.circleDiameter / 2;
  const radius = bolt.holeDiameter / 2;
  if (
    center - radius <= dimensions.rootRadius ||
    center + radius >= outerRadius
  )
    throw new Error('Bolt holes must fit within the annular rim.');
}
