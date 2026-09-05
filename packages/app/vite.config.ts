import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {defineConfig} from 'vite';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [
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
