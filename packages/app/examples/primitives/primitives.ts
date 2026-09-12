import {
  arc,
  bezier,
  box,
  circle,
  coil,
  cylinder,
  ellipse,
  frustum,
  line,
  point,
  rectangle,
  regularPolygon,
  regularPrism,
  sphere,
  spline,
  tube,
} from '@code3d/core';

// Solids: select a name or a shape to connect the word with its geometry.
export const cuboid = box(12, 10, 8);
export const roundCylinder = cylinder(5, 12);
export const hollowTube = tube(5, 3, 12);
export const ball = sphere(6);
export const taperedCylinder = frustum(6, 3, 12);
export const hexagonalPrism = regularPrism(6, 12, 6);
export const helicalCoil = coil(5, 1, 4, 3);

// Planar faces: flat, filled shapes in the XZ plane.
export const rectangularFace = rectangle(12, 8);
export const circularFace = circle(6);
export const ellipticalFace = ellipse(7, 4);
export const pentagonalFace = regularPolygon(6, 5);

// Points and curves: no filled area or solid volume.
export const vertex = point([0, 0, 0]);
export const straightLine = line([-6, 0, 0], [6, 0, 0]);
export const circularArc = arc([-6, 0, 0], [0, 0, -6], [6, 0, 0]);
export const bezierCurve = bezier([
  [-6, 0, 0],
  [-3, 0, -8],
  [3, 0, 8],
  [6, 0, 0],
]);
export const fittedSpline = spline([
  [-6, 0, 0],
  [-2, 0, -5],
  [2, 0, 5],
  [6, 0, 0],
]);

// Select one exported name to inspect its basic shape. Text has its own example.
