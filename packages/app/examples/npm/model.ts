import {box} from '@code3d/core';
import {TinyColor} from '@ctrl/tinycolor';

// This project installs a browser-compatible npm package automatically.
// Use F12 on TinyColor to inspect its installed declarations.
const color = new TinyColor('#2898d5').lighten(15).toHexString();
export default box(24, 16, 12).fillet(2).material(color);
