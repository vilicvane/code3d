import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {statSync} from 'node:fs';
import path from 'node:path';
import {builtinModules} from 'node:module';
import {defineConfig} from 'vite';
import {browserPackages} from './build/browser-packages.ts';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const primaryDevelopmentPort = 0xc3d;

export default defineConfig({
  define: {__CODE3D_NODE_BUILTINS__: JSON.stringify(builtinModules)},
  base: './',
  publicDir: '../../assets/brand',
  server: {port: primaryDevelopmentPort, strictPort: true},
  plugins: [
    {
      name: 'code3d-development-port',
      configResolved(config) {
        if (
          config.command === 'serve' &&
          !config.isPreview &&
          !config.server.middlewareMode &&
          config.server.port === primaryDevelopmentPort &&
          statSync(path.resolve(packageDirectory, '../../.git'), {
            throwIfNoEntry: false,
          })?.isFile()
        ) {
          throw new Error(
            'Port 3133 (0xc3d) is reserved for the primary worktree. ' +
              'Reserve another port with coordination.py reserve-port, then start Vite with --port <port>.',
          );
        }
      },
    },
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
