import {ISO4762} from '@code3d/screws';

const spec: ISO4762.Specification = ISO4762.resolveSpecification('M6');
const input: ISO4762.ScrewInput = spec;
const threadedLength: number = ISO4762.threadLength(spec, 30);
const screw: ISO4762.Screw = ISO4762.screw(input, 30);
const screwElements: ISO4762.SocketCapScrewElements = screw;
const plain: ISO4762.ClearanceHole = ISO4762.clearanceHole(input, {
  depth: 10,
  counterbore: false,
});
const plainElements: ISO4762.SocketCapHoleElements = plain;
const counterbored: ISO4762.CounterboredHole = ISO4762.clearanceHole(input, 10);
const counterboreElements: ISO4762.CounterboredSocketCapHoleElements =
  counterbored;

screwElements.headBottom.on(counterboreElements.counterboreBottom);
plainElements.shaftBottom.on(counterboreElements.shaftBottom);
// @ts-expect-error A plain clearance hole has no counterbore reference.
plainElements.counterboreBottom;

void threadedLength;
