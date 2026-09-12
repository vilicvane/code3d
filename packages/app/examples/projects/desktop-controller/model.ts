import {
  box,
  cylinder,
  group,
  regularPrism,
  intersect,
  sphere,
} from '@code3d/core';
import {plastic, steel} from '@code3d/materials';
import {ISO4762} from '@code3d/screws';
import {makeEnclosure} from './enclosure.ts';
import {makePanel} from './panel.ts';

// A modeling study; board and controls are placeholders, not verified electronics.
const body = makeEnclosure().material(plastic({color: '#8ed5d1'}));
const panel = makePanel().relate(part => [
  part.axis.align(body.axis),
  part.mountingFace.on(body.panelSeat),
]);
const knob = makeKnob(12, 10, 12).relate(part => [
  part.axis.align(panel.knobAxis),
  part.down.on(panel.top),
]);
const key = keycap(6).relate(part => [
  part.axis.align(panel.axis).offset(22, 0, 0),
  part.down.on(panel.top),
]);

export default group(
  [body, panel, knob, key, ...internalParts(), ...panelScrews()],
  'Desktop controller',
);

function internalParts() {
  const board = box(80, 1.6, 50).originOffset(0, 6, 0).material('#315844');
  const posts = [-34, 34].flatMap(x =>
    [-19, 19].map(z =>
      cylinder(3, 6).originOffset(-x, 9, -z).material('#353a33'),
    ),
  );
  return [board, ...posts];
}

function panelScrews() {
  return [-44, 44].flatMap(x =>
    [-29, 29].map(z =>
      ISO4762.screw('M3', 8).originOffset(-x, -17, -z).material(steel()),
    ),
  );
}

function makeKnob(radius: number, height: number, sides: number) {
  return regularPrism(radius, height, sides, 30)
    .fillet(0.6)
    .material('#d8ff3e');
}

function keycap(height: number) {
  const blank = box(18, height, 18).fillet(1);
  const dome = sphere(22).originOffset(0, 21 - height / 2, 0);
  const socket = cylinder(2, 3).originOffset(0, height / 2 - 1.5, 0);
  return intersect([blank, dome]).cut([socket]).material('#d8ff3e');
}
