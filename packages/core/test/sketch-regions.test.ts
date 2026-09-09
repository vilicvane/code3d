import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {
  sketch,
  extrude,
  rectangle,
  box,
  cut,
  loft,
  point,
  line,
  type SketchEntry,
  type SketchPosition,
  type Model,
} from '../bld/node/index.js';
import {replicad} from '../bld/node/replicad.js';
import {snapshotSketch} from '../bld/tooling/index.js';
import {sketchRegions, contourArea} from '../bld/library/sketch-regions.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

afterEach(() => clearKernelOperationCache());
const models: Model[] = [];
afterEach(() => disposeModelObjects(models.splice(0)));
const keep = <T extends Model>(model: T): T => (models.push(model), model);
const volume = (model: Model) =>
  replicad.measureVolume(modelGeometry(model).value.shape.asShape3D());
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}
function polygon(points: readonly SketchPosition[], first = 1): SketchEntry[] {
  return [
    ...points.map((p, i): SketchEntry => ['point', first + i, p]),
    ...points.map((_, i): SketchEntry => [
      'line',
      first + points.length + i,
      [first + i, first + ((i + 1) % points.length)],
    ]),
  ];
}
const square = (x = 0, y = 0, size = 10, first = 1) =>
  polygon(
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    first,
  );

test('empty sketches have zero faces, single points are not boundaries, face requires exactly one', () => {
  const empty = sketch([['point', 1, [0, 0]]]);
  assert.deepEqual(empty.faces(), []);
  assert.throws(() => empty.face(), /exactly one.*found 0/);
  const multi = sketch([...square(), ...square(20, 0, 10, 20)]);
  const faces = multi.faces();
  faces.forEach(keep);
  assert.equal(Array.isArray(faces), true);
  assert.equal(Object.getPrototypeOf(faces), Array.prototype);
  assert.equal(faces.length, 2);
  assert.equal('extrude' in faces, false);
  assert.throws(() => multi.face(), /exactly one.*found 2/);
  faces.map(f => keep(f.extrude(3))).forEach(m => near(volume(m), 300));
});

test('sketch faces retain authored coordinates, their plane and actual closed topology', () => {
  const source = sketch(square(10, 20, 5));
  const before = snapshotSketch(source, () => 's');
  const face = keep(source.face());
  const shape = modelGeometry(face).value.shape;
  assert.ok(shape instanceof replicad.Face);
  near(replicad.measureArea(shape), 25);
  const bounds = modelGeometry(face).value.localBounds;
  [10, 0, -25, 15, 0, -20].forEach((n, i) => near(bounds.flat()[i], n));
  assert.equal(face.edges().length, 4);
  assert.equal(face.vertices().length, 4);
  const normal = shape.normalAt();
  try {
    normal.toTuple().forEach((n, i) => near(n, [0, 1, 0][i]));
  } finally {
    normal.delete();
  }
  assert.deepEqual(
    snapshotSketch(source, () => 's'),
    before,
  );
});

test('unordered and reversed lines, point aliases and geometric endpoint coincidence close contours', () => {
  const entries = square();
  const reversed = entries
    .map((e): SketchEntry =>
      e[0] === 'line' ? ['line', e[1], [e[2][1], e[2][0]]] : e,
    )
    .reverse();
  for (const data of [
    entries,
    reversed,
    [
      ...entries.filter(e => e[1] !== 8),
      ['point', 9, 1],
      ['line', 8, [4, 9]],
    ] as SketchEntry[],
    [
      ...entries.filter(e => e[1] !== 8),
      ['point', 9, [0, 0]],
      ['line', 8, [4, 9]],
    ] as SketchEntry[],
  ])
    near(volume(keep(keep(sketch(data).face()).extrude(2))), 200);
});

test('nested contours alternate holes and islands without array-order semantics', () => {
  const source = sketch([
    ...square(8, 8, 4, 21),
    ...square(0, 0, 20),
    ...square(5, 5, 10, 11),
  ]);
  const regions = sketchRegions([snapshotSketch(source, () => 's')]);
  assert.deepEqual(regions.map(r => r.holes.length).sort(), [0, 1]);
  near(
    regions.reduce(
      (a, r) =>
        a +
        contourArea(r.outer) +
        r.holes.reduce((a, h) => a + contourArea(h), 0),
      0,
    ),
    316,
  );
  const solids = source.faces().map(f => keep(keep(f).extrude(3)));
  near(
    solids.reduce((a, s) => a + volume(s), 0),
    948,
  );
});

test('circular holes really remain open in the face and both extrusion directions', () => {
  const source = sketch([
    ['point', 1, [2, 3]],
    ['circle', 2, [1, 10]],
    ['circle', 3, [1, 4]],
  ]);
  const face = keep(source.face());
  const shape = modelGeometry(face).value.shape;
  assert.ok(shape instanceof replicad.Face);
  near(replicad.measureArea(shape), Math.PI * 84);
  for (const distance of [5, -5]) {
    const solid = keep(face.extrude(distance));
    near(volume(solid), Math.PI * 84 * 5);
    const probe = replicad.makeVertex([2, distance / 2, -3]);
    try {
      near(
        replicad.measureDistanceBetween(
          modelGeometry(solid).value.shape,
          probe,
        ),
        4,
      );
    } finally {
      probe.delete();
    }
  }
});

test('multiple circular holes and concentric islands use analytic containment', () => {
  const source = sketch([
    ...square(-20, -20, 40),
    ['point', 11, [-10, 0]],
    ['circle', 12, [11, 4]],
    ['point', 13, [10, 0]],
    ['circle', 14, [13, 5]],
    ['circle', 15, [13, 2]],
  ]);
  const solids = source.faces().map(f => keep(keep(f).extrude(2)));
  assert.equal(solids.length, 2);
  near(
    solids.reduce((a, s) => a + volume(s), 0),
    (1600 - Math.PI * 37) * 2,
  );
});

for (const direction of ['cw', 'ccw'] as const)
  test(`finite ${direction} arcs and lines create exact circular segments`, () => {
    const face = keep(
      sketch([
        ['point', 1, [0, 0]],
        ['point', 2, [10, 0]],
        ['point', 3, [-10, 0]],
        ['arc', 4, [1, 10, 2, 3, direction]],
        ['line', 5, [3, 2]],
      ]).face(),
    );
    near(volume(keep(face.extrude(2))), Math.PI * 100);
  });

test('derived boundaries close across upstream point references without changing the base', () => {
  const base = sketch([
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['line', 3, [1, 2]],
  ]);
  const child = base.derive([
    ['point', 1, [10, 10]],
    ['point', 2, [0, 10]],
    ['line', 3, [base.point(2), 1]],
    ['line', 4, [1, 2]],
    ['line', 5, [2, base.point(1)]],
  ]);
  near(volume(keep(keep(child.face()).extrude(2))), 200);
  assert.throws(() => base.face(), /open/);
});

test('invalid boundaries diagnose open, branched, crossing, tangent and overlapping contours', () => {
  const cases: SketchEntry[][] = [
    square().filter(e => e[1] !== 8),
    [...square(), ['point', 9, [15, 5]], ['line', 10, [1, 9]]],
    polygon([
      [0, 0],
      [10, 10],
      [0, 10],
      [10, 0],
    ]),
    [...square(), ...square(5, 5, 10, 20)],
    [...square(), ['line', 9, [1, 2]]],
    [
      ['point', 1, [0, 0]],
      ['point', 2, [10, 0]],
      ['circle', 3, [1, 5]],
      ['circle', 4, [2, 5]],
    ],
    [
      ['point', 1, [0, 0]],
      ['circle', 2, [1, 5]],
      ['circle', 3, [1, 5]],
    ],
  ];
  for (const entries of cases)
    assert.throws(
      () => sketch(entries).faces(),
      /open|branching|intersect|overlap/,
    );
});

test('extrusion follows rotated face normal and does not mutate or recenter its input', () => {
  const face = keep(rectangle(4, 6));
  const original = keep(face.extrude(3));
  const rotated = keep(face.rotate(0, 0, 90).originOffset(-10, 0, 0));
  const solid = keep(extrude(rotated, 3));
  near(volume(solid), 72);
  const b = modelGeometry(solid).value.localBounds;
  [7, -2, -3, 10, 2, 3].forEach((n, i) => near(b.flat()[i], n));
  const plain = modelGeometry(original).value.localBounds;
  [-2, 0, -3, 2, 3, 3].forEach((n, i) => near(plain.flat()[i], n));
  assert.equal(createModelSnapshotter()(solid).operation.kind, 'extrude');
});

test('extrusion cache keys include distance and profile, and inherited topology identifies the base', () => {
  const f = keep(sketch(square()).face());
  const same = keep(sketch(square()).face());
  assert.equal(modelGeometry(f).id, modelGeometry(same).id);
  const a = keep(f.extrude(2)),
    b = keep(extrude(same, 2)),
    c = keep(f.extrude(3));
  assert.equal(modelGeometry(a).id, modelGeometry(b).id);
  assert.notEqual(modelGeometry(a).id, modelGeometry(c).id);
  assert.ok(a.surfaces().some(s => Array.isArray(s.id)));
  assert.throws(() => f.extrude(0), /non-zero/);
  assert.throws(() => f.extrude(Infinity), /finite/);
  assert.equal(extrude([f], 2).map(keep).length, 1);
});

test('chain cut is one operation with ordinary multiple-tool inputs, matching the free function', () => {
  const stock = keep(box(30, 10, 30));
  const profile = keep(
    sketch([
      ['point', 1, [0, 0]],
      ['circle', 2, [1, 4]],
    ]).face(),
  );
  const tool = keep(profile.extrude(10).originOffset(0, 5, 0));
  const chain = keep(stock.cut([tool])),
    fn = keep(cut(stock, [tool]));
  near(volume(chain), 9000 - Math.PI * 160);
  near(volume(chain), volume(fn));
  assert.equal(modelGeometry(chain).id, modelGeometry(fn).id);
  assert.equal(createModelSnapshotter()(chain).operation.kind, 'cut');
  near(volume(stock), 9000);
});

for (const ruled of [true, false])
  for (const withSpine of [false, true])
    test(`loft preserves a single corresponding through hole (ruled=${ruled}, spine=${withSpine})`, () => {
      const profile = (r: number) =>
        keep(
          sketch([
            ['point', 1, [0, 0]],
            ['circle', 2, [1, r]],
            ['circle', 3, [1, 2]],
          ]).face(),
        );
      const base = profile(6);
      const location = keep(point([0, 10, 0]));
      const top = keep(profile(6).relate(f => f.on(location.up)));
      const spine = withSpine ? keep(line([0, 10, 0])) : undefined;
      const model = keep(loft([base, top], {ruled, spine}));
      near(volume(model), Math.PI * 32 * 10);
      for (const y of [0, 5, 10]) {
        const probe = replicad.makeVertex([0, y, 0]);
        try {
          near(
            replicad.measureDistanceBetween(
              modelGeometry(model).value.shape,
              probe,
            ),
            2,
          );
        } finally {
          probe.delete();
        }
      }
      const ids = model.surfaces().map(s => s.id);
      assert.ok(ids.some(id => JSON.stringify(id) === '[1,1]'));
      assert.ok(ids.some(id => JSON.stringify(id) === '[2,1]'));
    });

test('loft rejects differing hole topology and unpaired multiple holes instead of filling them', () => {
  const noHole = keep(rectangle(30, 30));
  const one = keep(
    sketch([
      ...square(-15, -15, 30),
      ['point', 11, [0, 0]],
      ['circle', 12, [11, 2]],
    ]).face(),
  );
  const two = keep(
    sketch([
      ...square(-15, -15, 30),
      ['point', 11, [-5, 0]],
      ['circle', 12, [11, 2]],
      ['point', 13, [5, 0]],
      ['circle', 14, [13, 2]],
    ]).face(),
  );
  assert.throws(() => loft([noHole, one]), /matching hole counts/);
  assert.throws(() => loft([two, two]), /explicit correspondence/);
});
