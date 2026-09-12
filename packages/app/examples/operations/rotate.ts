import {box} from '@code3d/core';

const blank = box(24, 6, 14);
// Rotate around local zero. Select rotate(...) and drag a ring to edit the angle.
export default blank.rotate(15, 35, 0);
