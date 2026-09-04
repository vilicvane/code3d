import {createRequire, registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';

// Astro and Volar both require TypeScript's JavaScript compiler API. Volar's
// wildcard peer can be hoisted beside the repository's native TS 7 package.
// Give the complete checker process the website's TS 6 compiler, including
// transitive imports, without changing how core or App resolve TypeScript.
const require = createRequire(import.meta.url);
const compiler = pathToFileURL(require.resolve('typescript')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'typescript'
      ? {url: compiler, shortCircuit: true}
      : nextResolve(specifier, context);
  },
});

const {check, parseArgsAsCheckConfig} = await import('@astrojs/check');
process.exitCode = (await check(parseArgsAsCheckConfig(process.argv))) ? 1 : 0;
