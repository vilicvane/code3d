import {evaluateKernelOperation, kernelContentId} from './kernel-cache.js';
import {estimateRetainedBytes} from './retained-memory.js';

export type GoogleFontOptions = Readonly<{
  /** Omit to use Google Fonts' default weight. */
  weight?: number;
  /** Omit to use Google Fonts' default style. */
  italic?: boolean;
}>;

export type GoogleFontSource = Readonly<{
  url: string;
  ranges: readonly (readonly [number, number])[];
}>;

/** Canonical request shared by synchronous Core and asynchronous preparation. */
export function googleFontUrl(
  family: string,
  options: GoogleFontOptions = {},
): URL {
  if (typeof family !== 'string' || !family.trim())
    throw new Error('Google font family must be a non-empty name.');
  if (
    options.weight !== undefined &&
    (!Number.isFinite(options.weight) ||
      options.weight < 1 ||
      options.weight > 1000)
  )
    throw new Error('Google font weight must be between 1 and 1000.');
  if (options.italic !== undefined && typeof options.italic !== 'boolean')
    throw new Error('Google font italic must be a boolean.');
  const axes: [string, number][] = [];
  if (options.italic !== undefined) axes.push(['ital', Number(options.italic)]);
  if (options.weight !== undefined) axes.push(['wght', options.weight]);
  const specification =
    family.trim() +
    (axes.length
      ? ':' +
        axes.map(([axis]) => axis).join(',') +
        '@' +
        axes.map(([, value]) => value).join(',')
      : '');
  return new URL(
    'https://fonts.googleapis.com/css2?' +
      new URLSearchParams({family: specification}),
  );
}

/** Parse only font-face resource declarations; no stylesheet is installed. */
export function googleFontSources(
  bytes: Uint8Array,
): readonly GoogleFontSource[] {
  return evaluateKernelOperation<readonly GoogleFontSource[]>(
    'googleFontSources',
    [kernelContentId(bytes)],
    [],
    {
      estimateBytes: estimateRetainedBytes,
      retain: value => value,
      instantiate: value => value,
      release() {},
    },
    () => {
      const css = new TextDecoder()
        .decode(bytes)
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const sources: GoogleFontSource[] = [];
      for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
        const source = /(?:^|;)\s*src\s*:\s*([^;]+)/i.exec(body)?.[1];
        const rawUrl =
          source &&
          /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/i.exec(source);
        if (!rawUrl)
          throw new Error('Google Fonts returned a font face without a URL.');
        const url = new URL(rawUrl[1] ?? rawUrl[2] ?? rawUrl[3]);
        if (url.protocol !== 'https:')
          throw new Error('Google Fonts returned a non-HTTPS font URL.');
        const ranges: [number, number][] = [];
        const range = /(?:^|;)\s*unicode-range\s*:\s*([^;]+)/i.exec(body)?.[1];
        if (range)
          for (const part of range.split(',')) {
            const match =
              /^\s*U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
            if (!match)
              throw new Error(
                'Google Fonts returned an invalid Unicode range.',
              );
            const start = parseInt(match[1].replaceAll('?', '0'), 16);
            const end = parseInt(match[2] ?? match[1].replaceAll('?', 'f'), 16);
            if (start > end || end > 0x10ffff)
              throw new Error(
                'Google Fonts returned an invalid Unicode range.',
              );
            ranges.push([start, end]);
          }
        sources.push({url: url.href, ranges});
      }
      if (!sources.length)
        throw new Error('Google Fonts returned no font files.');
      // Later CSS faces take precedence where Unicode ranges overlap.
      return sources.reverse();
    },
  ).value;
}
