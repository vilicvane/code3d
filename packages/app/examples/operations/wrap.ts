import {
  cut,
  cylinder,
  googleFont,
  group,
  sphere,
  text,
  thicken,
  union,
  wrap,
} from '@code3d/core';
import {definePrimitive, replicad} from '@code3d/core/replicad';

const sans = googleFont('Play');
// Position the complete text layout outside the target. Its finite bounding
// rectangle selects the closest surface region and preserves the text direction.
const profiles = text('B8i', sans, 9).map(face =>
  face.originOffset(8, -26, -3),
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
const ellipsoid = definePrimitive(() => replicad.makeEllipsoid(20, 26, 22));
const oval = ellipsoid();
const smallProfiles = text('CAD', sans, 6).map(face =>
  face.originOffset(6, -32, 3),
);
const curvedText = wrap(smallProfiles, oval.surface(1));
export const freeform = union([oval, ...thicken(curvedText, 0.8)])
  .originOffset(-48, 0, 0)
  .material('#75ad89');

export default group([raised, engraved, freeform]);
