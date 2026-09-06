import {
  arc,
  box,
  circle,
  cylinder,
  group,
  line,
  point,
  rectangle,
} from '@code3d/core';

// align places real geometric references. on remains a translation-only bound contact.
const base = box(80, 6, 50).paint('#405968');
const axle = cylinder(6, 24)
  .relate(self => [self.axis.align(base.axis), self.on(base.up)])
  .paint('#eea65b');

// Equal supporting circles can coincide even when their arc ranges differ.
const firstArc = arc([20, 0, 0], [0, 20, 0], [-20, 0, 0]);
const secondArc = arc([0, 20, 0], [-20, 0, 0], [0, -20, 0])
  .relate(self => self.align(firstArc).offset(0, 0, 28))
  .paint('#77d7ed');

// The point is outside the trimmed segment, but on its underlying straight line.
const rail = line([30, 30, 0], [55, 30, 0]);
const locator = point([15, 50, 8]).relate(self => self.align(rail));

// A flipped target face changes the normal direction; the rotation pivot belongs to self.
const platform = rectangle(18, 12)
  .relate(self =>
    self
      .align(circle(12).plane.flip())
      .offset(25, 35, 0)
      .pivot(4, 0, 0)
      .rotate(0, 0, 20),
  )
  .paint('#92ddaa');

export default group([
  base,
  axle,
  firstArc,
  secondArc,
  rail,
  locator,
  platform,
]);
