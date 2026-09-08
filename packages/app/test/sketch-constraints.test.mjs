import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server, sketchConstraintDisplays, layoutSketchConstraintMarkers;
before(async () => {
  server = await createAppTestServer();
  ({sketchConstraintDisplays} = await server.ssrLoadModule(
    '/src/tools/sketch-constraints.ts',
  ));
  ({layoutSketchConstraintMarkers} = await server.ssrLoadModule(
    '/src/tools/sketch-constraint-layout.ts',
  ));
});
after(async () => server?.close());
const ref = (id, layer = 'local') => ({layer, id});
const point = (id, position, layer = 'local') => ({
  ...ref(id, layer),
  position,
});
const line = (id, a, b) => ({kind: 'line', id, points: [a, b]});
const layer = (id, entities, constraints) => ({
  id,
  entities,
  constraints,
  degreesOfFreedom: 0,
  redundant: [],
});

test('disjoint line relations have linked per-line markers without connecting guides', () => {
  const points = [
    point(1, [0, 0]),
    point(2, [10, 0]),
    point(3, [0, 10]),
    point(4, [-5, 10 + 5 * Math.sqrt(3)]),
  ];
  const local = layer(
    'local',
    [
      ...points.map(p => ({kind: 'point', ...p})),
      line(5, ref(1), ref(2)),
      line(6, ref(3), ref(4)),
    ],
    [
      ['parallel', [5, 6]],
      ['perpendicular', [5, 6]],
      ['angle', [5, 6], 120],
      ['angle', 5, 0],
    ],
  );
  const displays = sketchConstraintDisplays([local], points);
  assert.deepEqual(
    displays.map(d => d.tool),
    ['parallel', 'perpendicular', 'angle', 'orientation'],
  );
  for (const d of displays.slice(0, 3)) {
    assert.deepEqual(d.curves, [ref(5), ref(6)]);
    assert.deepEqual(d.points, points);
    assert.deepEqual(d.guides, []);
    assert.deepEqual(d.markers, [
      {
        kind: 'line',
        curve: ref(5),
        points: points.slice(0, 2).map(p => p.position),
      },
      {
        kind: 'line',
        curve: ref(6),
        points: points.slice(2).map(p => p.position),
      },
    ]);
  }
  assert.equal(displays[2].label, '120°');
  assert.match(displays[2].title, /line 5 → line 6.*positive CCW/);
});

test('angle and perpendicular markers use the shared endpoint regardless of authored endpoint order', () => {
  const points = [point(1, [2, 3]), point(2, [12, 3]), point(3, [2, 13])];
  for (const first of [
    [1, 2],
    [2, 1],
  ])
    for (const second of [
      [1, 3],
      [3, 1],
    ]) {
      const displays = sketchConstraintDisplays(
        [
          layer(
            'local',
            [
              ...points.map(p => ({kind: 'point', ...p})),
              line(4, ...first.map(refId => ref(refId))),
              line(5, ...second.map(refId => ref(refId))),
            ],
            [
              ['angle', [4, 5], -90],
              ['perpendicular', [4, 5]],
            ],
          ),
        ],
        points,
      );
      for (const display of displays) {
        assert.deepEqual(display.markers, [
          {kind: 'corner', points: points.map(p => p.position)},
        ]);
        assert.deepEqual(display.guides, []);
      }
      assert.equal(
        displays[0].label,
        '-90°',
        'placement must not reinterpret the authored angle',
      );
    }
});

test('shared vertices resolve aliases but not coincident coordinates, crossings or equal IDs in different layers', () => {
  const points = [
    point(1, [0, 0]),
    point(2, [10, 0]),
    point(3, [0, 0]),
    point(4, [0, 10]),
  ];
  const entities = [
    ...points.map(p => ({kind: 'point', ...p})),
    line(5, ref(1), ref(2)),
    line(6, ref(3), ref(4)),
  ];
  const constraints = [['perpendicular', [5, 6]]];
  assert.equal(
    sketchConstraintDisplays([layer('local', entities, constraints)], points)[0]
      .markers.length,
    2,
  );
  entities[2].alias = ref(1);
  assert.deepEqual(
    sketchConstraintDisplays([layer('local', entities, constraints)], points)[0]
      .markers,
    [
      {
        kind: 'corner',
        points: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
      },
    ],
  );
  const base = point(1, [0, 0], 'base');
  entities[entities.length - 1] = line(6, ref(1, 'base'), ref(4));
  assert.equal(
    sketchConstraintDisplays(
      [
        layer('base', [{kind: 'point', ...base}], []),
        layer('local', entities, constraints),
      ],
      [...points, base],
    )[0].markers.length,
    2,
  );
  // Intersections in the interior do not manufacture a shared endpoint either.
  delete entities[2].alias;
  entities[entities.length - 1] = line(6, ref(3), ref(4));
  points[2].position = [5, -5];
  points[3].position = [5, 5];
  assert.equal(
    sketchConstraintDisplays([layer('local', entities, constraints)], points)[0]
      .markers.length,
    2,
  );
});

test('line marker groups are centered with 4px between badges and 8px to the line in either endpoint order', () => {
  for (const points of [
    [
      [0, 0],
      [200, 0],
    ],
    [
      [0, 0],
      [0, 200],
    ],
  ]) {
    const labels = [22, 54, 22].map(width => ({
      width,
      marker: {kind: 'line', curve: ref(1), points},
    }));
    const bounds = layoutSketchConstraintMarkers(labels, p => p);
    const reverse = layoutSketchConstraintMarkers(
      labels.map(l => ({
        ...l,
        marker: {...l.marker, points: [...points].reverse()},
      })),
      p => p,
    );
    assert.deepEqual(reverse, bounds);
    if (points[1][1] === 0) {
      assert.equal((bounds[0].x + bounds[2].x + bounds[2].width) / 2, 100);
      for (const b of bounds) assert.equal(b.y + b.height, -9);
      for (let i = 1; i < bounds.length; i++)
        assert.equal(bounds[i].x - bounds[i - 1].x - bounds[i - 1].width, 4);
    } else {
      assert.equal((bounds[0].y + bounds[2].y + bounds[2].height) / 2, 100);
      for (const b of bounds) assert.equal(b.x, 9);
      for (let i = 1; i < bounds.length; i++)
        assert.equal(bounds[i].y - bounds[i - 1].y - bounds[i - 1].height, 4);
    }
  }
});

test('the near corner, not the badge center, follows the bisector through zoom and acute angles', () => {
  const marker = {
    kind: 'corner',
    points: [
      [2, 3],
      [12, 3],
      [2, 13],
    ],
  };
  let distance;
  for (const scale of [1, 7, 30]) {
    const project = ([x, y]) => [50 + scale * x, 70 - scale * y];
    const [bounds] = layoutSketchConstraintMarkers(
      [{marker, width: 54}],
      project,
    );
    const vertex = project(marker.points[0]);
    const dx = bounds.x - vertex[0],
      dy = bounds.y + bounds.height - vertex[1];
    assert.ok(dx > 0 && dy < 0);
    assert.ok(Math.abs(dx + dy) < 1e-10);
    assert.ok(Math.abs(dx - 1 - 8) < 1e-10);
    assert.ok(Math.abs(-dy - 1 - 8) < 1e-10);
    const next = Math.hypot(dx, dy);
    if (distance !== undefined) assert.ok(Math.abs(next - distance) < 1e-10);
    distance = next;
  }
  for (const degrees of [1, 5, 45, 90, 179]) {
    const angle = (degrees * Math.PI) / 180;
    const [b] = layoutSketchConstraintMarkers(
      [
        {
          marker: {
            kind: 'corner',
            points: [
              [0, 0],
              [10, 0],
              [10 * Math.cos(angle), 10 * Math.sin(angle)],
            ],
          },
          width: 54,
        },
      ],
      p => p,
    );
    const x = b.x,
      y = b.y;
    assert.ok(Math.abs(Math.atan2(y, x) - angle / 2) < 1e-10);
    assert.ok(Math.hypot(x, y) <= Math.SQRT2 * 9, `near vertex at ${degrees}°`);
    assert.ok(Math.abs(Math.max(Math.abs(x), Math.abs(y)) - 9) < 1e-10);
  }
  for (const endpoint of [
    [-10, 0],
    [20, 0],
    [20, 1e-12],
  ]) {
    const bounds = layoutSketchConstraintMarkers(
      [
        {
          marker: {kind: 'corner', points: [[0, 0], [10, 0], endpoint]},
          width: 22,
        },
      ],
      p => p,
    );
    assert.ok(bounds.flatMap(Object.values).every(Number.isFinite));
  }
});

test('right-angle markers keep their natural width and equal edge clearance in every quadrant', () => {
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const width of [22, 54, 100]) {
        const [bounds] = layoutSketchConstraintMarkers(
          [
            {
              marker: {
                kind: 'corner',
                points: [
                  [0, 0],
                  [10 * x, 0],
                  [0, 10 * y],
                ],
              },
              width,
            },
          ],
          p => p,
        );
        assert.equal(bounds.width, width + 1);
        assert.equal(bounds.height, 21);
        const horizontalGap = (x > 0 ? bounds.x : -bounds.x - bounds.width) - 1;
        const verticalGap = (y > 0 ? bounds.y : -bounds.y - bounds.height) - 1;
        assert.ok(Math.abs(horizontalGap - 8) < 1e-10);
        assert.ok(Math.abs(verticalGap - 8) < 1e-10);
      }
});

test('overlapping line, corner and point markers retain their own layout regardless of other groups or order', () => {
  const groups = [1, 2].map(id =>
    [22, 54].map(width => ({
      width,
      marker: {
        kind: 'line',
        curve: ref(id),
        points: [
          [0, 0],
          [200, 0],
        ],
      },
    })),
  );
  const corner = {
    kind: 'corner',
    points: [
      [0, 0],
      [20, 0],
      [0, 20],
    ],
  };
  groups.push(
    [{marker: corner, width: 22}],
    [{marker: corner, width: 54}],
    [{marker: {kind: 'point', position: [90, 0]}, width: 22}],
    [{marker: {kind: 'point', position: [90, 0]}, width: 54}],
  );
  for (const scale of [1, 3, 10]) {
    const project = ([x, y]) => [x * scale, y * scale];
    for (const order of [groups, [...groups].reverse()])
      assert.deepEqual(
        layoutSketchConstraintMarkers(order.flat(), project),
        order.flatMap(group => layoutSketchConstraintMarkers(group, project)),
      );
  }
});

test('every persistent constraint exposes its actual participants and value, without changing snapshots', () => {
  const points = [point(1, [0, 0]), point(2, [40, 0]), point(3, [20, 0])];
  const constraints = [
    ['fixed', ref(1)],
    ['horizontal', 4],
    ['vertical', 4],
    ['coincident', [ref(1), ref(2)]],
    ['midpoint', [ref(3), ref(1), ref(2)]],
    ['length', 4, 40],
    ['angle', 4, 180],
    ['x', ref(1), -2],
    ['y', ref(2), 3.5],
  ];
  const layers = [layer('local', [line(4, ref(1), ref(2))], constraints)];
  const before = structuredClone({layers, points});
  const displays = sketchConstraintDisplays(layers, points);
  assert.deepEqual(
    displays.map(d => d.kind),
    constraints.map(c => c[0]),
  );
  assert.equal(new Set(displays.map(d => d.key)).size, constraints.length);
  assert.deepEqual(
    displays.map(d => d.index),
    constraints.map((_, index) => index),
  );
  assert.deepEqual(
    displays.map(d => d.label),
    ['', '', '', '', '', '40', '180°', '-2', '3.5'],
  );
  for (const index of [1, 2, 5, 6]) {
    assert.deepEqual(displays[index].curves, [ref(4)]);
    assert.deepEqual(displays[index].points, points.slice(0, 2));
    assert.deepEqual(displays[index].markers, [
      {
        kind: 'line',
        curve: ref(4),
        points: [
          [0, 0],
          [40, 0],
        ],
      },
    ]);
  }
  assert.deepEqual(displays[0].points, [points[0]]);
  assert.deepEqual(displays[3].guides, [
    [
      [0, 0],
      [40, 0],
    ],
  ]);
  assert.deepEqual(displays[4].points, [points[2], points[0], points[1]]);
  assert.deepEqual(displays[4].guides, [
    [
      [20, 0],
      [0, 0],
    ],
    [
      [20, 0],
      [40, 0],
    ],
  ]);
  assert.deepEqual({layers, points}, before);
});

test('derived relations retain ownership and distinct upstream/local addresses with equal numeric IDs', () => {
  const upstream = point(1, [10, 20], 'base');
  const local = point(1, [30, 40]);
  const displays = sketchConstraintDisplays(
    [
      layer('base', [], [['fixed', ref(1, 'base')]]),
      layer(
        'local',
        [line(2, ref(1, 'base'), ref(1))],
        [
          ['coincident', [ref(1), ref(1, 'base')]],
          ['length', 2, 20],
        ],
      ),
    ],
    [upstream, local],
  );
  assert.equal(displays[0].layer, 'base');
  assert.deepEqual(displays[0].points, [upstream]);
  assert.equal(displays[1].layer, 'local');
  assert.equal(displays[0].index, 0);
  assert.equal(displays[1].index, 0);
  assert.deepEqual(displays[1].points, [local, upstream]);
  assert.match(displays[1].title, /point 1 \(upstream\)/);
  assert.deepEqual(displays[2].curves, [ref(2)]);
  assert.deepEqual(displays[2].points, [upstream, local]);
});

test('preview positions move glyphs and midpoint guides without inventing drag locks or extra rectangle relations', () => {
  const layers = [layer('local', [], [['midpoint', [ref(1), ref(2), ref(3)]]])];
  const start = sketchConstraintDisplays(layers, [
    point(1, [0, 0]),
    point(2, [-10, -10]),
    point(3, [10, 10]),
  ]);
  const next = sketchConstraintDisplays(layers, [
    point(1, [5, 5]),
    point(2, [-15, -5]),
    point(3, [25, 15]),
  ]);
  assert.equal(next.length, 1);
  assert.equal(next[0].key, start[0].key);
  assert.deepEqual(next[0].markers, [{kind: 'point', position: [5, 5]}]);
  assert.deepEqual(next[0].guides, [
    [
      [5, 5],
      [-15, -5],
    ],
    [
      [5, 5],
      [25, 15],
    ],
  ]);
  assert.deepEqual(
    sketchConstraintDisplays([layer('local', [], [])], [point(1, [0, 0])]),
    [],
  );
});
