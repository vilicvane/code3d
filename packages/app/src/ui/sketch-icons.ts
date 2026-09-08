import type {IconNode} from 'lucide';

// Geometry-specific construction glyphs use Lucide's 24-unit, rounded-stroke grammar.
export const CenterRectangle: IconNode = [
  ['rect', {x: '3', y: '6', width: '18', height: '12', rx: '1'}],
  ['path', {d: 'M9 12h6m-3-3v6'}],
];
export const CenterArc: IconNode = [
  ['path', {d: 'M4 18a14 14 0 0 1 14-14'}],
  ['path', {d: 'M15 18h6m-3-3v6'}],
  ['circle', {cx: '4', cy: '18', r: '1'}],
  ['circle', {cx: '18', cy: '4', r: '1'}],
];
export const CoordinateX: IconNode = [
  ['path', {d: 'm4 6 8 12M12 6 4 18M17 5v14m-2-2 2 2 2-2'}],
];
export const CoordinateY: IconNode = [
  ['path', {d: 'm4 6 4 6 4-6M8 12v6M17 5v14m-2-2 2 2 2-2'}],
];
