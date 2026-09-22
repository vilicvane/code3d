import {align, box, sketch} from '@code3d/core';

export const basicProfile = sketch(
  [
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 8]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['radius', 2, 8],
    ],
  },
);
export const basicPart = basicProfile.face().extrude(3);

export const entityProfile = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [6, 0]],
  ['point', 3, [-6, 0]],
  ['arc', 4, [1, 6, 2, 3, 'ccw']],
  ['line', 5, [3, 2]],
  ['point', 6, [0, 3]],
  ['point', 7, 6],
  ['circle', 8, [7, 1]],
]);
export const entityPart = entityProfile.face().extrude(2);

export const constrainedProfile = sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [40, 0]],
    ['point', 3, [40, 25]],
    ['point', 4, [0, 25]],
    ['line', 5, [1, 2]],
    ['line', 6, [2, 3]],
    ['line', 7, [3, 4]],
    ['line', 8, [4, 1]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['horizontal', 5],
      ['horizontal', 7],
      ['vertical', 6],
      ['vertical', 8],
      ['length', 5, 40],
    ],
  },
);
export const constrainedPart = constrainedProfile.face().extrude(3);

const upstream = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 20]],
]);
export const derivedProfile = upstream.derive(
  [
    ['point', 1, upstream.point(1)],
    ['circle', 2, [1, 3]],
  ],
  {constraints: [['radius', 2, 8]]},
);
export const sleevePart = derivedProfile.face().extrude(10);

export const holesProfile = sketch([
  ['point', 1, [-10, 0]],
  ['circle', 2, [1, 3]],
  ['point', 3, [10, 0]],
  ['circle', 4, [3, 3]],
]);
export const regionParts = holesProfile.faces().map(face => face.extrude(5));

const sketchHost = box(40, 8, 30).rotate(0, 0, 25);
const localProfile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 4]],
]);
export const placedProfile = localProfile.relate(self =>
  align(self.plane, sketchHost.surface(4)),
);
export const drilledHost = sketchHost.cut([placedProfile.face().extrude(-8)]);
