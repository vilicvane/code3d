export const sampleSource = `import {box, cylinder, cut, union} from 'code3d';

const accent = '#d8ff3e';
const dark = '#222621';

/**
 * @code3d.label 支柱间距
 * @code3d.description 控制左右支柱到模型中心的距离
 * @code3d.kind length
 * @code3d.unit mm
 * @code3d.min 18
 * @code3d.max 36
 * @code3d.step 0.5
 */
const postOffset = 27;

const plate = box(76, 6, 50).named('Plate').paint(dark);
const postBlank = cylinder(4.5, 25);
const posts = [-1, 1].map(side =>
  postBlank
    .named(\`Post \${side}\`)
    .paint(accent)
    .relate(post =>
      post.bottom.on(plate.top).offset(side * postOffset, 0, 13),
    ),
);

const body = union(plate, ...posts);
const holeBlank = cylinder(3.4, 10);
const mountingHoles = [-1, 1].flatMap(x =>
  [-1, 1].map(z =>
    holeBlank.relate(hole =>
      hole.axis.on(plate.axis).offset(x * 29, 0, z * 17),
    ),
  ),
);

const base = cut(body, ...mountingHoles).named('Base').paint(dark);
`;
