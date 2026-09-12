import {frustum, intersect, regularPrism} from '@code3d/core';
import {
  metric,
  validateHead,
  positive,
  type HeadSpecification,
  type MetricSize,
} from './common.js';

export type Specification = HeadSpecification & Readonly<{headWidth: number}>;

// Shared head dimensions of ISO 4014 and ISO 4017. ISO widths, not DIN 931/933.
// https://www.vipafasteners.com/files/0/801-PARTIAL_THREAD_HEXAGON_HEAD_SCREWS_ISO_4014_UNI_5737_DIN_931.pdf
function specification(
  size: MetricSize,
  headWidth: number,
  headHeight: number,
  underHeadRadius: number,
): Specification {
  return {
    ...metric(size),
    headWidth,
    headHeight,
    underHeadRadius,
    headDiameter: (2 * headWidth) / Math.sqrt(3),
  };
}

export const specifications = {
  M3: specification('M3', 5.5, 2, 0.1),
  M4: specification('M4', 7, 2.8, 0.2),
  M5: specification('M5', 8, 3.5, 0.2),
  M6: specification('M6', 10, 4, 0.25),
  M8: specification('M8', 13, 5.3, 0.4),
  M10: specification('M10', 16, 6.4, 0.4),
  M12: specification('M12', 18, 7.5, 0.6),
} as const;

export function hexHead(spec: Specification) {
  validateHead(spec);
  positive('Head width', spec.headWidth);
  if (Math.abs(spec.headDiameter - (2 * spec.headWidth) / Math.sqrt(3)) > 1e-6)
    throw new Error('Hex head diameter must describe its corner envelope.');
  const radius = spec.headWidth / Math.sqrt(3);
  const blank = regularPrism(radius, spec.headHeight, 6, 30);
  // The cone produces the circular crown and six curved chamfer boundaries.
  const chamferEnvelope = frustum(
    spec.headWidth / 2 + spec.headHeight * Math.sqrt(3),
    spec.headWidth / 2,
    spec.headHeight,
  );
  return intersect([blank, chamferEnvelope]);
}
