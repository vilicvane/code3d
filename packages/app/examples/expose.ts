import {box, cylinder, group} from '@code3d/core';

/**
 * A locating pin exposes its mating references to the next model.
 * @code3d.param radius {kind: 'length', default: 3}
 * @code3d.param height {kind: 'length', default: 16}
 */
export function locatingPin(radius = 3, height = 16) {
  const pin = cylinder(radius, height);
  return pin.expose({
    mountingFace: pin.down,
    tipFace: pin.up,
    centerline: pin.axis,
  });
}

const plate = box(32, 4, 24).fillet(1);
const pin = locatingPin(3, 16)
  .material('#d8ff3e')
  .relate(part => part.mountingFace.on(plate.up));
const cap = cylinder(5, 3).relate(part => [
  part.axis.align(pin.centerline),
  part.down.on(pin.tipFace),
]);

export const model = group([plate, pin, cap]);
