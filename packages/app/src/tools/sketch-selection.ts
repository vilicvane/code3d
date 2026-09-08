import {
  sketchCurveBounds,
  sketchCurveIntersections,
  sketchCurvePosition,
  type SketchPointAddress,
  type SketchPosition,
} from '@code3d/core/tooling';
import {sameSketchSegment, type SketchSegment} from './sketch-segments';
import {sameSketchPoint, type SketchPoint} from './sketch-snap';

export type SketchPick = SketchPointAddress | SketchSegment;
export type SketchSelectionMode = 'replace' | 'add' | 'toggle';

export function sketchSelectionMode(modifiers: {
  ctrlKey: boolean;
  shiftKey: boolean;
}): SketchSelectionMode {
  return modifiers.ctrlKey ? 'toggle' : modifiers.shiftKey ? 'add' : 'replace';
}

/** Click and box selection use the same set operation. Gestures supply their
 * original selection on every frame, never the result of the preceding frame.
 */
export function updateSketchSelection(
  before: readonly SketchPick[],
  picks: readonly SketchPick[],
  mode: SketchSelectionMode,
): SketchPick[] {
  const hits = picks.filter(
    (p, i) => picks.findIndex(q => sameSketchPick(p, q)) === i,
  );
  if (mode === 'replace') return hits;
  return [
    ...before.filter(
      p => mode !== 'toggle' || !hits.some(q => sameSketchPick(p, q)),
    ),
    ...hits.filter(p => !before.some(q => sameSketchPick(p, q))),
  ];
}

export function sameSketchPick(a: SketchPick, b: SketchPick): boolean {
  return 'start' in a && 'start' in b
    ? sameSketchSegment(a, b)
    : !('start' in a) && !('start' in b) && sameSketchPoint(a, b);
}

/** Finite analytic geometry, not curve bounding-box overlap or pixel sampling. */
export function boxSelectSketch(
  points: readonly SketchPoint[],
  segments: readonly SketchSegment[],
  start: SketchPosition,
  end: SketchPosition,
): SketchPick[] {
  const min = start.map((value, axis) => Math.min(value, end[axis]));
  const max = start.map((value, axis) => Math.max(value, end[axis]));
  const inside = (p: SketchPosition) =>
    p.every((value, axis) => value >= min[axis] && value <= max[axis]);
  const corners: SketchPosition[] = [
    [min[0], min[1]],
    [max[0], min[1]],
    [max[0], max[1]],
    [min[0], max[1]],
  ];
  const crossing = end[0] < start[0];
  return [
    ...points.filter(p => inside(p.position)),
    ...segments.filter(({curve}) => {
      if (sketchCurveBounds(curve).every(inside)) return true;
      if (!crossing) return false;
      if (inside(sketchCurvePosition(curve, 0))) return true;
      return corners.some(
        (p, i) =>
          sketchCurveIntersections(curve, {
            kind: 'line',
            points: [p, corners[(i + 1) % 4]],
          }).length > 0,
      );
    }),
  ];
}
