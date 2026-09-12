import {box, cylinder, extrude, googleFont, group, text} from '@code3d/core';

export function makePanel() {
  const blank = box(100, 3, 70);
  const shaft = cylinder(3.2, 6).originOffset(20, 0, 0);
  const holes = [-44, 44].flatMap(x =>
    [-29, 29].map(z => cylinder(1.7, 6).originOffset(-x, 0, -z)),
  );
  const plate = blank.cut([shaft, ...holes]).material('#353a33');
  const label = makeLabel().originOffset(28, -1.5, -22);
  return group([plate, label], 'Controller panel').expose({
    mountingFace: blank.down,
    axis: blank.axis,
    top: blank.up,
    knobAxis: shaft.axis,
  });
}

export default makePanel();

function makeLabel() {
  const sans = googleFont('Play');
  // Local alternative: font(new URL('./my-font.ttf', import.meta.url)).
  return group(extrude(text('GAIN', sans, 5), 0.5)).material('#e8b45d');
}
