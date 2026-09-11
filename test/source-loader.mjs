import {existsSync, readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {transformSync} from 'esbuild';

const packages = fileURLToPath(new URL('../packages/', import.meta.url));
const sourcePath = filename => {
  if (!filename.startsWith(packages)) return;
  const relative = filename.slice(packages.length).split(path.sep).join('/');
  const match =
    /^(core|materials|screws|agent|cli)\/(bld|src)\/(.+)\.[jt]s$/.exec(
      relative,
    );
  if (!match) return;
  const source = `${packages}${match[1]}/src/${match[3]}.ts`;
  return existsSync(source) ? source : undefined;
};

// White-box tests load one source graph, including package self-imports. Actual
// published bundles are exercised separately by isolated tarball consumers.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
      const source = sourcePath(
        fileURLToPath(new URL(specifier, context.parentURL)),
      );
      if (source) return {url: pathToFileURL(source).href, shortCircuit: true};
    }
    const resolved = nextResolve(specifier, context);
    if (resolved.url.startsWith('file:')) {
      const source = sourcePath(fileURLToPath(resolved.url));
      if (source) return {...resolved, url: pathToFileURL(source).href};
    }
    return resolved;
  },
  load(url, context, nextLoad) {
    const filename = url.startsWith('file:')
      ? sourcePath(fileURLToPath(url))
      : undefined;
    if (!filename) return nextLoad(url, context);
    const {code} = transformSync(readFileSync(filename, 'utf8'), {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: filename,
      sourcemap: 'inline',
      tsconfigRaw: {compilerOptions: {useDefineForClassFields: true}},
    });
    return {format: 'module', source: code, shortCircuit: true};
  },
});
