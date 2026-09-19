import {circle, line, revolve} from '@code3d/core';

const axis = line([0, -20, 0], [0, 20, 0]);
const wireSection = circle(1).rotate(90, 0, 0).originOffset(-8, 0, 0);

// Five turns around the axis, advancing 25 mm in total.
export default revolve(wireSection, axis, {
  angle: 1800,
  advance: 25,
}).material('#d8ff3e');
