import {sketch, box} from '@code3d/core';

// Select profile to edit, then plate to inspect the solid. The circle is a hole.
// Sketch [x,y] becomes model [x,0,-y]; positive extrusion follows +Y.
export const profile = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [40, 0]],
  ['point', 3, [40, 30]],
  ['point', 4, [0, 30]],
  ['line', 5, [1, 2]],
  ['line', 6, [2, 3]],
  ['line', 7, [3, 4]],
  ['line', 8, [4, 1]],
  ['point', 9, [20, 15]],
  ['circle', 10, [9, 6]],
]);
export const plate = profile.face().extrude(5);

// Independent regions return an ordinary array. Map is explicit; cut uses all
// tools in one operation. Origin offset moves their start caps below the stock.
export const holes = sketch([
  ['point', 1, [-10, 0]],
  ['circle', 2, [1, 3]],
  ['point', 3, [10, 0]],
  ['circle', 4, [3, 3]],
]);
export const tools = holes
  .faces()
  .map(face => face.extrude(10).originOffset(0, 5, 0));
export const drilled = box(40, 8, 20).cut(tools);

export default plate;
