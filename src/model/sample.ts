export const sampleSource = `import {
  box,
  cylinder,
  group,
  model,
  sphere,
} from "code3d";

const accent = "#d8ff3e";
const dark = "#222621";

const plate = box(76, 6, 50).at(0, 3, 0);
const mountingHoles = [-1, 1].flatMap((x) =>
  [-1, 1].map((z) => cylinder(3.4, 10).at(x * 29, 3, z * 17)),
);

export const base = mountingHoles
  .reduce((body, hole) => body.cut(hole), plate)
  .named("Base")
  .paint(dark);

const frameBlank = box(68, 34, 8).at(0, 23, -19);
const frameWindow = box(46, 19, 12).at(0, 23, -19);

export const bridge = frameBlank
  .cut(frameWindow)
  .named("Bridge frame")
  .paint("#f0f1e8")
  .fillet(1.4);

const posts = [-1, 1].map((x) =>
  cylinder(4.5, 25)
    .named(\`Post \${x}\`)
    .paint(accent)
    .at(x * 27, 18.5, 13),
);

const marker = group(
  [
    sphere(5).paint("#ff6b45").at(-8, 43, -19),
    sphere(5).paint("#7c8cff").at(8, 43, -19),
  ],
  "Markers",
);

export default model("Desk rig", [base, ...posts, bridge, marker]);
`;
