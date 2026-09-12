import {box} from '@code3d/core';
import {ISO4762} from '@code3d/screws';

export function makeLid() {
  // A 4.5 mm counterbore leaves 3.5 mm of material below the screw head.
  const thickness = 8;
  const blank = box(80, thickness, 60);
  const holes = [-34, 34].flatMap(x =>
    [-24, 24].map(z =>
      ISO4762.clearanceHole('M4', {
        depth: thickness,
        counterbore: true,
      }).originOffset(-x, 0, -z),
    ),
  );
  // Keep the four bottom contact edges sharp.
  return blank.fillet(1, [2, 3, 4, 6, 7, 8, 11, 12]).cut(holes).expose({
    mountingFace: blank.down,
    frontLeft: holes[0],
    backLeft: holes[1],
    frontRight: holes[2],
    backRight: holes[3],
  });
}

export default makeLid();
