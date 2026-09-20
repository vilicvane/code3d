import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {replicad} from '@code3d/core/replicad';
import {group, intersect} from '@code3d/core';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from '../../core/test/model-test.ts';
import {
  assembleGears,
  helicalGear,
  internalGear,
  nominalCenterDistance,
  spurGear,
} from '../src/library/index.ts';
import {resolveToothDimensions} from '../src/library/specification.ts';
import type {Gear} from '../src/library/index.ts';

const models: Gear[] = [];
after(() => disposeModelObjects(models));
const keep = (gear: Gear) => (models.push(gear), gear);
const volume = (gear: Gear) =>
  replicad.measureVolume(modelGeometry(gear).value.shape.asShape3D());
const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-6,
      `${value} ≠ ${expected[index]}`,
    ),
  );

test('external gears produce complete bore, keyway, hub and shaft solids', () => {
  const plain = keep(
    spurGear({module: 2, teeth: 24, faceWidth: 10, mounting: {kind: 'solid'}}),
  );
  const bored = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {kind: 'bore', diameter: 8},
    }),
  );
  const hub = {diameter: 20, length: 6, side: 'up' as const};
  const hubbed = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {kind: 'bore', diameter: 8, hub},
    }),
  );
  const keyed = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {
        kind: 'bore',
        diameter: 8,
        hub,
        keyway: {width: 2.4, depth: 1.2},
      },
    }),
  );
  const shafted = keep(
    spurGear({
      module: 2,
      teeth: 24,
      faceWidth: 10,
      mounting: {
        kind: 'shaft',
        diameter: 7,
        upExtension: 13,
        downExtension: 16,
      },
    }),
  );

  assert.ok(volume(plain) > volume(bored));
  assert.ok(volume(hubbed) > volume(bored));
  assert.ok(volume(hubbed) > volume(keyed));
  assert.ok(volume(shafted) > volume(plain));
  assert.ok(Math.abs(plain.bounds().size[0] - 52) < 0.01);
  assert.ok(Math.abs(shafted.bounds().size[1] - 39) < 0.01);
  assert.ok(shafted.gearAxis);
  assert.ok(shafted.gearFaceUp);
  assert.ok(shafted.gearFaceDown);
});

test('helical normal module and hand produce full solids', () => {
  const common = {
    normalModule: 2,
    teeth: 22,
    faceWidth: 12,
    helixAngle: 20,
    mounting: {kind: 'bore', diameter: 9} as const,
  };
  const right = keep(helicalGear({...common, hand: 'right'}));
  const left = keep(helicalGear({...common, hand: 'left'}));
  assert.ok(volume(right) > 0);
  assert.ok(Math.abs(volume(right) - volume(left)) < 0.1);
  assert.ok(right.bounds().size[1] >= 11.99);
});

test('internal tooth ring and bolt pattern remove distinct volumes', () => {
  const common = {
    module: 2,
    teeth: 48,
    faceWidth: 10,
    outerDiameter: 130,
  };
  const plain = keep(internalGear(common));
  const bolted = keep(
    internalGear({
      ...common,
      boltPattern: {count: 6, circleDiameter: 116, holeDiameter: 3},
    }),
  );
  assert.ok(volume(plain) > volume(bolted));
  assert.ok(Math.abs(plain.bounds().size[0] - 130) < 0.01);
  assert.ok(bolted.gearAxis);
});

test('standards and dimensions reject unsupported nominal parts', () => {
  const base = {module: 2, teeth: 24, faceWidth: 10};
  keep(spurGear({...base, module: 1.125, standards: {moduleSeries: 'ISO54'}}));
  const spur = resolveToothDimensions('external', 2, 24, 10, 0);
  assert.equal(spur.pitchRadius, 24);
  assert.equal(spur.tipRadius, 26);
  assert.equal(spur.rootRadius, 21.5);
  const helical = resolveToothDimensions('external', 2, 24, 10, 20);
  assert.ok(
    Math.abs(helical.transverseModule - 2 / Math.cos((20 * Math.PI) / 180)) <
      1e-10,
  );
  const internal = resolveToothDimensions('internal', 2, 48, 10, 0);
  assert.equal(internal.tipRadius, 46);
  assert.equal(internal.rootRadius, 50.5);
  assert.throws(
    () => spurGear({...base, module: 0.8, standards: {moduleSeries: 'ISO54'}}),
    /outside ISO54/,
  );
  assert.throws(() => spurGear({...base, teeth: 12}), /at least 18/);
  assert.throws(
    () =>
      helicalGear({
        normalModule: 2,
        teeth: 24,
        faceWidth: 10,
        helixAngle: 0,
        hand: 'right',
      }),
    /positive helix angle/,
  );
  assert.throws(
    () =>
      spurGear({
        ...base,
        mounting: {kind: 'bore', diameter: 8, keyway: {width: 2, depth: 25}},
      }),
    /Keyway must fit/,
  );
  assert.throws(
    () =>
      internalGear({
        module: 2,
        teeth: 48,
        faceWidth: 10,
        outerDiameter: 104,
        boltPattern: {count: 6, circleDiameter: 100, holeDiameter: 6},
      }),
    /Bolt holes must fit/,
  );
});

test('nominal center distance covers external, internal and helical pairs', () => {
  const small = keep(spurGear({module: 2, teeth: 20, faceWidth: 10}));
  const large = keep(spurGear({module: 2, teeth: 24, faceWidth: 10}));
  const ring = keep(
    internalGear({module: 2, teeth: 48, faceWidth: 10, outerDiameter: 130}),
  );
  assert.equal(nominalCenterDistance(small, large), 44);
  assert.equal(nominalCenterDistance(small, ring), 28);
  assert.equal(nominalCenterDistance(ring, small), 28);
  assert.equal(
    nominalCenterDistance(
      small.material('#aaa'),
      large.relate(self => self.frame.align(small.frame)),
    ),
    44,
  );

  const right = keep(
    helicalGear({
      normalModule: 2,
      teeth: 20,
      faceWidth: 10,
      helixAngle: 20,
      hand: 'right',
    }),
  );
  const left = keep(
    helicalGear({
      normalModule: 2,
      teeth: 24,
      faceWidth: 10,
      helixAngle: 20,
      hand: 'left',
    }),
  );
  assert.ok(
    Math.abs(
      nominalCenterDistance(right, left) - 44 / Math.cos((20 * Math.PI) / 180),
    ) < 1e-9,
  );
  assert.throws(() => nominalCenterDistance(right, right), /opposite hands/);
  assert.throws(() => nominalCenterDistance(right, small), /helix angle/);
  assert.throws(() => nominalCenterDistance(ring, ring), /internal gears/);
});

test('assembly meshes adjacent gears in order with automatic tooth phase', () => {
  const a = keep(spurGear({module: 2, teeth: 24, faceWidth: 10}));
  const b = keep(spurGear({module: 2, teeth: 20, faceWidth: 10}));
  const c = keep(spurGear({module: 2, teeth: 18, faceWidth: 10}));
  const [first, second, third] = assembleGears([a, b, c], {
    centerDistanceDelta: 0.2,
    pairs: [{}, {angle: 90, axialOffset: 1}],
  });
  const assembly = group([first, second, third]);
  near(first.position(assembly), [0, 0, 0]);
  near(second.position(assembly), [44.2, 0, 0]);
  near(third.position(assembly), [44.2, 1, 38.2]);
  const chainGears = assembleGears([a, b, c], {centerDistanceDelta: 0.2});
  const defaultChain = group(chainGears);
  near(chainGears[2].position(defaultChain), [82.4, 0, 0]);
  assert.notDeepEqual(
    createModelSnapshotter()(assembly).children[1].transform.quaternion,
    createModelSnapshotter()(assembly).children[0].transform.quaternion,
  );
  assert.throws(
    () => intersect(assembleGears([a, b])),
    /no common solid volume/,
  );
  for (const pair of [
    [first, second],
    [second, third],
  ])
    assert.throws(() => intersect(pair), /no common solid volume/);
  assert.equal(first, a);
  assert.notEqual(second, b);
});

test('assembly angles turn from the preceding center-line direction', () => {
  const a = keep(spurGear({module: 2, teeth: 24, faceWidth: 10}));
  const b = keep(spurGear({module: 2, teeth: 20, faceWidth: 10}));
  const c = keep(spurGear({module: 2, teeth: 18, faceWidth: 10}));
  for (const [angle, side] of [
    [60, 1],
    [-60, -1],
    [660, -1],
  ]) {
    const turned = assembleGears([a, b, c], {
      centerDistanceDelta: 0.2,
      pairs: [{}, {angle}],
    });
    near(turned[2].position(group(turned)), [
      63.3,
      0,
      side * 19.1 * Math.sqrt(3),
    ]);
    assert.throws(() => intersect(turned.slice(1)), /no common solid volume/);
  }

  for (const pair of [{}, {angle: 0}]) {
    const straight = assembleGears([a, b, c], {
      centerDistanceDelta: 0.2,
      pairs: [{angle: 90}, pair],
    });
    const train = group(straight);
    near(straight[1].position(train), [0, 0, 44.2]);
    near(straight[2].position(train), [0, 0, 82.4]);
  }

  const bent = assembleGears([a, b, c], {
    centerDistanceDelta: 0.2,
    pairs: [{angle: 60}, {angle: 60}],
  });
  const train = group(bent);
  near(bent[1].position(train), [22.1, 0, 22.1 * Math.sqrt(3)]);
  near(bent[2].position(train), [3, 0, 41.2 * Math.sqrt(3)]);
  for (const pair of [bent.slice(0, 2), bent.slice(1)])
    assert.throws(() => intersect(pair), /no common solid volume/);
});

test('automatic tooth phase also clears odd, internal and helical pairs', () => {
  const odd = assembleGears(
    [
      keep(spurGear({module: 2, teeth: 21, faceWidth: 10})),
      keep(spurGear({module: 2, teeth: 31, faceWidth: 10})),
    ],
    {centerDistanceDelta: 0.2},
  );
  assert.throws(() => intersect(odd), /no common solid volume/);

  const ring = keep(
    internalGear({module: 2, teeth: 48, faceWidth: 10, outerDiameter: 130}),
  );
  const pinion = keep(spurGear({module: 2, teeth: 20, faceWidth: 10}));
  for (const pair of [
    [ring, pinion],
    [pinion, ring],
  ])
    assert.throws(
      () => intersect(assembleGears(pair, {centerDistanceDelta: -0.2})),
      /no common solid volume/,
    );

  const helical = assembleGears(
    [
      keep(
        helicalGear({
          normalModule: 2,
          teeth: 20,
          faceWidth: 10,
          helixAngle: 20,
          hand: 'right',
        }),
      ),
      keep(
        helicalGear({
          normalModule: 2,
          teeth: 30,
          faceWidth: 14,
          helixAngle: 20,
          hand: 'left',
        }),
      ),
    ],
    {centerDistanceDelta: 0.2, axialOffset: 1},
  );
  assert.throws(() => intersect(helical), /no common solid volume/);
});

test('assembly rejects incompatible gears or malformed pair overrides', () => {
  const a = keep(spurGear({module: 2, teeth: 20, faceWidth: 10}));
  const b = keep(spurGear({module: 2, teeth: 24, faceWidth: 10}));
  const otherModule = keep(spurGear({module: 2.5, teeth: 20, faceWidth: 10}));
  assert.throws(() => assembleGears([a, otherModule]), /normal module/);
  assert.throws(
    () => assembleGears([a, b], {centerDistanceDelta: -44}),
    /must be positive/,
  );
  assert.throws(
    () => assembleGears([a, b], {axialOffset: 10}),
    /overlap axially/,
  );
  assert.throws(
    () => assembleGears([a, b], {pairs: []}),
    /number of adjacent gear pairs/,
  );
  for (const angle of [NaN, Infinity, -Infinity])
    assert.throws(
      () => assembleGears([a, b], {pairs: [{angle}]}),
      /Pair angle must be finite/,
    );
  assert.throws(() => nominalCenterDistance(a.scaled(2), b), /created by/);
});

test('external crank drives meshed gears and output attachments without moving the shafts', async () => {
  const {box, rotate} = await import('@code3d/core');
  const {rotateVector} = await import('@code3d/core/tooling');
  const snapshot = createModelSnapshotter();
  const prototypes = [20, 30, 40].map(teeth =>
    keep(spurGear({module: 2, teeth, faceWidth: 10})),
  );
  const base = box(1, 1, 1);
  let initialHeadings: number[] | undefined;
  for (const angle of [0, 17, -55, 180, 359, 360, 361, 720, -1080]) {
    const crank = box(15, 2, 3).relate(self => [
      self.frame.align(base.frame),
      rotate(0, angle, 0),
    ]);
    const pinion = prototypes[0].relate(self => self.frame.align(crank.frame));
    const gears = assembleGears([pinion, ...prototypes.slice(1)], {
      centerDistanceDelta: 0.2,
    });
    const output = box(20, 2, 3).relate(self =>
      self.frame.align(gears[2].frame),
    );
    const assembly = snapshot(group([base, crank, ...gears, output]));
    const headings = assembly.children.slice(2, 5).map(child => {
      const x = rotateVector([1, 0, 0], child.transform.quaternion);
      return Math.atan2(-x[2], x[0]);
    });
    initialHeadings ??= headings;
    headings.forEach((value, i) => {
      const expected =
        initialHeadings![i] + ([1, -2 / 3, 0.5][i] * angle * Math.PI) / 180;
      near(
        [Math.cos(value), Math.sin(value)],
        [Math.cos(expected), Math.sin(expected)],
      );
      near(
        assembly.children[i + 2].transform.position,
        [
          [0, 0, 0],
          [50.2, 0, 0],
          [120.4, 0, 0],
        ][i],
      );
    });
    near(
      rotateVector([1, 0, 0], assembly.children[5].transform.quaternion),
      rotateVector([1, 0, 0], assembly.children[4].transform.quaternion),
    );
    if ([0, 17, -55].includes(angle))
      for (const pair of [gears.slice(0, 2), gears.slice(1)])
        assert.throws(() => intersect(pair), /no common solid volume/);
  }
});

test('internal and helical transmission remain engaged away from the initial pose', async () => {
  const {box, rotate} = await import('@code3d/core');
  const base = box(1, 1, 1);
  const ring = keep(
    internalGear({module: 2, teeth: 48, faceWidth: 10, outerDiameter: 130}),
  );
  const pinion = keep(spurGear({module: 2, teeth: 20, faceWidth: 10}));
  const right = keep(
    helicalGear({
      normalModule: 2,
      teeth: 20,
      faceWidth: 10,
      helixAngle: 20,
      hand: 'right',
    }),
  );
  const left = keep(
    helicalGear({
      normalModule: 2,
      teeth: 30,
      faceWidth: 14,
      helixAngle: 20,
      hand: 'left',
    }),
  );
  for (const [source, target, centerDistanceDelta] of [
    [ring, pinion, -0.2],
    [pinion, ring, -0.2],
    [right, left, 0.2],
  ] as const)
    for (const angle of [-37, 53, 361]) {
      const driver = source.relate(self => [
        self.frame.align(base.frame),
        rotate(0, angle, 0),
      ]);
      assert.throws(
        () =>
          intersect(
            assembleGears([driver, target], {
              centerDistanceDelta,
              axialOffset: 1,
            }),
          ),
        /no common solid volume/,
      );
    }
});
