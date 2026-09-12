import {box} from '@code3d/core';

const blank = box(24, 6, 14);
// Pick a corner, move the local zero, or return it to the geometric center.
export const pivoted = blank.originVertex(3);
export const offset = pivoted.originOffset(0, 2, 0);
export const centered = offset.originCenter();
export const fromPoint = blank.originPoint(blank.center);
