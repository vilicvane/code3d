import {box, group} from '@code3d/core';

// Put both part origins at their contact plane, then assemble directly.
const baseHeight = 6;
const lidHeight = 4;
const base = box(24, baseHeight, 14)
  .originOffset(0, baseHeight / 2, 0)
  .material('#8ed5d1');
const lid = box(16, lidHeight, 10)
  .originOffset(0, -lidHeight / 2, 0)
  .material('#d9b478');
export const direct = group([base, lid]).expose({base, lid});

// Select the member's center in assembly coordinates. Drag the origin arrows
// inside originPoint() to append originOffset() while preserving the assembly.
export const centered = direct.originPoint(lid.center);
export const offset = centered.originOffset(0, 2, 0);

// Position two copies by shifting their geometry about the shared zero point.
// Their lid centers end up at X = -20 and X = 40; group keeps that same origin.
const leftPart = centered.originOffset(20, 0, 0);
const rightPart = centered.originOffset(-40, 0, 0);
const pair = group([leftPart, rightPart]).expose({leftPart, rightPart});
// Select the center from the intended occurrence of the repeated assembly.
export const mounted = pair.originPoint(rightPart.lid.center);

// Rotate both instances together about the selected lid center. Drag the rings
// inside rotate() to change the angles without changing the internal assembly.
export const rotated = mounted.rotate(0, 0, 30);
