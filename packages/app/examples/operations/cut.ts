import {box, cylinder, cut} from '@code3d/core';

const blank = box(30, 8, 20);
const drill = cylinder(4, 12);

export default cut(blank, [drill]);
