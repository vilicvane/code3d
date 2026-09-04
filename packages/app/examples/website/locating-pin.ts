import {box, cylinder, group} from '@code3d/core';

function locatingPin(radius: number, height: number) {
  const body = cylinder(radius, height);
  return body.expose({
    mountingFace: body.bottom,
    tipFace: body.top,
    centerline: body.axis,
  });
}

const plate = box(32, 4, 24).fillet(1);
const pin = locatingPin(3, 16)
  .paint('#d8ff3e')
  .relate(part => part.mountingFace.on(plate.top));
const cap = cylinder(5, 3).relate(part => part.bottom.on(pin.tipFace));

export const model = group([plate, pin, cap]);
