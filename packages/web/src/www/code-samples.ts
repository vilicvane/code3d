export type HighlightedCodeSample = Readonly<{
  source: string;
  html: string;
}>;

export type HighlightedCodeSamples = Readonly<{
  assembly: HighlightedCodeSample;
  package: HighlightedCodeSample;
}>;

export const packageSource = `import {cylinder} from '@code3d/core';

export function locatingPin(radius: number, height: number) {
  const body = cylinder(radius, height);

  return body
    .expose({
      mountingFace: body.bottom,
      tipFace: body.top,
      centerline: body.axis,
    });
}`;
