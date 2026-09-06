import {box, cylinder, group} from '@code3d/core';

function locatingPin(radius: number, height: number) {
  const body = cylinder(radius, height);
  return body.expose({
    mountingFace: body.down,
    tipFace: body.up,
    centerline: body.axis,
  });
}

const plate = box(32, 4, 24).fillet(1);
const pin = locatingPin(3, 16)
  .paint('#d8ff3e')
  .relate(part => part.mountingFace.on(plate.up));
const cap = cylinder(5, 3).relate(part => part.on(pin.tipFace));

export const model = group([plate, pin, cap]);
