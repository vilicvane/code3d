import {box, cylinder, frustum, group, regularPrism, sphere} from 'code3d';

const accent = '#d8ff3e';
const secondary = '#8ed5d1';
const neutral = '#353a33';

/**
 * @code3d.label Base width
 * @code3d.description Width shared by the primitive showcase base.
 * @code3d.kind length
 * @code3d.unit mm
 * @code3d.min 24
 * @code3d.max 48
 * @code3d.step 1
 */
const baseWidth = 36;

const base = box(baseWidth, 4, 24)
  .fillet(1)
  .named('Filleted box')
  .paint(neutral);

const column = cylinder(4, 14)
  .relate(part => part.bottom.on(base.top).offset(-10, 0, 0))
  .named('Cylinder')
  .paint(accent);

const taperedColumn = frustum(5, 3, 12)
  .relate(part => part.bottom.on(base.top).offset(10, 0, 0))
  .named('Frustum')
  .paint(secondary);

const prism = regularPrism(4.5, 6, 6, 30)
  .relate(part => part.bottom.on(taperedColumn.top))
  .named('Regular prism')
  .paint(accent);

const scaledSphere = sphere(5)
  .scaled(0.8)
  .relate(part => part.center.on(base.top).offset(0, 4, 0))
  .named('Scaled sphere')
  .paint(secondary);

export const primitivesExample = group(
  [base, column, taperedColumn, prism, scaledSphere],
  'Primitive operations',
);
