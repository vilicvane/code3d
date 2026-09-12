import {box, intersect, sphere} from '@code3d/core';

const blank = box(18, 12, 18);
const ball = sphere(11).originOffset(-7, 0, 0);

// Keep only the volume shared by both inputs.
export default intersect([blank, ball]);
