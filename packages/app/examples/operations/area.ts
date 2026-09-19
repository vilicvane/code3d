import {group, rectangle, tube} from '@code3d/core';

const sheet = rectangle(30, 20);
const pipe = tube(15, 10, 40).originOffset(-60, 0, 0);

// Select .area to inspect a finite face or every boundary face of a solid.
const sheetArea = sheet.area; // 600
const pipeSurfaceArea = pipe.area; // Includes inner wall and annular ends.
const selectedFaceArea = pipe.surfaces()[0].area;
const enlargedArea = sheet.scaled(2).area; // 2400

export default group([sheet, pipe]);
