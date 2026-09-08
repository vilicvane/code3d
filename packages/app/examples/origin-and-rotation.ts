import {box, group} from '@code3d/core';

// Place the caret inside originVertex() to pick a corner in the viewport.
const blank = box(24, 6, 14).paint('#8ed5d1');
const pivoted = blank.originVertex(3);

// Drag in the starting snapshot; commit re-expresses the geometry around local zero.
const offset = pivoted.originOffset(0, 2, 0);

// Drag a ring to edit its angle. Angles are degrees: fixed X, then Y, then Z.
export const rotated = offset.rotate(15, 35, 0);

// The body's center follows its transforms. Make it local zero, then offset it.
export const centered = rotated.originCenter().originOffset(0, 2, 0);

// Offsets accumulate and can be cancelled with the opposite displacement.
export const restored = centered.originOffset(0, -2, 0);

// Named anchors follow rotations and remain available for relations.
const companion = box(5, 10, 5).relate(self => self.on(rotated.up));
export const assembly = group([rotated, companion]);
