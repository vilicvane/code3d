import {box, cylinder, union} from '@code3d/core';

export function makeBox() {
  const blank = box(80, 24, 60);
  const cavity = box(76, 24, 56).originOffset(0, -2, 0);
  // Keep the four top rim edges sharp; round the other outer edges.
  const shell = blank.fillet(1, [1, 2, 4, 5, 6, 8, 9, 10]).cut([cavity]); // 2 mm walls and floor; flat mating rim.
  const posts = [-34, 34].flatMap(x =>
    [-24, 24].map(z => cylinder(5, 22).originOffset(-x, -1, -z)),
  );
  // Round posts overlap the adjacent walls. Blind M4 pilots omit thread geometry.
  const pilots = [-34, 34].flatMap(x =>
    [-24, 24].map(z => cylinder(1.65, 12).originOffset(-x, -6, -z)),
  );
  return union([shell, ...posts])
    .cut(pilots)
    .expose({lidSeat: blank.up});
}

export default makeBox();
