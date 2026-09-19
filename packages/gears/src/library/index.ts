import {box, cut, cylinder, union} from '@code3d/core';
import type {
  Bound,
  CanonicalElements,
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
  return addMounting(
    toothed,
    options.faceWidth,
    dimensions,
    options.mounting,
  ).expose({
    gearAxis: toothed.axis,
    gearFaceUp: toothed.up,
    gearFaceDown: toothed.down,
  });
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
  return addMounting(
    toothed,
    options.faceWidth,
    dimensions,
    options.mounting,
  ).expose({
    gearAxis: toothed.axis,
    gearFaceUp: toothed.up,
    gearFaceDown: toothed.down,
  });
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
  return cut(rim, tools).expose({
    gearAxis: rim.axis,
    gearFaceUp: rim.up,
    gearFaceDown: rim.down,
  });
}
