import type {IconNode} from 'lucide';
import {CircleDot, LockKeyhole, Ruler} from 'lucide';
import type {SketchConstraint} from '@code3d/core/tooling';

// Geometry-specific construction glyphs use Lucide's 24-unit, rounded-stroke grammar.
// Show exactly the point roles the drawing creates, with one shared point size.
const points = (...positions: readonly [number, number][]): IconNode =>
  positions.map(([cx, cy]) => [
    'circle',
    {cx: String(cx), cy: String(cy), r: '2'},
  ]);

export const LineSegment: IconNode = [
  ['path', {d: 'm5.5 18.5 13-13'}],
  ...points([4, 20], [20, 4]),
];
export const Rectangle: IconNode = [
  ['path', {d: 'M6 6h12M20 8v8M18 18H6M4 16V8'}],
  ...points([4, 6], [20, 6], [20, 18], [4, 18]),
];
export const CenterRectangle: IconNode = [...Rectangle, ...points([12, 12])];
export const CenterCircle: IconNode = [
  ['circle', {cx: '12', cy: '12', r: '9'}],
  ...points([12, 12]),
];
export const CenterArc: IconNode = [
  ['path', {d: 'M4.14 16a14 14 0 0 1 11.86-11.86'}],
  ...points([4, 18], [18, 4], [18, 18]),
];
export const Protractor: IconNode = [
  ['path', {d: 'M2 17a10 10 0 0 1 20 0H2'}],
  ['path', {d: 'M6 17a6 6 0 0 1 12 0'}],
  ['path', {d: 'M12 7v2M5 10l1.5 1.5M19 10l-1.5 1.5'}],
];
export const CoordinateX: IconNode = [
  ['path', {d: 'm3 6 8 12M11 6 3 18M15 10h6m-6 4h6'}],
];
export const CoordinateY: IconNode = [
  ['path', {d: 'm3 6 4 6 4-6M7 12v6M15 10h6m-6 4h6'}],
];

const referenceAxis = {
  'stroke-dasharray': '1 4',
  'stroke-dashoffset': '-1',
};

// Coordinate equations, line directions and dimensions are distinct symbols;
// the toolbar and in-canvas badges share this exact icon vocabulary.
export const sketchConstraintIcons: Record<SketchConstraint[0], IconNode> = {
  fixed: LockKeyhole,
  coincident: CircleDot,
  x: CoordinateX,
  y: CoordinateY,
  horizontal: [
    ['path', {d: 'M12 3v18', ...referenceAxis}],
    ['path', {d: 'M3 12h18'}],
  ],
  vertical: [
    ['path', {d: 'M3 12h18', ...referenceAxis}],
    ['path', {d: 'M12 3v18'}],
  ],
  midpoint: [
    ['path', {d: 'M5 12h4m6 0h4M3 9v6m18-6v6'}],
    ['circle', {cx: '12', cy: '12', r: '3'}],
  ],
  length: Ruler,
  angle: Protractor,
  radius: [
    ['path', {d: 'M20 12a8 8 0 1 1-8-8M12 12l6-6m-4 0h4v4'}],
    ['circle', {cx: '12', cy: '12', r: '1'}],
  ],
  sweep: [
    ['path', {d: 'M12 4a8 8 0 1 1-8 8m-1 4 1-4 4 1M12 12V4'}],
    ['circle', {cx: '12', cy: '12', r: '1'}],
  ],
};
