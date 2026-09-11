/// <reference types="emscripten" preserve="true" />
import {cachedArtifact} from './cached.js';
import type * as HarfBuzz from 'harfbuzzjs';
import {
  googleFontSources,
  googleFontUrl,
  type GoogleFontOptions,
} from './google-font.js';
import {
  kernelOperationKey,
  kernelContentId,
  type KernelArtifact,
} from './kernel-cache.js';

const fontBrand: unique symbol = Symbol('Font');
/** An immutable, content-addressed font resource. Size is supplied to text(). */
export type Font = Readonly<{
  family: string;
  style: string;
  [fontBrand]: true;
}>;
export type ParsedFont = Readonly<{
  face: HarfBuzz.Face;
  font: HarfBuzz.Font;
  numGlyphs: number;
  sourceBytes: number;
}>;
let fontEngine: typeof HarfBuzz;
let shapingBuffer: HarfBuzz.Buffer;
export function installFontEngine(engine: typeof HarfBuzz): void {
  fontEngine = engine;
  shapingBuffer = new engine.Buffer();
}
export function shapeFontText(
  font: HarfBuzz.Font,
  content: string,
  kerning: boolean,
) {
  shapingBuffer.reset();
  shapingBuffer.addText(content);
  shapingBuffer.guessSegmentProperties();
  fontEngine.shape(font, shapingBuffer, [
    new fontEngine.Feature('kern', Number(kerning)),
  ]);
  return {
    infos: shapingBuffer.getGlyphInfos(),
    positions: shapingBuffer.getGlyphPositions(),
  };
}
export type FontPart = Readonly<{
  artifact: KernelArtifact<ParsedFont>;
  ranges: readonly (readonly [number, number])[];
}>;
const fonts = new WeakMap<Font, readonly FontPart[]>();
let readResource: ((url: URL) => Uint8Array | undefined) | undefined;

/** The model engine prepares resources before synchronous author code runs. */
export function installModelResourceReader(reader: typeof readResource): void {
  readResource = reader;
}

/** Reads font bytes or a prepared project/HTTP(S) URL; Node also reads file URLs. */
export function font(source: URL | ArrayBuffer | Uint8Array): Font {
  return fontValue([{artifact: parseFont(source), ranges: []}]);
}

/**
 * A Google Fonts family/style prepared by the model engine before execution.
 * @modelResource google-font
 */
export function googleFont(
  family: string,
  options: GoogleFontOptions = {},
): Font {
  const url = googleFontUrl(family, options);
  const css = readResource?.(url);
  if (!css)
    throw new Error(
      'googleFont() requires resources prepared by the model engine. Use a static family name and options.',
    );
  return fontValue(
    googleFontSources(css).map(({url, ranges}) => ({
      artifact: parseFont(new URL(url), options),
      ranges,
    })),
  );
}

function parseFont(
  source: URL | ArrayBuffer | Uint8Array,
  options: GoogleFontOptions = {},
): KernelArtifact<ParsedFont> {
  if (!fontEngine) throw new Error('The font engine has not been initialized.');
  const bytes =
    source instanceof URL
      ? readResource?.(source)
      : source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : source;
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(
      'font() requires font bytes or a URL prepared by the model engine. Use a static new URL("./font.ttf", import.meta.url) or new URL("https://…/font.ttf"); outside the engine, fetch the font first and pass its bytes.',
    );
  }
  return parsedFont(bytes, options);
}

const parsedFont = cachedArtifact(
  (bytes: Uint8Array, options: GoogleFontOptions): ParsedFont => {
    try {
      const signature = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ).getUint32(0);
      if (signature !== 0x00010000 && signature !== 0x4f54544f)
        throw new Error('Expected an SFNT font.');
      const face = new fontEngine.Face(new fontEngine.Blob(bytes));
      const maxp = face.referenceTable('maxp');
      if (!maxp || maxp.byteLength < 6 || !face.referenceTable('cmap'))
        throw new Error('Missing font tables.');
      const numGlyphs = new DataView(
        maxp.buffer,
        maxp.byteOffset,
        maxp.byteLength,
      ).getUint16(4);
      if (!numGlyphs) throw new Error('Font has no glyphs.');
      const font = new fontEngine.Font(face);
      const variations: HarfBuzz.Variation[] = [];
      if (options.weight !== undefined)
        variations.push(new fontEngine.Variation('wght', options.weight));
      if (options.italic !== undefined)
        variations.push(
          new fontEngine.Variation('ital', Number(options.italic)),
        );
      font.setVariations(variations);
      return {face, font, numGlyphs, sourceBytes: bytes.byteLength};
    } catch (error) {
      throw new Error(
        'Cannot parse font. Expected a TTF or OTF font (font collections and WOFF2 are not supported).',
        {cause: error},
      );
    }
  },
  {
    key: (bytes, options) =>
      kernelOperationKey(
        'font',
        [
          kernelContentId(bytes),
          bytes.byteLength,
          options.weight ?? null,
          options.italic ?? null,
        ],
        [],
      ),
    codec: false,
    lifecycle: {
      // Account for parser tables and lazy glyph expansion in the shared budget.
      estimateBytes: value => value.sourceBytes * 8 + value.numGlyphs * 1024,
      retain: value => value,
      instantiate: value => value,
      release() {},
    },
  },
);

function fontValue(parts: readonly FontPart[]): Font {
  const parsed = parts[0].artifact.value;
  const value: Font = Object.freeze({
    family: parsed.face.getName(1, 'en'),
    style: parsed.face.getName(2, 'en'),
    [fontBrand]: true as const,
  });
  fonts.set(value, parts);
  return value;
}

export function fontParts(value: Font): readonly FontPart[] {
  const parts = fonts.get(value);
  if (!parts)
    throw new Error(
      'text() requires a font created by font() or googleFont().',
    );
  return parts;
}
