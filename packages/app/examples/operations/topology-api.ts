import {box, line, point, rectangle} from '@code3d/core';

export const bodyV = box(20, 10, 14);
export const corner = bodyV.vertex(3);
export const chosenCorners = bodyV.vertices([3, 1]);

export const bodyE = box(20, 10, 14);
export const upright = bodyE.edge(2);
export const selectedEdges = bodyE.edges([2, 4]);

export const bodyS = box(20, 10, 14);
export const topFace = bodyS.surface(4);
export const endFaces = bodyS.surfaces([3, 4]);

export const marker = point([10, 0, 0]);
export const block = box(20, 10, 14);
export const profile = rectangle(12, 8);
export const path = line([10, 0, 0], [30, 0, 0]);

export const localFrame = marker.frame;
export const zero = marker.origin;
export const geometricPoint = marker.center;
export const centerline = block.axis;
export const workplane = profile.plane;
export const middle = path.midpoint;

export const bodyB = box(20, 10, 14).rotate(0, 0, 25);
export const upperBound = bodyB.up;
export const reversedBound = upperBound.flip();

export const segment = line([0, 0, 0], [10, 0, 0]);
export const backward = segment.reverse();
export const sheet = rectangle(12, 8);
export const downward = sheet.flip();
