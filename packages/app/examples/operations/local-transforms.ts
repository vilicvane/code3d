import {box, line, originCenter, rectangle} from '@code3d/core';

export const bottomZero = box(24, 6, 14).originOffset(0, -3, 0);

const path = line([10, 0, 0], [30, 0, 0]);
export const midpointZero = path.originPoint(path.midpoint);

export const cornerZero = box(24, 6, 14).originVertex(3);

const left = rectangle(8, 4);
const right = rectangle(4, 2).originOffset(-14, 0, 0);
export const centeredLayout = originCenter([left, right]);

export const rotated = box(20, 4, 8).originOffset(-10, 0, 0).rotate(0, 0, 45);
export const enlarged = box(12, 4, 8).originOffset(-10, 0, 0).scaled(2);
