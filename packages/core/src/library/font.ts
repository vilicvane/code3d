import {parse, type Font as OpenTypeFont} from 'opentype.js';
import {
  evaluateKernelOperation,
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
const fonts = new WeakMap<Font, KernelArtifact<OpenTypeFont>>();
let readResource: ((url: URL) => Uint8Array | undefined) | undefined;

/** The model engine prepares resources before synchronous author code runs. */
export function installModelResourceReader(reader: typeof readResource): void {
  readResource = reader;
}

/** Reads a prepared TTF/OTF resource; Node also accepts file URLs directly. */
export function font(source: URL | ArrayBuffer | Uint8Array): Font {
  const bytes =
    source instanceof URL
      ? readResource?.(source)
      : source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : source;
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(
      'font() requires font bytes or a resource prepared by the model engine. Use new URL("./font.ttf", import.meta.url).',
    );
  }
  const id = kernelContentId(bytes);
  const artifact = evaluateKernelOperation(
    'font',
    [id, bytes.byteLength],
    [],
    {
      persistent: false,
      // Font parsers decode tables and lazily expand glyph commands. Reserve room
      // for that growth as well as the retained source buffer in the shared LRU.
      estimateBytes: value => bytes.byteLength * 8 + value.numGlyphs * 1024,
      retain: value => value,
      instantiate: value => value,
      release() {},
    },
    () => {
      try {
        return parse(Uint8Array.from(bytes).buffer);
      } catch (error) {
        throw new Error(
          'Cannot parse font. Expected a TTF or OTF font (font collections and WOFF2 are not supported).',
          {cause: error},
        );
      }
    },
  );
  const value: Font = Object.freeze({
    family: artifact.value.names.fontFamily?.en ?? '',
    style: artifact.value.names.fontSubfamily?.en ?? '',
    [fontBrand]: true as const,
  });
  fonts.set(value, artifact);
  return value;
}

export function fontArtifact(value: Font): KernelArtifact<OpenTypeFont> {
  const artifact = fonts.get(value);
  if (!artifact) throw new Error('text() requires a font created by font().');
  return artifact;
}
