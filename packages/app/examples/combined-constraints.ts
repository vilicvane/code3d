import {box, group} from '@code3d/core';

const first = box(10, 10, 10).paint('#8ed5d1');
const second = box(20, 20, 20)
  .paint('#a8b8ff')
  .relate(self => [self.edge(3).on(first.edge(1)), self.top.on(first.bottom)]);

// Geometry fixes X and Y. Default centering chooses Z = 0.
// The second box is placed at [5, -15, 0].
export default group([first, second]);
