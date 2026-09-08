import {box, cylinder, group} from '@code3d/core';

const baseHeight = 4;
const postHeight = 14;

// Share an origin on the contact plane: the base below, the post above.
const base = box(36, baseHeight, 24)
  .fillet(1)
  .originOffset(0, baseHeight / 2, 0);
const post = cylinder(4, postHeight).originOffset(10, -postHeight / 2, 0);

export const model = group([base, post]);
