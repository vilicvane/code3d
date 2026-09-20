import {
  cut,
  cylinder,
  ellipsoid,
  googleFont,
  group,
  originCenter,
  sphere,
  text,
  thicken,
  union,
  wrap,
} from '@code3d/core';

const sans = await googleFont('Play');
// Center the complete text layout, then move its plane outside the target.
// Its finite bounding rectangle selects the closest surface region.
const profiles = originCenter(text('Code3D', sans, 9)).map(face =>
  face.originOffset(0, -26, 0),
);

const drum = cylinder(20, 30).rotate(90, 0, 0);
const cylindricalText = wrap(profiles, drum.surface(1));
export const raised = union([drum, ...thicken(cylindricalText, 1)])
  .originOffset(48, 0, 0)
  .material('#e8b45d');

const ball = sphere(20);
const sphericalText = wrap(profiles, ball.surface(1));
export const engraved = cut(ball, thicken(sphericalText, -1)).material(
  '#529dcb',
);

// The same operation also accepts a general B-spline surface.
const oval = ellipsoid(20, 26, 22);
// Surface 1 ends at the equator, so place the centered text on its -Z side.
const smallProfiles = originCenter(text('Code3D', sans, 6)).map(face =>
  face.originOffset(0, -32, 3),
);
const curvedText = wrap(smallProfiles, oval.surface(1));
export const freeform = union([oval, ...thicken(curvedText, 0.8)])
  .originOffset(-48, 0, 0)
  .material('#75ad89');

export default group([raised, engraved, freeform]);
