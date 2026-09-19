import {bezier, circle, sweep} from '@code3d/core';

const profile = circle(2);
const spine = bezier([
  [0, 0, 0],
  [0, 8, 0],
  [5, 16, 0],
  [5, 24, 0],
]);

// The profile origin meets the spine start; its +Y normal matches the tangent.
export default sweep(profile, spine).material('#8ce1ff');
