import {box, cylinder, group, input, union} from '@code3d/core';

// Angles are in degrees; the opening is the clear distance between the pads.
// Select an input call and press Tab, or drag its slider while watching the arm.
// These travel limits keep the gripper clear of the arm and base.
const baseYaw = input('Base yaw', 15, {min: -180, max: 180, step: 1});
const shoulder = input('Shoulder', -25, {min: -45, max: 45, step: 1});
const elbow = input('Elbow', -75, {min: -110, max: 10, step: 1});
const wrist = input('Wrist', -55, {min: -65, max: 65, step: 1});
const opening = input('Grip opening', 16, {min: 4, max: 28, step: 0.5});

const paint = '#e4a044';
const metal = '#bbc6d0';
const dark = '#35434e';
const accent = '#59c3c8';
const upperLength = 64;
const forearmLength = 50;
const shoulderHeight = 60;
const thickness = 8;
const layer = 6;
const boreRadius = 4;

// Cylinders start along Y; turning them 90 degrees makes a Z-axis hinge.
function axle(radius: number, depth: number) {
  return cylinder(radius, depth).rotate(90, 0, 0);
}

// The pin clears its bore by 0.5; the end caps clear the cheeks by 0.5.
function joint(capRadius: number) {
  return group(
    [
      axle(3.5, 21).material(metal),
      ...[-1, 1].map(side =>
        axle(capRadius, 2)
          .originOffset(0, 0, -side * 11.5)
          .material(accent),
      ),
    ],
    {name: 'Hinge pin'},
  );
}

// Rounded ends and real bores form one rigid link. Alternating Z layers leave
// a 4-unit gap between adjacent moving links, even when they fold together.
function link(length: number, startRadius: number, endRadius: number) {
  return union([
    axle(startRadius, thickness),
    box(endRadius * 1.5, length, thickness).originOffset(0, -length / 2, 0),
    axle(endRadius, thickness).originOffset(0, -length, 0),
  ])
    .cut([
      axle(boreRadius, thickness + 2),
      axle(boreRadius, thickness + 2).originOffset(0, -length, 0),
    ])
    .material(paint);
}

const fingers = [-1, 1].flatMap(side => [
  box(6, 24, thickness)
    .originOffset(-side * (opening / 2 + 5), -40, -layer)
    .material(metal),
  box(2, 10, thickness)
    .originOffset(-side * (opening / 2 + 1), -46, -layer)
    .material(dark),
]);
const palm = union([
  axle(8, thickness),
  box(10, 22, thickness).originOffset(0, -11, 0),
  box(46, 12, thickness).originOffset(0, -22, 0),
])
  .cut([axle(boreRadius, thickness + 2)])
  .originOffset(0, 0, -layer)
  .material(paint);
const gripper = group([joint(6), palm, ...fingers], {name: 'Gripper'}).rotate(
  0,
  0,
  wrist,
);

// Nest from the wrist back toward the base: rotating a joint carries its children.
// A negative origin offset places geometry in the positive parent direction.
const forearm = group(
  [
    joint(7),
    link(forearmLength, 10, 8).originOffset(0, 0, layer),
    gripper.originOffset(0, -forearmLength, 0),
  ],
  {name: 'Forearm'},
).rotate(0, 0, elbow);

const upperArm = group(
  [
    joint(8),
    link(upperLength, 12, 10).originOffset(0, 0, -layer),
    forearm.originOffset(0, -upperLength, 0),
  ],
  {name: 'Upper arm'},
).rotate(0, 0, shoulder);

// The fixed shoulder cheek sits behind the upper arm, above the pedestal.
const pedestal = union([
  cylinder(14, 30).originOffset(0, -25, 0),
  box(16, 24, thickness).originOffset(0, -48, layer),
  axle(12, thickness).originOffset(0, -shoulderHeight, layer),
])
  .cut([
    axle(boreRadius, thickness + 2).originOffset(0, -shoulderHeight, layer),
  ])
  .material(dark);
const turntable = group(
  [pedestal, upperArm.originOffset(0, -shoulderHeight, 0)],
  {name: 'Turntable'},
).rotate(0, baseYaw, 0);

const bolts = [-1, 1].flatMap(x =>
  [-1, 1].map(z =>
    cylinder(2.5, 2)
      .originOffset(-x * 20, -5, -z * 20)
      .material(metal),
  ),
);

export default group(
  [
    cylinder(32, 8).material(dark),
    cylinder(25, 6).originOffset(0, -7, 0).material(accent),
    ...bolts,
    turntable,
  ],
  {name: 'Robot arm'},
);
