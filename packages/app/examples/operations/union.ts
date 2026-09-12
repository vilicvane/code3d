import {box, cylinder, union} from '@code3d/core';

const base = box(30, 8, 20);
// The boss overlaps the base by 2 mm, giving union a shared volume.
const boss = cylinder(5, 10).originOffset(0, -7, 0);

export default union([base, boss]);
