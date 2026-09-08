import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Ruler, type IconNode} from 'lucide';
import {
  CenterArc,
  CenterCircle,
  CenterRectangle,
  LineSegment,
  Protractor,
  Rectangle,
  sketchConstraintIcons,
} from '../src/ui/sketch-icons.ts';

const points = (icon: IconNode) =>
  icon
    .filter(([tag, attributes]) => tag === 'circle' && attributes.r === '2')
    .map(([, {cx, cy}]) => [Number(cx), Number(cy)]);

test('drawing icons show the generated endpoints and centers with a shared point size', () => {
  assert.deepEqual(points(LineSegment), [
    [4, 20],
    [20, 4],
  ]);
  assert.deepEqual(points(Rectangle), [
    [4, 6],
    [20, 6],
    [20, 18],
    [4, 18],
  ]);
  assert.deepEqual(points(CenterRectangle), [...points(Rectangle), [12, 12]]);
  assert.deepEqual(points(CenterCircle), [[12, 12]]);
  assert.deepEqual(points(CenterArc), [
    [4, 18],
    [18, 4],
    [18, 18],
  ]);
  assert.ok(Rectangle.every(([, attrs]) => !attrs.rx && !attrs.ry));
  assert.deepEqual(CenterCircle[0], ['circle', {cx: '12', cy: '12', r: '9'}]);
});

test('dimensions use measuring tools and direction crosses distinguish solid and dashed axes', () => {
  assert.equal(sketchConstraintIcons.length, Ruler);
  assert.equal(sketchConstraintIcons.orientation, Protractor);
  const horizontal = sketchConstraintIcons.horizontal;
  const vertical = sketchConstraintIcons.vertical;
  for (const icon of [horizontal, vertical]) {
    assert.ok(icon.every(([tag]) => tag === 'path'));
    assert.equal(icon.filter(([, a]) => a['stroke-dasharray']).length, 1);
    assert.equal(icon[0][1].opacity, undefined);
    const [dash, gap] = String(icon[0][1]['stroke-dasharray'])
      .split(' ')
      .map(Number);
    assert.ok(dash < gap);
    assert.equal(icon[1][1].opacity, undefined);
  }
  assert.equal(horizontal[0][1].d, vertical[1][1].d);
  assert.equal(horizontal[1][1].d, vertical[0][1].d);
  assert.equal(horizontal[1][1].d, 'M3 12h18');
  assert.equal(vertical[1][1].d, 'M12 3v18');
});
