import {
  align,
  axisEdge,
  axisLine,
  box,
  coupleRotation,
  cylinder,
  group,
  offset,
  on,
  pivot,
  pivotPoint,
  pivotVertex,
  point,
  rotate,
} from '@code3d/core';

const standBase = box(32, 4, 24);
const standPost = box(8, 12, 8).relate(() => on(standBase.up));
export const stand = group([standBase, standPost], 'Stand');

const pin = cylinder(4, 18);
export const mountingPin = pin.expose({
  seat: pin.down,
  tip: pin.up,
  shaft: pin.axis,
});

const relationBase = box(32, 4, 24);
const relationPart = box(8, 12, 8).relate(self => [
  on(self, relationBase.up),
  offset(6, 0, 0),
  rotate(0, 0, 20),
]);
export const relatedAssembly = group([relationBase, relationPart]);

const bed = box(30, 4, 20);
const contactPart = box(8, 10, 6).relate(() => on(bed.up));
export const contactAssembly = group([bed, contactPart]);

const datum = point([16, 8, 0]);
const alignedPart = box(8, 6, 10).relate(self => align(self.center, datum));
export const alignedAssembly = group([point(), datum, alignedPart]);

const shiftBase = box(32, 4, 24);
const shiftPart = box(8, 10, 8).relate(() => [
  on(shiftBase.up),
  offset(7, 0, 0),
]);
export const shiftedAssembly = group([shiftBase, shiftPart]);

const turnBase = box(32, 4, 24);
const turnPart = box(8, 10, 8).relate(() => [
  on(turnBase.up),
  rotate(0, 0, 25),
]);
export const turnedAssembly = group([turnBase, turnPart]);

const pivotBase = box(32, 4, 24);
const pivotPart = box(12, 10, 8).relate(() => [
  on(pivotBase.up),
  pivot([6, -5, 0]).rotate(0, 0, 35),
]);
export const pivotedAssembly = group([pivotBase, pivotPart]);

const cornerBase = box(32, 4, 24);
const cornerPart = box(12, 10, 8).relate(() => [
  on(cornerBase.up),
  pivotVertex(3).pivotOffset(0, 1, 0).rotate(0, 0, 30),
]);
export const cornerAssembly = group([cornerBase, cornerPart]);

const pointBase = box(32, 4, 24);
const pointPart = box(12, 10, 8).relate(self => [
  on(pointBase.up),
  pivotPoint(self.vertex(3)).rotate(0, 0, 30),
]);
export const pointPivotAssembly = group([pointBase, pointPart]);

const edgeBase = box(32, 4, 24);
const edgePart = box(12, 10, 8).relate(() => [
  on(edgeBase.up),
  axisEdge(2).rotate(40),
]);
export const edgeAxisAssembly = group([edgeBase, edgePart]);

const axisBase = box(32, 4, 24);
const axisPart = box(12, 10, 8).relate(self => [
  on(axisBase.up),
  axisLine(self.axis).axisOffset(3, 0, 0).rotate(40),
]);
export const lineAxisAssembly = group([axisBase, axisPart]);

const couplingBase = box(2, 2, 2);
const crank = box(20, 3, 6).relate(self => [
  align(self.frame, couplingBase.frame),
  axisLine(self.axis).rotate(90),
]);
const follower = box(30, 3, 6).relate(self => [
  align(self.origin, crank.origin),
  coupleRotation(crank, {ratio: -0.5}),
  offset(40, 0, 0),
]);
export const transmission = group([couplingBase, crank, follower]);
