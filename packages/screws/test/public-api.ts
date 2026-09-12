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

import * as Direct4762 from '@code3d/screws/iso4762';
const Direct4762Screw: Direct4762.Screw = Direct4762.screw('M6', 20);
Direct4762Screw.headBottom;

import * as Direct10642 from '@code3d/screws/iso10642';

import * as Direct7380_1 from '@code3d/screws/iso7380-1';
const Direct7380_1Screw: Direct7380_1.Screw = Direct7380_1.screw('M6', 20);
Direct7380_1Screw.headBottom;

import * as Direct4017 from '@code3d/screws/iso4017';
const Direct4017Screw: Direct4017.Screw = Direct4017.screw('M6', 20);
Direct4017Screw.headBottom;

import * as Direct4014 from '@code3d/screws/iso4014';
const Direct4014Screw: Direct4014.Screw = Direct4014.screw('M6', 20);
Direct4014Screw.headBottom;

import * as Direct7380_2 from '@code3d/screws/iso7380-2';
const Direct7380_2Screw: Direct7380_2.Screw = Direct7380_2.screw('M6', 20);
Direct7380_2Screw.headBottom;

import * as Direct4029 from '@code3d/screws/iso4029';

import * as Direct7045 from '@code3d/screws/iso7045';
const Direct7045Screw: Direct7045.Screw = Direct7045.screw('M6', 20);
Direct7045Screw.headBottom;

import * as Direct14583 from '@code3d/screws/iso14583';
const Direct14583Screw: Direct14583.Screw = Direct14583.screw('M6', 20);
Direct14583Screw.headBottom;

import * as Direct7379 from '@code3d/screws/iso7379';

const countersunk: Direct10642.Screw = Direct10642.screw('M6', 20);
const countersink: Direct10642.CountersunkHole = Direct10642.clearanceHole(
  'M6',
  10,
);
countersunk.headTop.on(countersink.countersinkTop);
const plainCountersink = Direct10642.clearanceHole('M6', {
  depth: 10,
  countersink: false,
});
// @ts-expect-error Plain holes have no countersink references.
plainCountersink.countersinkTop;
// @ts-expect-error Counterbores are not countersinks.
Direct10642.clearanceHole('M6', {depth: 10, counterbore: true});
const buttonHole = Direct7380_1.clearanceHole('M6', 10);
// @ts-expect-error New headed families default to a plain hole.
buttonHole.counterboreBottom;
Direct7380_2.clearanceHole('M6', {depth: 10, counterbore: true})
  .counterboreBottom;
Direct4029.screw('M6', 12).pointBottom;
// @ts-expect-error Set screws have no head datum.
Direct4029.screw('M6', 12).headBottom;
Direct7045.screw('M6', 20, {recess: 'Z'});
// @ts-expect-error Only H and Z are cross-recess types.
Direct7045.screw('M6', 20, {recess: 'T'});
// @ts-expect-error ISO 7045 presets stop at M10.
Direct7045.screw('M12', 20);
const shoulder: Direct7379.Screw = Direct7379.screw(8, 20);
shoulder.shoulderBottom.on(Direct7379.clearanceHole(8, 10).shaftBottom);
shoulder.threadBottom;
// @ts-expect-error ISO 7379 inputs name the shoulder diameter, not the thread.
Direct7379.screw('M6', 20);
const shoulderPlain = Direct7379.clearanceHole(8, {depth: 12});
// @ts-expect-error Shoulder holes default to a plain passage.
shoulderPlain.counterboreBottom;
const shoulderCounterbored: Direct7379.CounterboredHole =
  Direct7379.clearanceHole(8, {depth: 12, counterbore: true});
shoulder.headBottom.on(shoulderCounterbored.counterboreBottom);
const shoulderRecessOptions: Direct7379.CounterboreOptions = {
  diameter: 15,
  depth: 7,
  axialClearance: 1,
};
Direct7379.clearanceHole(8, {
  depth: 12,
  diameter: 8.5,
  counterbore: shoulderRecessOptions,
}).counterboreTop;
const shoulderPlainOptions: Direct7379.PlainHoleOptions = {
  depth: 12,
  counterbore: false,
};
// @ts-expect-error A disabled counterbore has no recess reference.
Direct7379.clearanceHole(8, shoulderPlainOptions).counterboreTop;
function shoulderHole(options: Direct7379.ClearanceHoleOptions) {
  const hole = Direct7379.clearanceHole(8, options);
  // @ts-expect-error Recess references require a known enabled counterbore.
  hole.counterboreBottom;
  return hole;
}
void shoulderHole;
// @ts-expect-error Shoulder clearance is selected by diameter, not an ISO 273 fit.
Direct7379.clearanceHole(8, {depth: 12, fit: 'normal'});
