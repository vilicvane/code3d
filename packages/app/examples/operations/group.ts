import {box, cylinder, group} from '@code3d/core';

const base = box(30, 6, 20);
const post = cylinder(4, 12).relate(part => part.on(base.up));

// A group keeps separate members; union would make one solid.
export default group([base, post]);
