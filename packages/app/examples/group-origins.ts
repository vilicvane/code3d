import {box, group, point} from '@code3d/core';

// Put both part origins at their contact plane, then assemble directly.
const base = box(24, 6, 14).originOffset(0, 3, 0).paint('#8ed5d1');
const lid = box(16, 4, 10).originOffset(0, -2, 0).paint('#d9b478');
export const direct = group([base, lid]).expose({base, lid});

// Select the member's center in assembly coordinates. Drag the origin arrows
// inside originPoint() to append originOffset() while preserving the assembly.
export const centered = direct.originPoint(lid.center);
export const offset = centered.originOffset(0, 2, 0);

// Each nested assembly contributes its own origin. Two instances require
// references from the intended occurrence, such as rightPart.lid.center.
const leftPart = direct.relate(self =>
  self.lid.center.align(point([-20, 0, 0])),
);
const rightPart = direct.relate(self =>
  self.lid.center.align(point([40, 0, 0])),
);
const pair = group([leftPart, rightPart]).expose({leftPart, rightPart});
export const mounted = pair.originPoint(rightPart.lid.center);
