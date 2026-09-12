import {group, type SolidModel} from '@code3d/core';
import * as GB70_1 from '@code3d/screws/gb70-1';
import * as GB70_3 from '@code3d/screws/gb70-3';
import * as GB70_2 from '@code3d/screws/gb70-2';
import * as GB5783 from '@code3d/screws/gb5783';
import * as GB5782 from '@code3d/screws/gb5782';
import * as GB70_4 from '@code3d/screws/gb70-4';
import * as GB80 from '@code3d/screws/gb80';
import * as GB818 from '@code3d/screws/gb818';
import * as GB2672 from '@code3d/screws/gb2672';
import * as GB5281 from '@code3d/screws/gb5281';

function place(model: SolidModel, column: number, row: number, name: string) {
  return group(
    [model.originCenter().originOffset(-column * 24, 0, -row * 36)],
    name,
  );
}

// Top row: common head shapes. Bottom row: collar, set screw and drives.
// Models share their height centre. The shoulder length excludes its thread.
export default group(
  [
    place(GB70_1.screw('M6', 24), 0, 0, 'GB/T 70.1 · socket cap'),
    place(GB70_3.screw('M6', 24), 1, 0, 'GB/T 70.3 · countersunk'),
    place(GB70_2.screw('M6', 24), 2, 0, 'GB/T 70.2 · button'),
    place(GB5783.screw('M6', 30), 3, 0, 'GB/T 5783 · full thread'),
    place(GB5782.screw('M6', 30), 4, 0, 'GB/T 5782 · partial thread'),
    place(GB70_4.screw('M6', 24), 0, 1, 'GB/T 70.4 · collar'),
    place(GB80.screw('M6', 12), 1, 1, 'GB/T 80 · cup point'),
    place(GB818.screw('M6', 24, {recess: 'Z'}), 2, 1, 'GB/T 818 · Z drive'),
    place(GB2672.screw('M6', 24), 3, 1, 'GB/T 2672 · hexalobular'),
    place(GB5281.screw(8, 20), 4, 1, 'GB/T 5281 · shoulder'),
  ],
  'GB/T screw standards',
).material('#aaa');
