import {
  box,
  cut,
  cylinder,
  group,
  intersect,
  sphere,
  union,
} from '@code3d/core';

const accent = '#d8ff3e';
const neutral = '#30352f';

const stock = box(30, 8, 20).paint(neutral);
const bore = cylinder(3, 12).relate(tool => tool.center.on(stock.center));
const drilled = cut(stock, [bore]).paint(neutral);

const boss = cylinder(5, 6)
  .relate(part => part.bottom.on(drilled.top).offset(7, 0, 0))
  .paint(accent);
const joined = union([drilled, boss]).paint(neutral);

const lens = intersect([sphere(8), box(12, 12, 12)])
  .relate(part => part.center.on(joined.center).offset(24, 0, 0))
  .paint(accent);

export const booleanOperationsExample = group(
  [joined, lens],
  'Boolean operations',
);
