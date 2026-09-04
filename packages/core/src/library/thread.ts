import {
  Plane,
  draw,
  makeCylinder,
  makeHelix,
  makeSolid,
  weldShellsAndFaces,
  type Drawing,
  type Face,
  type Shape3D,
  type Sketch,
} from 'replicad';

export type HelicalThreadShapeOptions = Readonly<{
  pitch: number;
  y: number;
  majorRadius: number;
  minorRadius: number;
  rootWidth: number;
  crestWidth: number;
  leftHanded: boolean;
}>;

const loopSteps = Array.from({length: 21}, (_, index) => index / 20);

/**
 * Builds a closed external thread around its minor-diameter core. The lofted
 * end treatment follows the MIT-licensed replicad-threads construction by
 * Steve Genoud, adapted here to code3d's Y-axis and geometry ownership model.
 */
export function makeHelicalThreadShape({
  pitch,
  y,
  majorRadius,
  minorRadius,
  rootWidth,
  crestWidth,
  leftHanded,
}: HelicalThreadShapeOptions): Shape3D {
  const toothHeight = majorRadius - minorRadius;
  const profile = threadProfile(rootWidth, crestWidth, toothHeight);
  const teeth = fadedThread(pitch, minorRadius, y, profile, leftHanded);
  const core = makeCylinder(minorRadius + 0.05, y);
  const threaded = core.fuse(teeth);
  core.delete();
  teeth.delete();
  return threaded.rotate(-90, [0, 0, 0], [1, 0, 0]).translate([0, -y / 2, 0]);
}

function threadProfile(
  rootWidth: number,
  crestWidth: number,
  toothHeight: number,
): Drawing {
  const rootHalf = rootWidth / 2;
  const crestHalf = crestWidth / 2;
  return draw([rootHalf, -0.05])
    .vLine(0.05)
    .lineTo([crestHalf, toothHeight])
    .hLineTo(-crestHalf)
    .lineTo([-rootHalf, 0])
    .vLine(-0.05)
    .close();
}

function fadedThread(
  pitch: number,
  radius: number,
  length: number,
  profile: Drawing,
  leftHanded: boolean,
): Shape3D {
  const bottomEnd = fadedEnd(pitch, radius, profile, true, leftHanded);
  const totalLoops = length / pitch - 0.5;
  const fullLoops = Math.floor(totalLoops);
  const leftover = totalLoops - fullLoops;
  const singleLoop = basicThreadLoop(
    pitch,
    radius,
    profile,
    1,
    'none',
    leftHanded,
  );
  const shells = Array.from({length: fullLoops}, (_, index) =>
    singleLoop.clone().translate([0, 0, index * pitch]),
  );
  singleLoop.delete();
  if (leftover > 1e-9) {
    shells.push(
      basicThreadLoop(
        pitch,
        radius,
        profile,
        leftover,
        'none',
        leftHanded,
      ).translate([0, 0, fullLoops * pitch]),
    );
  }
  const topEnd = fadedEnd(pitch, radius, profile, false, leftHanded)
    .translate([0, 0, totalLoops * pitch])
    .rotate(360 * leftover, [0, 0, 0], [0, 0, 1]);
  const thread = makeSolid([bottomEnd, ...shells, topEnd]).translate([
    0,
    0,
    pitch / 4,
  ]);
  bottomEnd.delete();
  shells.forEach(shell => shell.delete());
  topEnd.delete();
  return thread;
}

function basicThreadLoop(
  pitch: number,
  radius: number,
  profile: Drawing,
  loopFraction: number,
  includeEnd: 'none' | 'first' | 'last' | 'both',
  leftHanded: boolean,
) {
  const helix = makeHelix(
    pitch,
    pitch * clamp(loopFraction, 0, 1),
    radius,
    [0, 0, 0],
    [0, 0, 1],
    leftHanded,
  );
  const profiles = loopSteps.map(step => {
    const position = helix.pointAt(step);
    const tangent = helix.tangentAt(step);
    const plane = new Plane(position, [0, 0, 1], tangent);
    const sketch = profile.sketchOnPlane(plane) as Sketch;
    plane.delete();
    return sketch;
  });
  helix.delete();

  const ends: Face[] = [];
  if (includeEnd === 'first' || includeEnd === 'both') {
    ends.push(profiles[0].faces());
  }
  if (includeEnd === 'last' || includeEnd === 'both') {
    const face = profiles.at(-1)!.faces();
    face.wrapped.Reverse();
    ends.push(face);
  }
  const shell = profiles[0].loftWith(profiles.slice(1), {ruled: false}, true);
  if (ends.length === 0) return shell;
  const closed = weldShellsAndFaces([shell, ...ends]);
  shell.delete();
  ends.forEach(face => face.delete());
  return closed;
}

function fadedEnd(
  pitch: number,
  radius: number,
  profile: Drawing,
  bottom: boolean,
  leftHanded: boolean,
) {
  const length = pitch / 4;
  const helix = makeHelix(
    pitch,
    length,
    radius,
    [0, 0, 0],
    [0, 0, bottom ? -1 : 1],
    leftHanded,
  );
  const profiles = loopSteps.map((step, index) => {
    const position = helix.pointAt(step);
    let tangent = helix.tangentAt(step);
    if (bottom) tangent = tangent.multiply(-1);
    const plane = new Plane(position, [0, 0, 1], tangent);
    const sketch = profile
      .scale((loopSteps.length - index) / loopSteps.length, [0, 0])
      .sketchOnPlane(plane) as Sketch;
    plane.delete();
    return sketch;
  });
  helix.delete();
  const endFace = profiles.at(-1)!.faces();
  const shell = profiles[0].loftWith(profiles.slice(1), {ruled: false}, true);
  const closed = weldShellsAndFaces([shell, endFace]);
  shell.delete();
  endFace.delete();
  return bottom ? closed.rotate(180, [0, 0, 0], [0, 0, 1]) : closed;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
