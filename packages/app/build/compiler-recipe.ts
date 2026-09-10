import {createHash} from 'node:crypto';
import {glob, readFile} from 'node:fs/promises';
import path from 'node:path';
import type {Plugin} from 'vite';

const name = 'virtual:code3d-compiler-recipe';
/** Compatibility is derived from the implementation, not a manually bumped format version. */
export function compilerRecipe(repository: string): Plugin {
  return {
    name: 'code3d-compiler-recipe',
    resolveId(id) {
      if (id === name) return '\0' + name;
    },
    async load(id) {
      if (id !== '\0' + name) return;
      const inputs = [
        'package-lock.json',
        'packages/app/vite.config.ts',
        'patches/squares-rng+2.0.4.patch',
      ];
      for await (const file of glob('packages/app/src/**/*.ts', {
        cwd: repository,
      }))
        inputs.push(file);
      const hash = createHash('sha256');
      for (const file of inputs.sort()) {
        const absolute = path.join(repository, file);
        this.addWatchFile(absolute);
        hash.update(file).update(await readFile(absolute));
      }
      return `export default ${JSON.stringify(hash.digest('hex'))};`;
    },
  };
}
