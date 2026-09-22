import {
  bezier,
  circle,
  extrude,
  line,
  loft,
  rectangle,
  revolve,
  sphere,
  sweep,
  thicken,
  wrap,
} from '@code3d/core';

export const plate = extrude(rectangle(12, 8), 3);

const axis = line([0, -20, 0], [0, 20, 0]);
const ringSection = circle(1).rotate(90, 0, 0).originOffset(-8, 0, 0);
export const ring = revolve(ringSection, axis, {angle: 360});

const profile = circle(2);
const spine = bezier([
  [0, 0, 0],
  [0, 8, 0],
  [5, 16, 0],
  [5, 24, 0],
]);
export const bentRod = sweep(profile, spine);

const lower = circle(6);
const upper = rectangle(8, 6).originOffset(0, -12, 0);
export const transition = loft([lower, upper]);

const ball = sphere(20);
const label = rectangle(8, 4).originOffset(0, -24, 0);
export const curvedFaces = wrap(label, ball.surface(1));
export const curvedPlates = thicken(curvedFaces, 0.8);
