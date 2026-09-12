import {offset, group} from '@code3d/core';
import {plastic, steel} from '@code3d/materials';
import {ISO4762} from '@code3d/screws';
import {makeBox} from './box.ts';
import {makeLid} from './lid.ts';

/**
 * Lift the lid to inspect its counterbores and the box's tapping pilots.
 * @code3d.param gap {kind: 'length', default: 14, constraints: {min: 0, max: 30}}
 * @code3d.arguments [14]
 * @code3d.arguments [0]
 */
export function screwBox(gap = 14) {
  const body = makeBox().material(plastic('#353535'));
  const lid = makeLid()
    .material(plastic('#353535'))
    .relate(part => [
      part.axis.align(body.axis),
      part.mountingFace.on(body.lidSeat),
      offset(0, gap, 0),
    ]);
  const screw = ISO4762.screw('M4', 12).material(
    steel({color: '#d0d0d0', roughness: 0.28}),
  );
  const screws = [
    lid.frontLeft,
    lid.backLeft,
    lid.frontRight,
    lid.backRight,
  ].map(hole =>
    screw.relate(part => [
      part.shankAxis.align(hole.shaftAxis),
      part.headBottom.on(hole.counterboreBottom.flip()),
    ]),
  );
  return group([body, lid, ...screws], 'Screw-fastened box');
}

export default screwBox(14);
// More sizes, fits and finishes: @code3d/screws and @code3d/materials READMEs.
