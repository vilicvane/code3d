import {group, type SolidModel} from '@code3d/core';
import * as ISO4762 from '@code3d/screws/iso4762';
import * as ISO10642 from '@code3d/screws/iso10642';
import * as ISO7380_1 from '@code3d/screws/iso7380-1';
import * as ISO4017 from '@code3d/screws/iso4017';
import * as ISO4014 from '@code3d/screws/iso4014';
import * as ISO7380_2 from '@code3d/screws/iso7380-2';
import * as ISO4029 from '@code3d/screws/iso4029';
import * as ISO7045 from '@code3d/screws/iso7045';
import * as ISO14583 from '@code3d/screws/iso14583';
import * as ISO7379 from '@code3d/screws/iso7379';

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
    place(ISO4762.screw('M6', 24), 0, 0, 'ISO 4762 · socket cap'),
    place(ISO10642.screw('M6', 24), 1, 0, 'ISO 10642 · countersunk'),
    place(ISO7380_1.screw('M6', 24), 2, 0, 'ISO 7380-1 · button'),
    place(ISO4017.screw('M6', 30), 3, 0, 'ISO 4017 · full thread'),
    place(ISO4014.screw('M6', 30), 4, 0, 'ISO 4014 · partial thread'),
    place(ISO7380_2.screw('M6', 24), 0, 1, 'ISO 7380-2 · collar'),
    place(ISO4029.screw('M6', 12), 1, 1, 'ISO 4029 · cup point'),
    place(ISO7045.screw('M6', 24, {recess: 'Z'}), 2, 1, 'ISO 7045 · Z drive'),
    place(ISO14583.screw('M6', 24), 3, 1, 'ISO 14583 · hexalobular'),
    place(ISO7379.screw(8, 20), 4, 1, 'ISO 7379 · shoulder'),
  ],
  'ISO screw standards',
).material('#aaa');
