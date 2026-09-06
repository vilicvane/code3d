import {box, cut, group} from '@code3d/core';
import {ISO4762} from '@code3d/screws';

const metal = '#999';
const gray = '#666';

let plate = box(40, 10, 40)
  .fillet(2, [2, 3, 4, 6, 7, 8, 11, 12])
  .chamfer(1, [[1, 10]]);

const hole = ISO4762.clearanceHole('M6', 10).relate(tool =>
  tool.shaftBottom.on(plate.bottom).flip(),
);

plate = cut(plate, [hole]).paint(gray);

const screw = ISO4762.screw('M6', 18)
  .paint(metal)
  .relate(part =>
    part.headBottom.on(hole.counterboreBottom).flip().offset(0, -10, 0),
  );

export default group([plate, screw], 'M6 fastener demo');
