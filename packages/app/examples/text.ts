import {box, cut, extrude, font, group, text, union} from '@code3d/core';

const sans = font(new URL('./fonts/DejaVuSans.ttf', import.meta.url));
const profiles = text('B8i', sans, 10, {letterSpacing: 0.3, kerning: true});

export const lettering = group(extrude(profiles, 2)).material('#e8b45d');

const raisedBase = box(26, 2, 14).originOffset(-10, 1, 4);
export const raised = union([raisedBase, ...extrude(profiles, 1.5)])
  .originOffset(0, 0, -18)
  .material('#529dcb');

const engravedBase = box(26, 2, 14).originOffset(-10, 1, 4);
export const engraved = cut(engravedBase, extrude(profiles, -1))
  .originOffset(0, 0, -36)
  .material('#75ad89');
