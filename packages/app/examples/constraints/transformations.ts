import {box, group, offset, rotate} from '@code3d/core';

const base = box(32, 14, 24).material('#454b50');
const cover = box(32, 3, 24)
  .material('#d8ff3e')
  .relate(self => [
    self.axis.align(base.axis),
    self.on(base.up),
    // Lift and turn the jointly positioned cover. Select self to adjust it.
    offset(0, 8, 0),
    rotate(0, 25, 0),
  ]);

export default group([base, cover]);
