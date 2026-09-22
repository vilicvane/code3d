import {decodeFont, parseFont, fontValue, type Font} from './font.js';
import {modelResources, type ModelResource} from './resources.js';
import {
  googleFontSources,
  googleFontUrl,
  type GoogleFontOptions,
} from './google-font-sources.js';
export type {GoogleFontOptions} from './google-font-sources.js';

/** Asynchronously resolves a Google Fonts family/style using the runtime resource cache. */
export async function googleFont(
  family: string,
  options: GoogleFontOptions = {},
): Promise<Font> {
  options = {weight: options.weight, italic: options.italic};
  const url = googleFontUrl(family, options);
  const resources = await modelResources.bundle(
    'google-font:' + url.href,
    async () => {
      const css = await modelResources.load(url);
      const resources = new Map([[url.href, css]]);
      const urls = [
        ...new Set(googleFontSources(css.bytes).map(source => source.url)),
      ];
      let next = 0;
      await Promise.all(
        Array.from({length: Math.min(8, urls.length)}, async () => {
          while (next < urls.length) {
            const source = urls[next++];
            const resource = await modelResources.load(new URL(source));
            const bytes = await decodeFont(resource);
            parseFont(bytes, options);
            resources.set(source, {...resource, bytes});
          }
        }),
      );
      return resources;
    },
  );
  return fontValue(
    googleFontSources(resources.get(url.href)!).map(({url, ranges}) => ({
      artifact: parseFont(resources.get(url)!, options),
      ranges,
    })),
  );
}
