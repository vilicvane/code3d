import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  sketchArcGeometry,
  sketchCurveIntersections,
  sketchCurvePosition,
  type SketchCurve,
  type SketchPosition,
} from '../bld/tooling/index.js';

const line = (a: SketchPosition, b: SketchPosition): SketchCurve => ({
  kind: 'line',
  points: [a, b],
});
const circle = (center: SketchPosition, radius = 1): SketchCurve => ({
  kind: 'circle',
  center,
  radius,
});
const polar = (degrees: number): SketchPosition => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
];
const arc = (a: number, b: number, direction: 'cw' | 'ccw' = 'ccw') =>
  sketchArcGeometry([0, 0], polar(a), polar(b), direction);
const near = (
  actual: SketchPosition,
  expected: SketchPosition,
  tolerance = 1e-9,
) =>
  assert.ok(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) <= tolerance,
    `${actual} != ${expected}`,
  );
function check(
  a: SketchCurve,
  b: SketchCurve,
  expected: readonly SketchPosition[],
  tolerance = 1e-9,
) {
  const original = structuredClone([a, b]);
  const contacts = sketchCurveIntersections(a, b);
  assert.equal(contacts.length, expected.length);
  contacts.forEach((contact, i) => {
    near(contact.position, expected[i], tolerance);
    near(sketchCurvePosition(a, contact.parameters[0]), expected[i], tolerance);
    near(sketchCurvePosition(b, contact.parameters[1]), expected[i], tolerance);
  });
  const reverse = sketchCurveIntersections(b, a);
  assert.equal(reverse.length, contacts.length);
  for (const contact of reverse)
    assert.ok(
      contacts.some(
        other =>
          Math.hypot(
            ...[
              contact.position[0] - other.position[0],
              contact.position[1] - other.position[1],
            ],
          ) <= tolerance,
      ),
    );
  assert.deepEqual([a, b], original);
  return contacts;
}

test('finite line intersections include endpoints and degenerate points, not extensions', () => {
  const a = line([-2, 0], [2, 0]);
  assert.deepEqual(
    check(a, line([0, -2], [0, 2]), [[0, 0]])[0].parameters,
    [0.5, 0.5],
  );
  check(a, line([3, -2], [3, 2]), []);
  check(a, line([2, 0], [2, 3]), [[2, 0]]);
  check(a, line([0, 0], [0, 0]), [[0, 0]]);
  check(a, line([0, 1], [0, 1]), []);
});

test('collinear intervals report only finite overlap boundaries, including reversed lines', () => {
  const a = line([-2, 0], [2, 0]);
  check(a, line([3, 0], [-1, 0]), [
    [-1, 0],
    [2, 0],
  ]);
  check(a, line([2, 0], [-2, 0]), [
    [-2, 0],
    [2, 0],
  ]);
  check(a, line([3, 0], [4, 0]), []);
  check(a, line([2, 0], [4, 0]), [[2, 0]]);
});

test('line/circle crossings distinguish tangent, near-tangent and disjoint geometry', () => {
  check(line([-2, 0], [2, 0]), circle([0, 0]), [
    [-1, 0],
    [1, 0],
  ]);
  check(line([-2, 1], [2, 1]), circle([0, 0]), [[0, 1]]);
  check(line([-2, 1 + 1e-7], [2, 1 + 1e-7]), circle([0, 0]), []);
  const y = 1 - 1e-7,
    x = Math.sqrt((1 - y) * (1 + y));
  check(line([-2, y], [2, y]), circle([0, 0]), [
    [-x, y],
    [x, y],
  ]);
  check(line([2, 0], [3, 0]), circle([0, 0]), []);
});

test('finite arc intersections honor CW/CCW, major arcs and the zero-angle seam', () => {
  const x = Math.sqrt(0.75);
  check(line([-2, 0.5], [2, 0.5]), arc(0, 90), [[x, 0.5]]);
  check(line([-2, 0.5], [2, 0.5]), arc(0, 90, 'cw'), [[-x, 0.5]]);
  check(line([-2, -0.5], [2, -0.5]), arc(0, 90), []);
  check(line([-2, -0.5], [2, -0.5]), arc(0, 90, 'cw'), [
    [-x, -0.5],
    [x, -0.5],
  ]);
  const y = Math.sqrt(1 - 0.99 ** 2);
  check(line([0.99, -2], [0.99, 2]), arc(350, 10), [
    [0.99, -y],
    [0.99, y],
  ]);
});

test('circular intersections handle external/internal tangency, containment and finite arcs', () => {
  check(circle([0, 0]), circle([2, 0]), [[1, 0]]);
  check(circle([0, 0], 2), circle([1, 0]), [[2, 0]]);
  check(circle([0, 0]), circle([3, 0]), []);
  const d = 2 - 1e-7,
    y = Math.sqrt((1 - d / 2) * (1 + d / 2));
  check(circle([0, 0]), circle([d, 0]), [
    [d / 2, y],
    [d / 2, -y],
  ]);
  check(circle([0, 0]), circle([2 + 1e-7, 0]), []);
  check(circle([0, 0], 2), circle([0.1, 0], 0.1), []);
  check(circle([0, 0], 2), circle([0, 0]), []);
  check(circle([0, 0]), circle([1, 0]), [
    [0.5, Math.sqrt(0.75)],
    [0.5, -Math.sqrt(0.75)],
  ]);
  check(arc(0, 90), circle([1, 0]), [[0.5, Math.sqrt(0.75)]]);
});

test('coincident circular supports report actual arc boundaries, not an artificial circle seam', () => {
  check(circle([0, 0]), circle([0, 0]), []);
  check(arc(0, 90), circle([0, 0]), [polar(0), polar(90)]);
  check(arc(0, 90), arc(45, 135), [polar(45), polar(90)]);
  check(arc(0, 90), arc(180, 270), []);
  check(arc(0, 90, 'cw'), arc(90, 0), [polar(0), polar(90)]);
});

test('intersections are scale/translation/rotation invariant and retain both parameterizations', () => {
  for (const scale of [1e-6, 1, 1e6])
    for (const angle of [0, 0.3, Math.PI / 2, Math.PI]) {
      const transform = ([x, y]: SketchPosition): SketchPosition => [
        scale * (100 + x * Math.cos(angle) - y * Math.sin(angle)),
        scale * (-80 + x * Math.sin(angle) + y * Math.cos(angle)),
      ];
      check(
        line(transform([-2, 0]), transform([2, 0])),
        circle(transform([0, 0]), scale),
        [transform([-1, 0]), transform([1, 0])],
        scale * 1e-8,
      );
      check(
        circle(transform([0, 0]), scale),
        circle(transform([2, 0]), scale),
        [transform([1, 0])],
        scale * 1e-6,
      );
    }
});

test('a tiny circle crossing a long line retains two distinct contacts', () => {
  const contacts = sketchCurveIntersections(
    line([-1e6, 0], [1e6, 0]),
    circle([0, 0], 1e-6),
  );
  assert.equal(contacts.length, 2);
  near(contacts[0].position, [-1e-6, 0], 1e-15);
  near(contacts[1].position, [1e-6, 0], 1e-15);
});
