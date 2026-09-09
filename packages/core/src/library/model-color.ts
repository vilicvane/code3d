import {TinyColor} from '@ctrl/tinycolor';

export type ModelColor = Readonly<{
  rgb: string;
  alpha: number;
  hex: string;
}>;

/** Resolve authored colors identically for previews and exported materials. */
export function parseModelColor(input: string): ModelColor {
  const invalid = () =>
    new Error(`Invalid material color: ${JSON.stringify(input)}`);
  const rgb = /^rgba?\((.*)\)$/is.exec(input.trim());
  let color: TinyColor;
  if (rgb) {
    // TinyColor's legacy function parser ignores slash alpha and alpha percentages.
    const channels = rgb[1].trim().split(/[\s,/]+/);
    if (
      (channels.length !== 3 && channels.length !== 4) ||
      channels.some(
        channel =>
          !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(channel),
      )
    )
      throw invalid();
    const component = (value: string, scale: number): number =>
      value.endsWith('%')
        ? (parseFloat(value) / 100) * scale
        : parseFloat(value);
    const alpha = channels[3] === undefined ? 1 : component(channels[3], 1);
    color = new TinyColor({
      r: component(channels[0], 255),
      g: component(channels[1], 255),
      b: component(channels[2], 255),
      a: Math.max(0, Math.min(1, alpha)),
    });
  } else {
    color = new TinyColor(input);
  }
  if (!color.isValid) throw invalid();
  const alpha = color.getAlpha();
  return {
    rgb: color.toHexString(),
    alpha,
    hex: alpha === 1 ? color.toHexString() : color.toHex8String(),
  };
}
