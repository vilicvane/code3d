import {
  applyPatch,
  parsePatch,
  reversePatch,
  type ApplyPatchOptions,
} from 'diff';
import squaresRngPatch from '../../../../patches/squares-rng+2.0.4.patch?raw';
import {
  decodeProjectFile,
  statProjectFiles,
  type ProjectFileReader,
} from './file-reader';
import {parsePackageManifest} from './package-manifest';
import {normalizeProjectPath} from './project';

const [patch] = parsePatch(squaresRngPatch);
const reversedPatch = reversePatch(patch);
const suffix = '/node_modules/squares-rng/node/index.js';
// The npm file mixes CRLF in its embedded WASM string with LF in JavaScript.
// Match line endings without rewriting the retained source bytes.
const patchOptions: ApplyPatchOptions = {
  autoConvertLineEndings: false,
  compareLine: (_number, line, _operation, content) =>
    line?.replace(/\r$/, '') === content.replace(/\r$/, ''),
};

/** Compile installed and builtin packages with the same Worker-compatible bytes. */
export function patchModelPackages(
  reader: ProjectFileReader,
): ProjectFileReader {
  return {
    async readFile(path) {
      path = normalizeProjectPath(path);
      const contents = await reader.readFile(path);
      if (!contents || !path.endsWith(suffix)) return contents;
      const manifestPath =
        path.slice(0, -'node/index.js'.length) + 'package.json';
      const manifestBytes = await reader.readFile(manifestPath);
      if (!manifestBytes) return contents;
      const manifest = parsePackageManifest(
        decodeProjectFile(manifestBytes),
        manifestPath,
      );
      if (manifest.name !== 'squares-rng' || manifest.version !== '2.0.4')
        return contents;
      const source = decodeProjectFile(contents);
      const patched = applyPatch(source, patch, patchOptions);
      if (patched !== false) return new TextEncoder().encode(patched);
      if (applyPatch(source, reversedPatch, patchOptions) !== false)
        return contents;
      throw new Error(
        `Unable to apply the squares-rng@2.0.4 Worker compatibility patch: ${path}`,
      );
    },
    stat: path => reader.stat(path),
    statMany: paths => statProjectFiles(reader, paths),
  };
}
