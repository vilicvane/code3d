import {box, cylinder, group} from '@code3d/core';

const accent = '#d8ff3e';
const neutral = '#343934';

function locatingPin(radius: number, height: number) {
  const blank = cylinder(radius, height);
  return blank.expose({
    datum: blank.center,
    mountingFace: blank.bottom,
    tipFace: blank.top,
    centerline: blank.axis,
    referenceFrame: blank,
  });
}

const bracket = box(26, 5, 18).chamfer(1).paint(neutral);
const pin = locatingPin(3, 12)
  .paint(accent)
  .relate(part => part.mountingFace.on(bracket.top));
const cap = cylinder(5, 2)
  .paint(neutral)
  .relate(part => part.bottom.on(pin.tipFace));

export const relationsAndElementsExample = group(
  [bracket, pin, cap],
  'Relations and typed elements',
);
