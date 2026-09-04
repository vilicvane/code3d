import {box, group} from '@code3d/core';
import {definePrimitive, replicad, type Sketch} from '@code3d/core/replicad';

/**
 * A twisted hexagonal knob with a straight D-shaped shaft bore.
 * Dimensions are in millimeters; twist is in degrees. The bore's flat is
 * fixed at x = 0.6 * shaftRadius, and the part is centered along Y.
 *
 * @code3d.param radius {kind: 'length'}
 * @code3d.param shaftRadius {kind: 'length'}
 * @code3d.param y {kind: 'length'}
 * @code3d.param twist {kind: 'angle'}
 */
export const twistKnob = definePrimitive(
  (radius: number, shaftRadius: number, y: number, twist = 60) => {
    for (const [name, value] of Object.entries({radius, shaftRadius, y})) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive finite number.`);
      }
    }
    if (shaftRadius >= radius * Math.cos(Math.PI / 6)) {
      throw new Error('The shaft bore must fit inside the hexagonal profile.');
    }
    if (!Number.isFinite(twist)) {
      throw new Error('twist must be finite.');
    }

    const [track, cleanup] = replicad.localGC();
    let profile: Sketch | undefined = replicad.sketchPolysides(radius, 6, 0, {
      plane: 'XZ',
      origin: [0, -y / 2, 0],
    });
    try {
      const body = track(
        profile.extrude(y, {
          extrusionDirection: [0, 1, 0],
          twistAngle: twist,
        }),
      );
      profile = undefined; // Replicad consumes the sketch after extrusion.

      const roundBore = track(
        replicad.makeCylinder(
          shaftRadius,
          y + 2,
          [0, -y / 2 - 1, 0],
          [0, 1, 0],
        ),
      );
      const clip = track(
        replicad.makeBox(
          [-shaftRadius - 1, -y / 2 - 1, -shaftRadius - 1],
          [0.6 * shaftRadius, y / 2 + 1, shaftRadius + 1],
        ),
      );
      const bore = track(roundBore.intersect(clip));

      // Only the returned solid transfers to code3d; release intermediates.
      return body.cut(bore);
    } finally {
      profile?.delete();
      cleanup();
    }
  },
);

const base = box(58, 3, 28).paint('#353a33');
const tall = twistKnob(10, 3, 14)
  .relate(part => part.bottom.on(base.top).offset(-15, 0, 0))
  .paint('#d8ff3e');
const short = twistKnob(10, 3, 8, 30)
  .relate(part => part.bottom.on(base.top).offset(15, 0, 0))
  .paint('#8ed5d1');

export const customPrimitivesExample = group(
  [base, tall, short],
  'Custom twisted knobs',
);
