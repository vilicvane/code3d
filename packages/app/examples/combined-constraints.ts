import {box, group} from '@code3d/core';

const first = box(10, 10, 10).paint('#8ed5d1');
const second = box(20, 20, 20)
  .paint('#a8b8ff')
  .relate(self => [self.on(first.right), self.on(first.down)]);

// The two bound contacts determine X and Y; the free Z position stays unchanged.
// The second box is placed at [15, -15, 0] without rotating.
export default group([first, second]);
