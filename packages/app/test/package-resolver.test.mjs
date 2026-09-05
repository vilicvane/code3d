import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';

let server;
let ProjectPackageResolver;
before(async () => {
  server = await createAppTestServer();
  ({ProjectPackageResolver} = await server.ssrLoadModule(
    '/src/project/package-resolver.ts',
  ));
});
after(async () => server?.close());

function resolver(entries) {
  const files = new Map(
    Object.entries(entries).map(([path, source]) => [
      path,
      typeof source === 'string' ? source : JSON.stringify(source),
    ]),
  );
  return new ProjectPackageResolver({
    async readFile(path) {
      const source = files.get(path);
      return source === undefined
        ? undefined
        : new TextEncoder().encode(source);
    },
    async stat(path) {
      if (files.has(path)) return {kind: 'file', version: files.get(path)};
      if (
        [...files.keys()].some(file =>
          file.startsWith(path === '/' ? '/' : path + '/'),
        )
      ) {
        return {kind: 'directory', version: ''};
      }
    },
  });
}

test('resolves package conditions, subpaths, imports and nested dependencies without scanning directories', async () => {
  const packages = resolver({
    '/package.json': {
      type: 'module',
      imports: {'#dimensions': './src/dimensions.ts'},
    },
    '/src/dimensions.ts': 'export const width = 42;',
    '/node_modules/parts/package.json': {
      exports: {
        '.': {browser: './browser.js', node: './node.js'},
        './shape/*': './shapes/*.js',
        './hidden': null,
      },
    },
    '/node_modules/parts/browser.js': 'export const browser = true;',
    '/node_modules/parts/node.js': '',
    '/node_modules/parts/shapes/washer.js': '',
    '/node_modules/parts/node_modules/value/package.json': {main: 'index.js'},
    '/node_modules/parts/node_modules/value/index.js': 'module.exports = 2;',
    '/node_modules/value/package.json': {main: 'index.js'},
    '/node_modules/value/index.js': 'module.exports = 1;',
  });
  assert.equal(
    await packages.resolve('parts', '/src/model.ts'),
    '/node_modules/parts/browser.js',
  );
  assert.equal(
    await packages.resolve('parts/shape/washer', '/src/model.ts'),
    '/node_modules/parts/shapes/washer.js',
  );
  assert.equal(
    await packages.resolve('#dimensions', '/src/model.ts'),
    '/src/dimensions.ts',
  );
  assert.equal(
    await packages.resolve('value', '/node_modules/parts/browser.js'),
    '/node_modules/parts/node_modules/value/index.js',
  );
  assert.equal(
    await packages.resolve('value', '/src/model.ts'),
    '/node_modules/value/index.js',
  );
  await assert.rejects(
    packages.resolve('parts/hidden', '/src/model.ts'),
    /not exported/i,
  );
  await assert.rejects(
    packages.resolve('@code3d/core', '/src/model.ts'),
    /resolve/i,
  );
  await assert.rejects(
    packages.resolve('node:fs', '/src/model.ts'),
    /not available in the browser/,
  );
});

test('distinguishes ESM and CommonJS conditions and supports explicit browser exclusions', async () => {
  const packages = resolver({
    '/node_modules/dual/package.json': {
      exports: {import: './esm.js', require: './common.cjs'},
    },
    '/node_modules/dual/esm.js': '',
    '/node_modules/dual/common.cjs': '',
    '/node_modules/web/package.json': {
      main: 'index.js',
      browser: {'./native.js': false},
    },
    '/node_modules/web/index.js': '',
    '/node_modules/web/native.js': '',
  });
  assert.equal(
    await packages.resolve('dual', '/model.ts'),
    '/node_modules/dual/esm.js',
  );
  assert.equal(
    await packages.resolve('dual', '/model.ts', 'require'),
    '/node_modules/dual/common.cjs',
  );
  assert.equal(
    await packages.resolve('./native.js', '/node_modules/web/index.js'),
    false,
  );
});
