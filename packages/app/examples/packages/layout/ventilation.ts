import {on, align, box, group} from '@code3d/core';
import {fillFlex} from '@code3d/layout';

const base = box(40, 4, 30).material('#526273');
const leftSide = box(4, 20, 30)
  .material('#526273')
  .relate(() => [on(base.left), on(base.up)]);
const rightSide = box(4, 20, 30)
  .material('#526273')
  .relate(() => [on(base.right), on(base.up)]);

// This construction space locates the fins, but is not output geometry.
const ventilationSpace = box(40, 10, 30).relate(self => [
  on(leftSide.right),
  align(self.up, leftSide.up),
]);
const fins = fillFlex(box(2, 10, 30).material('#8ed5d1'), ventilationSpace, {
  axis: 'x',
  gap: 5,
});

export default group(
  [base, leftSide, rightSide, ...fins],
  'Ventilation grille',
);
