export const sampleSource = `import {box, cut, group} from 'code3d';
import {socketCapHole, socketCapScrew} from './lib/fasteners/metric';

const accent = '#d8ff3e';
const dark = '#222621';

const plate = box(38, 6, 26).named('Demo plate').paint(dark);
const hole = socketCapHole('M6', {
  depth: 10,
  fit: 'normal',
  counterbore: true,
}).relate(tool => tool.shaftBottom.on(plate.bottom).flip());
const preparedPlate = cut(plate, [hole])
  .named('Counterbored plate')
  .paint(dark);

const screw = socketCapScrew('M6', 18)
  .paint(accent)
  .relate(part =>
    part.headBottom.on(hole.counterboreBottom).flip().offset(0, -1, 0),
  );

const fastenerDemo = group([preparedPlate, screw], 'M6 fastener demo');
`;
