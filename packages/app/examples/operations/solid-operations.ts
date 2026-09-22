import {box, cylinder, cut, intersect, sphere, union} from '@code3d/core';

const base = box(30, 8, 20);
const boss = cylinder(5, 10).originOffset(0, -7, 0);
export const joined = union([base, boss]);

const blank = box(30, 8, 20);
const drill = cylinder(4, 12);
export const drilled = cut(blank, [drill]);

const block = box(18, 12, 18);
const ball = sphere(11).originOffset(-7, 0, 0);
export const shared = intersect([block, ball]);

export const rounded = box(30, 16, 20).fillet(2, [2, 4, 6, 8]);
export const beveled = box(30, 16, 20).chamfer(2, [2, 4, 6, 8]);
export const enclosure = box(40, 24, 30).shell(1.5, [4]);
