import {evaluateModelGeometry, faceModel, type FaceModel} from './runtime.js';
import type {Font} from './font.js';
import {textGlyphs, textRegionFace, type TextOptions} from './text-geometry.js';
export type {TextOptions} from './text-geometry.js';

/**
 * Creates connected text faces on the XZ plane: +X right, -Z up, normal +Y.
 * All faces share the baseline origin. Size is the font em in model units.
 * @code3d.param size {kind: 'length', label: 'Text size'}
 */
export function text(
  content: string,
  font: Font,
  size: number,
  options?: TextOptions,
): readonly FaceModel[] {
  return textGlyphs(content, font, size, options).flatMap(({regions, x, y}) =>
    regions.value.map((region, index) => {
      const geometry = evaluateModelGeometry(
        'text',
        [x, y, index],
        [regions],
        () => ({shape: textRegionFace(region, x, y)}),
      );
      return faceModel('text', 'Text face', geometry);
    }),
  );
}
