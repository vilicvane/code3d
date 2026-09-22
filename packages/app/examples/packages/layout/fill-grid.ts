import {box, group} from '@code3d/core';
import {fillGrid} from '@code3d/layout';

const space = box(68, 2, 44).originOffset(-34, 0, -22);
const tile = box(10, 8, 8).originOffset(0, -5, 0);
const tiles = fillGrid(tile, space, {
  axes: ['x', 'z'],
  gap: 4,
  padding: 2,
  justifyContent: 'space-between',
  alignContent: 'space-between',
});
export default group(
  [space.material('#526273'), ...tiles.map(tile => tile.material('#8ed5d1'))],
  {name: 'Fill a grid within bounds'},
);
