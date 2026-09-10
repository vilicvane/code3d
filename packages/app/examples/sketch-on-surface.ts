import {box, sketch} from '@code3d/core';

// Select profile for local editing, opening for the same data with host context,
// and result for the cut. Spatial placement never rewrites the sketch coordinates.
export const host = box(40, 20, 30).rotate(0, 0, 25);
export const profile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 4]],
]);
// Surface 4 is the box's original +Y face and follows the host's rotation.
export const opening = profile.relate(s => s.plane.align(host.surface(4)));
export const cutter = opening.face().extrude(-20);
export const result = host.cut([cutter]);

// Empty and open sketches can be related too; only face() requires closure.
export const draft = sketch().relate(s => s.plane.align(host.surface(2)));

export default result;
