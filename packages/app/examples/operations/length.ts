import {arc, circle, group, line} from '@code3d/core';

const straight = line([0, 0, 0], [30, 40, 0]);
const curved = arc([20, 0, 0], [0, 20, 0], [-20, 0, 0]).originOffset(-60, 0, 0);
const ring = circle(18).originOffset(-115, 0, 0);

// Select each .length to inspect the measured edge and its read-only value.
const straightLength = straight.length; // 50
const arcLength = curved.length; // 20 * Math.PI, not the endpoint distance
const circumference = ring.edges()[0].length; // 36 * Math.PI

export default group([straight, curved, ring]);
