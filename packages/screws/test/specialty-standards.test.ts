import assert from 'node:assert/strict';
import test from 'node:test';
import * as screws from '@code3d/screws';
import {box, cut, cylinder, intersect} from '@code3d/core';

import {
  keep,
  near,
  y,
  volume,
  headedStandardTests,
  releaseModels,
} from './standard-test.ts';
const {ISO7379} = screws;

headedStandardTests(['ISO14583']);

test('hexalobular drive has six open lobes and material between them', () => {
  const screw = keep(screws.ISO14583.screw('M6', 16));
  const {recess} = screws.ISO14583.resolveSpecification('M6');
  const radius = (recess.diameter + recess.innerDiameter) / 4;
  const probe = cylinder(0.03, 0.1);
  const headTool = keep(
    box(20, 3, 20).originOffset(0, -y(screw.headTop) + 1.5, 0),
  );
  const head = keep(intersect([screw, headTool]));
  const original = volume(head);
  for (let i = 0; i < 6; i++) {
    for (const valley of [false, true]) {
      const angle = ((i + (valley ? 0.5 : 0)) * Math.PI) / 3;
      const tool = keep(
        probe.originOffset(
          -radius * Math.cos(angle),
          -y(screw.headTop) + recess.depth / 2,
          -radius * Math.sin(angle),
        ),
      );
      const after = volume(keep(cut(head, [tool])));
      if (valley) assert.ok(original - after > 0.0001);
      else near(after, original);
    }
  }
  keep(probe);
});

test('ISO 7379 separates shoulder length from its fixed threaded projection', () => {
  for (const size of [6.5, 10, 16] as const) {
    const spec = ISO7379.resolveSpecification(size);
    const screw = keep(ISO7379.screw(size, 20));
    near(y(screw.shoulderTop) - y(screw.shoulderBottom), 20);
    near(y(screw.threadTop), y(screw.shoulderBottom));
    near(y(screw.threadTop) - y(screw.threadBottom), spec.threadLength);
    near(
      y(screw.headTop) - y(screw.threadBottom),
      20 + spec.threadLength + spec.headHeight,
    );
    assert.ok(volume(screw) > 0);
    const hole = keep(ISO7379.clearanceHole(size, 10));
    near(volume(hole), Math.PI * ((size + 0.2) / 2) ** 2 * 10);
    assert.throws(() => ISO7379.screw(size, 2), /relief length/);
    releaseModels();
  }
});

test('ISO 7379 counterbores keep shoulder clearance and seat the head inside the plate', () => {
  const hole = keep(ISO7379.clearanceHole(8, {depth: 12, counterbore: true}));
  near(volume(hole), Math.PI * (4.1 ** 2 * 6 + 7 ** 2 * 6));
  near(y(hole.shaftTop) - y(hole.shaftBottom), 12);
  near(y(hole.counterboreTop), y(hole.shaftTop));
  near(y(hole.counterboreTop) - y(hole.counterboreBottom), 6);
  const screw = keep(
    ISO7379.screw(8, 20).relate(part =>
      part.headBottom.on(hole.counterboreBottom),
    ),
  );
  const stock = keep(box(30, 12, 30));
  const plate = keep(cut(stock, [hole]));
  near(volume(keep(cut(plate, [screw]))), volume(plate));
});

test('ISO 7379 accepts custom counterbore dimensions and rejects invalid recesses', () => {
  const custom = keep(
    ISO7379.clearanceHole(8, {
      depth: 12,
      diameter: 8.5,
      counterbore: {diameter: 15, depth: 7, axialClearance: 2},
    }),
  );
  near(volume(custom), Math.PI * (4.25 ** 2 * 5 + 7.5 ** 2 * 7));
  near(y(custom.counterboreTop) - y(custom.counterboreBottom), 7);
  const flush = keep(
    ISO7379.clearanceHole(8, {depth: 12, counterbore: {axialClearance: 0}}),
  );
  near(y(flush.counterboreTop) - y(flush.counterboreBottom), 5.5);
  const plain = keep(
    ISO7379.clearanceHole(8, {depth: 12, diameter: 8.5, counterbore: false}),
  );
  near(volume(plain), Math.PI * 4.25 ** 2 * 12);
  assert.equal('counterboreBottom' in plain, false);
  for (const counterbore of [
    {diameter: 12},
    {depth: 13},
    {depth: 0},
    {axialClearance: -1},
    {axialClearance: NaN},
  ]) {
    assert.throws(
      () => ISO7379.clearanceHole(8, {depth: 12, counterbore}),
      /Counterbore|Axial clearance/,
    );
  }
});
