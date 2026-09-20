import {
  box,
  cut,
  extrude,
  googleFont,
  group,
  originCenter,
  text,
  union,
} from '@code3d/core';

// Google Fonts is downloaded on first use.
const sans = await googleFont('Play');
// Local alternative: import font, then await font(new URL('./my-font.ttf', import.meta.url)).
const outlines = text('Code3D', sans, 10, {letterSpacing: 0.3, kerning: true});
// Center the complete text while keeping its letter spacing and holes.
const profiles = originCenter(outlines);

export const lettering = group(extrude(profiles, 2)).material('#e8b45d');

const raisedBase = box(46, 2, 14).originOffset(0, 1, 0);
export const raised = union([raisedBase, ...extrude(profiles, 1.5)])
  .originOffset(0, 0, -18)
  .material('#529dcb');

const engravedBase = box(46, 2, 14).originOffset(0, 1, 0);
export const engraved = cut(engravedBase, extrude(profiles, -1))
  .originOffset(0, 0, -36)
  .material('#75ad89');
