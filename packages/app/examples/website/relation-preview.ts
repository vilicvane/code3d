import {box, group} from '@code3d/core';

const base = box(40, 8, 30);
const part = box(14, 20, 12).relate(self =>
  self
    .on(base.up) // Touch the base.
    .offset(6, 0, 0)
    .pivot(0, -10, 0)
    .rotate(0, 0, 25),
);

// The neighbor stays visible as context.
const neighbor = box(8, 12, 8).relate(self =>
  self.on(base.up).offset(-13, 0, 0),
);

export default group([base, part, neighbor]);
