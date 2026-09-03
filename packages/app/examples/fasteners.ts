import {box, cut, group} from '@code3d/core';
import {ISO4762} from '@code3d/screws';

const accent = '#d8ff3e';
const dark = '#222621';

const plate = box(38, 6, 26).named('Demo plate').paint(dark);
const hole = ISO4762.clearanceHole('M6', {
  depth: 10,
  fit: 'normal',
  counterbore: true,
}).relate(tool => tool.shaftBottom.on(plate.bottom).flip());
const preparedPlate = cut(plate, [hole])
  .named('Counterbored plate')
  .paint(dark);

const screw = ISO4762.screw('M6', 18)
  .paint(accent)
  .relate(part =>
    part.headBottom.on(hole.counterboreBottom).flip().offset(0, -1, 0),
  );

export const fastenerExample = group(
  [preparedPlate, screw],
  'M6 fastener assembly',
);
