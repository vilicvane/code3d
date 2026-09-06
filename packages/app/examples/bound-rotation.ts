import {circle, group, loft, rectangle, regularPolygon} from '@code3d/core';

const start = circle(20);
const via = regularPolygon(20, 8).relate(self =>
  self.on(start.up).pivot(50, 0, 0).rotate(0, 0, 45),
);
const end = rectangle(40, 40).relate(self =>
  self.on(start.up).pivot(50, 0, 0).rotate(0, 0, 90),
);

export const sections = group([start, via, end], 'Loft sections');
export default loft([start, via, end]).paint('#d8ff3e');
