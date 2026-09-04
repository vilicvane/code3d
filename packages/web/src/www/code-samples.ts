export type HighlightedCodeSample = Readonly<{
  source: string;
  html: string;
}>;

export type HighlightedCodeSamples = Readonly<{
  assembly: HighlightedCodeSample;
  package: HighlightedCodeSample;
}>;

export const fallbackAssemblySource = `import {box, cut, group} from '@code3d/core';
import {ISO4762} from '@code3d/screws';

const plate = box(38, 6, 26);
const hole = ISO4762.clearanceHole('M6', {
  depth: 10,
  fit: 'normal',
  counterbore: true,
}).relate(tool => tool.shaftBottom.on(plate.bottom).flip());

export const assembly = group([
  cut(plate, [hole]),
  ISO4762.screw('M6', 18),
]);`;

export const packageSource = `import {ISO4762} from '@code3d/screws';

export const mountingHole = (depth: number) =>
  ISO4762.clearanceHole('M6', {
    depth,
    fit: 'normal',
    counterbore: true,
  });`;

export const fallbackCodeSamples: HighlightedCodeSamples = {
  assembly: {source: fallbackAssemblySource, html: ''},
  package: {source: packageSource, html: ''},
};
