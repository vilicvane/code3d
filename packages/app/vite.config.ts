import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {defineConfig} from 'vite';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        app: path.join(packageDirectory, 'index.html'),
        render: path.join(packageDirectory, 'render.html'),
      },
    },
  },
});
