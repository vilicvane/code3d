import {
  box,
  coil,
  cylinder,
  frustum,
  group,
  regularPrism,
  sphere,
  tube,
} from '@code3d/core';

const accent = '#d8ff3e';
const secondary = '#8ed5d1';
const neutral = '#353a33';

// Width shared by the primitive showcase base.
const baseWidth = 36;
const baseHeight = 4;
const columnHeight = 14;
const taperedHeight = 12;
const prismHeight = 6;
const collarHeight = 4;
const sphereRadius = 5;
const sphereScale = 0.8;

// Put the base's top plane at local Y = 0 for the parts with known dimensions.
const base = box(baseWidth, baseHeight, 34)
  .fillet(1)
  .originOffset(0, baseHeight / 2, 0)
  .material(neutral);

const column = cylinder(4, columnHeight)
  .originOffset(10, -columnHeight / 2, 0)
  .material(accent);

const taperedColumn = frustum(5, 3, taperedHeight)
  .originOffset(-10, -taperedHeight / 2, 0)
  .material(secondary);

const prism = regularPrism(4.5, prismHeight, 6, 30)
  .originOffset(0, -(taperedHeight + prismHeight / 2), 0)
  .material(accent);

const collar = tube(5.5, 4.5, collarHeight)
  .originOffset(10, -collarHeight / 2, 0)
  .material(secondary);

const scaledSphere = sphere(sphereRadius)
  .scaled(sphereScale)
  .originOffset(0, -sphereRadius * sphereScale, 0)
  .material(secondary);

// Use a relation for contact with the actual swept wire's lower bound.
const winding = coil(5, 0.75, 4, 2.5)
  .relate(part => part.on(base.up).offset(0, 0, 10))
  .material(accent);

export const primitivesExample = group(
  [base, column, collar, taperedColumn, prism, scaledSphere, winding],
  'Primitive operations',
);
