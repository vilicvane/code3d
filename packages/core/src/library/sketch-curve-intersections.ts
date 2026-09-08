import type {SketchPosition} from './sketch.js';
import {
  sketchCurveClosestParameter,
  sketchCurvePosition,
  sketchCurveTolerance,
  type SketchCurve,
} from './sketch-curves.js';

export type SketchCurveIntersection = Readonly<{
  position: SketchPosition;
  parameters: readonly [first: number, second: number];
}>;

const subtract = (a: SketchPosition, b: SketchPosition): SketchPosition => [
  a[0] - b[0],
  a[1] - b[1],
];
const cross = (a: SketchPosition, b: SketchPosition) =>
  a[0] * b[1] - a[1] * b[0];
const distance = (a: SketchPosition, b: SketchPosition) =>
  Math.hypot(...subtract(a, b));
const endpoints = (curve: SketchCurve): readonly SketchPosition[] =>
  curve.kind === 'circle'
    ? []
    : [sketchCurvePosition(curve, 0), sketchCurvePosition(curve, 1)];

/**
 * Isolated intersections and finite overlap boundaries, ordered along first.
 * A shared continuous interior does not enumerate points: coincident full
 * circles have no boundaries. Parameters are local to this evaluation, not IDs.
 */
export function sketchCurveIntersections(
  first: SketchCurve,
  second: SketchCurve,
): readonly SketchCurveIntersection[] {
  const tolerances = [
    sketchCurveTolerance(first),
    sketchCurveTolerance(second),
  ];
  const tolerance = Math.min(...tolerances);
  const contacts: SketchCurveIntersection[] = [];
  for (const position of candidates(first, second, tolerance)) {
    const parameters = [
      sketchCurveClosestParameter(first, position),
      sketchCurveClosestParameter(second, position),
    ] as const;
    if (
      [first, second].some(
        (curve, i) =>
          distance(position, sketchCurvePosition(curve, parameters[i])) >
          tolerances[i],
      ) ||
      contacts.some(
        contact => distance(position, contact.position) <= tolerance,
      )
    )
      continue;
    contacts.push({position, parameters});
  }
  return contacts.sort((a, b) => a.parameters[0] - b.parameters[0]);
}

function candidates(
  first: SketchCurve,
  second: SketchCurve,
  tolerance: number,
): readonly SketchPosition[] {
  if (first.kind === 'line') {
    const [a, b] = first.points;
    const length = distance(a, b);
    if (!length) return [a];
    const unit: SketchPosition = [
      (b[0] - a[0]) / length,
      (b[1] - a[1]) / length,
    ];
    if (second.kind === 'line') {
      const [c, d] = second.points;
      const otherLength = distance(c, d);
      if (!otherLength) return [c];
      // Collinear endpoints delimit overlap. Check them before dividing by
      // the angle, which can be roundoff-sized for rotated/translated lines.
      if (
        second.points.every(
          p => Math.abs(cross(unit, subtract(p, a))) <= tolerance,
        )
      )
        return [a, b, c, d];
      const otherUnit: SketchPosition = [
        (d[0] - c[0]) / otherLength,
        (d[1] - c[1]) / otherLength,
      ];
      const denominator = cross(unit, otherUnit);
      if (Math.abs(denominator) <= Number.EPSILON * 16) return [];
      const along = cross(subtract(c, a), otherUnit) / denominator;
      return [[a[0] + along * unit[0], a[1] + along * unit[1]]];
    }
    const perpendicular = cross(unit, subtract(second.center, a));
    const gap = Math.abs(perpendicular);
    if (gap > second.radius + tolerance) return [];
    const normalized = gap / second.radius;
    // Classify tangency before sqrt magnifies coordinate roundoff into two
    // artificial cuts. Use the same model-space tolerance as finite contacts.
    const offset =
      Math.abs(gap - second.radius) <= tolerance
        ? 0
        : second.radius *
          Math.sqrt(Math.max(0, (1 - normalized) * (1 + normalized)));
    // Start at the circular center's projection, not a far-away line endpoint.
    const foot: SketchPosition = [
      second.center[0] + perpendicular * unit[1],
      second.center[1] - perpendicular * unit[0],
    ];
    return [-offset, offset].map(along => [
      foot[0] + along * unit[0],
      foot[1] + along * unit[1],
    ]);
  }
  if (second.kind === 'line') return candidates(second, first, tolerance);
  const delta = subtract(second.center, first.center);
  const separation = Math.hypot(...delta);
  if (
    separation <= tolerance &&
    Math.abs(first.radius - second.radius) <= tolerance
  )
    return [...endpoints(first), ...endpoints(second)];
  if (
    !separation ||
    separation > first.radius + second.radius + tolerance ||
    separation < Math.abs(first.radius - second.radius) - tolerance
  )
    return [];
  // Normalize before squaring; the factored radius difference also avoids
  // subtracting nearly equal squared radii.
  const scale = Math.max(separation, first.radius, second.radius);
  const d = separation / scale,
    r = first.radius / scale,
    s = second.radius / scale;
  const along = (d * d + (r - s) * (r + s)) / (2 * d);
  const tangent =
    Math.abs(separation - first.radius - second.radius) <= tolerance ||
    Math.abs(separation - Math.abs(first.radius - second.radius)) <= tolerance;
  const height = tangent
    ? 0
    : Math.sqrt(Math.max(0, (r - along) * (r + along))) * scale;
  const unit: SketchPosition = [delta[0] / separation, delta[1] / separation];
  const foot: SketchPosition = [
    first.center[0] + along * scale * unit[0],
    first.center[1] + along * scale * unit[1],
  ];
  return [-height, height].map(offset => [
    foot[0] - offset * unit[1],
    foot[1] + offset * unit[0],
  ]);
}
