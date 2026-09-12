import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GB70_1,
  GB70_2,
  GB70_3,
  GB70_4,
  GB5782,
  GB5783,
  GB818,
  GB2672,
  GB80,
  GB5281,
} from '@code3d/screws';
import {keep, near, y, volume} from './standard-test.ts';

test('GB presets retain the selected head, drive and shoulder dimensions', () => {
  assert.equal(GB70_1.specifications.M6.headDiameter, 10);
  assert.equal(GB70_2.specifications.M6.headHeight, 3.3);
  assert.equal(GB70_3.specifications.M6.headDiameter, 13.44);
  assert.equal(GB70_4.specifications.M6.headDiameter, 13.6);
  assert.equal(GB5782.specifications.M10.headWidth, 16);
  assert.equal(GB5783.specifications.M12.headWidth, 18);
  assert.equal(GB818.specifications.M3.headDiameter, 5.6);
  assert.equal(GB2672.specifications.M6.headDiameter, 12);
  assert.equal(GB80.specifications.M6.pitch, 1);
  assert.equal(GB5281.specifications[8].nominalDiameter, 6);
  assert.equal(GB5281.specifications[8].threadLength, 11);
  assert.equal(GB5782.threadLength(GB5782.specifications.M6, 30), 18);
  assert.equal(GB5783.threadLength(GB5783.specifications.M6, 30), 30);
});

test('GB cap, countersunk and shoulder holes preserve their recess options and datums', () => {
  const cap = keep(GB70_1.clearanceHole('M6', 12));
  assert.ok(volume(cap) > 0);
  near(y(cap.shaftTop) - y(cap.shaftBottom), 12);
  near(y(cap.counterboreTop), y(cap.shaftTop));
  const plain = keep(
    GB70_1.clearanceHole('M6', {depth: 12, counterbore: false}),
  );
  near(volume(plain), Math.PI * 3.3 ** 2 * 12);
  assert.equal('counterboreBottom' in plain, false);

  const countersunk = keep(
    GB70_3.clearanceHole('M6', {depth: 12, countersink: {diameter: 15}}),
  );
  near(y(countersunk.countersinkTop) - y(countersunk.countersinkBottom), 4.2);
  assert.equal(
    'countersinkTop' in
      keep(
        GB70_3.clearanceHole('M6', {
          depth: 12,
          countersink: false,
        }),
      ),
    false,
  );

  const shoulder = keep(
    GB5281.clearanceHole(8, {
      depth: 12,
      diameter: 8.5,
      counterbore: {diameter: 15, depth: 7},
    }),
  );
  near(y(shoulder.counterboreTop) - y(shoulder.counterboreBottom), 7);
  near(volume(shoulder), Math.PI * (4.25 ** 2 * 5 + 7.5 ** 2 * 7));
  assert.equal('clearanceHole' in GB80, false);
});
