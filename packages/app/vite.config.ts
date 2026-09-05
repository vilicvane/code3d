import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {defineConfig} from 'vite';
import {browserPackages} from './build/browser-packages.ts';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  publicDir: '../../assets/brand',
  plugins: [
    browserPackages(path.resolve(packageDirectory, '../..')),
    {
      name: 'code3d-license',
      async generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'LICENSE',
          source: await readFile(
            new URL('../../LICENSE', import.meta.url),
            'utf8',
          ),
        });
      },
    },
  ],
  build: {
    rolldownOptions: {
      input: {
        app: path.join(packageDirectory, 'index.html'),
        render: path.join(packageDirectory, 'render.html'),
      },
    },
  },
});
