import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import type {PackageManifest} from '../src/project/package-manifest.ts';
import {packageTestFiles} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compatibility: typeof import('../src/project/package-compatibility.ts');
let ProjectPackages: (typeof import('../src/project/project-packages.ts'))['ProjectPackages'];
let WorkspaceFileReader: (typeof import('../src/project/workspace-packages.ts'))['WorkspaceFileReader'];
let ProjectCompiler: (typeof import('../src/model/project-compiler.ts'))['ProjectCompiler'];
let ModelDiagnosticError: (typeof import('../src/model/diagnostic.ts'))['ModelDiagnosticError'];

before(async () => {
  server = await createAppTestServer();
  compatibility = await server.ssrLoadModule<
    typeof import('../src/project/package-compatibility.ts')
  >('/src/project/package-compatibility.ts');
  ({ProjectPackages} = await server.ssrLoadModule<
    typeof import('../src/project/project-packages.ts')
  >('/src/project/project-packages.ts'));
  ({WorkspaceFileReader} = await server.ssrLoadModule<
    typeof import('../src/project/workspace-packages.ts')
  >('/src/project/workspace-packages.ts'));
  ({ProjectCompiler} = await server.ssrLoadModule<
    typeof import('../src/model/project-compiler.ts')
  >('/src/model/project-compiler.ts'));
  ({ModelDiagnosticError} = await server.ssrLoadModule<
    typeof import('../src/model/diagnostic.ts')
  >('/src/model/diagnostic.ts'));
});
after(async () => server?.close());

function memoryFiles(entries: Record<string, unknown>): ProjectFileReader & {
  contents: Map<string, string>;
} {
  const contents = new Map(
    Object.entries(entries).map(([path, value]) => [
      path,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );
  return {
    contents,
    async readFile(path) {
      const value = contents.get(path);
      return value === undefined ? undefined : new TextEncoder().encode(value);
    },
    async stat(path) {
      if (contents.has(path))
        return {kind: 'file', version: contents.get(path)!};
      if (
        [...contents.keys()].some(file =>
          file.startsWith(path === '/' ? '/' : path + '/'),
        )
      )
        return {kind: 'directory', version: ''};
      return undefined;
    },
  };
}

const coreManifest = '/node_modules/@code3d/core/package.json';
const versions = {'@code3d/core': '2.0.0', '@code3d/materials': '3.0.0'};
const builtinFiles = () =>
  memoryFiles(
    Object.fromEntries(
      Object.entries(versions).map(([name, version]) => [
        `/node_modules/${name}/package.json`,
        {name, version},
      ]),
    ),
  );

for (const installed of ['1.0.0', '2.0.0', '3.0.0']) {
  test(`checks the installed ${installed} package against this App, regardless of latest in the manifest`, async () => {
    const builtins = builtinFiles();
    const files = memoryFiles({
      '/package.json': {dependencies: {'@code3d/core': 'latest'}},
      [coreManifest]: {name: '@code3d/core', version: installed},
    });
    const packages = new ProjectPackages(files, builtins);
    await packages.update({files: []}, '/model.ts');
    const issue = await compatibility.findPackageCompatibility(
      packages,
      builtins,
      '/model.ts',
    );
    if (installed === versions['@code3d/core']) {
      assert.equal(issue, undefined);
    } else {
      assert.deepEqual(issue, {
        directory: '/',
        packages: [
          {
            name: '@code3d/core',
            installed,
            expected: '2.0.0',
            manifestPath: '/package.json',
          },
        ],
        matchingVersions: versions,
      });
    }
  });
}

test('nested scopes retain the actual manifest owners and resolve aliases without inspecting unrelated projects', async () => {
  const builtins = builtinFiles();
  const files = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': 'latest'}},
    [coreManifest]: {name: '@code3d/core', version: '1.0.0'},
    '/panel/package.json': {
      dependencies: {surface: 'npm:@code3d/materials@latest'},
    },
    '/panel/node_modules/surface/package.json': {
      name: '@code3d/materials',
      version: '1.0.0',
    },
    '/other/package.json': {dependencies: {'@code3d/core': '1.0.0'}},
    '/other/node_modules/@code3d/core/package.json': {version: '0.0.1'},
  });
  const packages = new ProjectPackages(files, builtins);
  await packages.update({files: []}, '/panel/src/model.ts');
  const issue = await compatibility.findPackageCompatibility(
    packages,
    builtins,
    '/panel/src/model.ts',
  );
  assert.deepEqual(issue?.packages, [
    {
      name: '@code3d/materials',
      installed: '1.0.0',
      expected: '3.0.0',
      manifestPath: '/panel/package.json',
    },
    {
      name: '@code3d/core',
      installed: '1.0.0',
      expected: '2.0.0',
      manifestPath: '/package.json',
    },
  ]);
  assert.equal(issue?.directory, '/panel');
  files.contents.set(
    '/panel/package.json',
    JSON.stringify({dependencies: {'@code3d/core': '2.0.0'}}),
  );
  files.contents.set(
    '/panel/node_modules/@code3d/core/package.json',
    JSON.stringify({version: '2.0.0'}),
  );
  await packages.update({files: []}, '/panel/src/model.ts');
  assert.equal(
    await compatibility.findPackageCompatibility(
      packages,
      builtins,
      '/panel/src/model.ts',
    ),
    undefined,
  );
});

test('zero-install and latest development overlays use the selected packages instead of old disk installations', async () => {
  const builtins = builtinFiles();
  const files = memoryFiles({
    '/package.json': {},
    [coreManifest]: {name: '@code3d/core', version: '1.0.0'},
  });
  let packages = new ProjectPackages(files, builtins);
  await packages.update({files: []});
  assert.equal(packages.source, 'builtin');
  assert.equal(
    await compatibility.findPackageCompatibility(
      packages,
      builtins,
      '/model.ts',
    ),
    undefined,
  );
  files.contents.set(
    '/package.json',
    JSON.stringify({dependencies: {'@code3d/core': 'latest'}}),
  );
  const development = new WorkspaceFileReader(files, builtins, {
    '@code3d/core': {
      manifest: {name: '@code3d/core', version: '2.0.0'},
      revision: 'a'.repeat(64),
      files: {},
    },
  });
  packages = new ProjectPackages(development, builtins);
  await packages.update({files: []});
  assert.equal(packages.source, 'project');
  assert.equal(
    await compatibility.findPackageCompatibility(
      packages,
      builtins,
      '/model.ts',
    ),
    undefined,
  );
  files.contents.set(
    '/package.json',
    JSON.stringify({dependencies: {'@code3d/core': '1.0.0'}}),
  );
  await packages.update({files: []});
  assert.equal(
    (
      await compatibility.findPackageCompatibility(
        packages,
        builtins,
        '/model.ts',
      )
    )?.packages[0].installed,
    '1.0.0',
  );
});

test('missing installations keep their module error while an installed package without version is identified', async () => {
  const builtins = builtinFiles();
  const files = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': 'latest'}},
  });
  assert.equal(
    await compatibility.findPackageCompatibility(files, builtins, '/model.ts'),
    undefined,
  );
  files.contents.set(coreManifest, '{}');
  assert.equal(
    (await compatibility.findPackageCompatibility(files, builtins, '/model.ts'))
      ?.packages[0].installed,
    'unknown',
  );
});

test('upgrading preserves latest declarations and dependency fields while updating pinned packages and aliases', () => {
  const manifest: PackageManifest = {
    name: 'my-project',
    scripts: {test: 'custom-test'},
    dependencies: {'@code3d/core': '1.0.0', utility: '~4'},
    devDependencies: {
      surface: 'npm:@code3d/materials@latest',
      pinnedSurface: 'npm:@code3d/materials@1.0.0',
      tool: '2',
    },
    peerDependencies: {'@code3d/core': '*'},
    optionalDependencies: {'@code3d/materials': 'latest'},
    peerDependenciesMeta: {'@code3d/core': {optional: true}},
  };
  const original = structuredClone(manifest);
  assert.deepEqual(
    compatibility.upgradeCode3dDependencies(manifest, versions),
    {
      ...manifest,
      dependencies: {'@code3d/core': '2.0.0', utility: '~4'},
      devDependencies: {
        surface: 'npm:@code3d/materials@latest',
        pinnedSurface: 'npm:@code3d/materials@3.0.0',
        tool: '2',
      },
      peerDependencies: {'@code3d/core': '2.0.0'},
      optionalDependencies: {'@code3d/materials': 'latest'},
    },
  );
  assert.deepEqual(manifest, original);
  assert.deepEqual(
    compatibility.upgradeCode3dDependencies(
      {dependencies: {'@code3d/core': 'latest'}},
      versions,
    ),
    {dependencies: {'@code3d/core': 'latest'}},
  );
  assert.deepEqual(
    compatibility.upgradeCode3dDependencies({private: true}, versions),
    {private: true},
  );
});

test('compilation reports a structured mismatch before attempting missing old tooling exports', async () => {
  const files = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': '1.0.0'}},
    [coreManifest]: {name: '@code3d/core', version: '1.0.0'},
    '/model.ts':
      'import {box} from "@code3d/core"; export default box(1, 2, 3);',
  });
  const compiler = new ProjectCompiler(files, builtinFiles(), esbuild);
  try {
    await assert.rejects(compiler.compile({files: []}, '/model.ts'), error => {
      assert.ok(error instanceof ModelDiagnosticError);
      assert.equal(error.diagnostic.summary, 'Code3D package version mismatch');
      assert.equal(error.diagnostic.sourceRef?.file, '/model.ts');
      assert.deepEqual(structuredClone(error.diagnostic).packageCompatibility, {
        directory: '/',
        packages: [
          {
            name: '@code3d/core',
            installed: '1.0.0',
            expected: '2.0.0',
            manifestPath: '/package.json',
          },
        ],
        matchingVersions: versions,
      });
      return true;
    });
  } finally {
    await compiler.dispose();
  }
});

test('an alias-only installed Core is checked even when the runtime uses builtin packages', async () => {
  const files = memoryFiles({
    '/package.json': {
      dependencies: {'legacy-core': 'npm:@code3d/core@1.0.0'},
    },
    '/node_modules/legacy-core/package.json': {
      name: '@code3d/core',
      version: '1.0.0',
    },
    '/model.ts':
      'import {box} from "legacy-core"; export default box(1, 2, 3);',
  });
  const compiler = new ProjectCompiler(files, builtinFiles(), esbuild);
  try {
    await assert.rejects(compiler.compile({files: []}, '/model.ts'), error => {
      assert.ok(error instanceof ModelDiagnosticError);
      assert.equal(
        error.diagnostic.packageCompatibility?.packages[0].name,
        '@code3d/core',
      );
      assert.equal(
        error.diagnostic.packageCompatibility?.packages[0].manifestPath,
        '/package.json',
      );
      return true;
    });
    assert.equal(
      await compiler.canRestoreDependencies(
        {metadata: []},
        {files: []},
        '/model.ts',
      ),
      false,
    );
  } finally {
    await compiler.dispose();
  }
});

for (const dynamic of [false, true]) {
  test(`a reached ${dynamic ? 'dynamic' : 'static'} transitive package retains its dependency owner and structured diagnostic`, async () => {
    const current = JSON.parse(
      new TextDecoder().decode(await packageTestFiles.readFile(coreManifest)),
    );
    const entries = memoryFiles({
      '/package.json': {
        dependencies: {'@code3d/core': current.version, wrapper: '1'},
      },
      '/model.ts': 'export {value} from "wrapper";',
      '/node_modules/wrapper/package.json': {
        name: 'wrapper',
        type: 'module',
        main: './index.js',
        dependencies: {'legacy-materials': 'npm:@code3d/materials@0.0.0'},
      },
      '/node_modules/wrapper/index.js': dynamic
        ? 'export const value = (await import("legacy-materials")).value;'
        : 'export {value} from "legacy-materials";',
      '/node_modules/wrapper/node_modules/legacy-materials/package.json': {
        name: '@code3d/materials',
        version: '0.0.0',
        type: 'module',
        main: './index.js',
      },
      '/node_modules/wrapper/node_modules/legacy-materials/index.js':
        'export const value = 1;',
    });
    const files: ProjectFileReader = {
      readFile: async path =>
        (await entries.readFile(path)) ?? packageTestFiles.readFile(path),
      stat: async path =>
        (await entries.stat(path)) ?? packageTestFiles.stat(path),
    };
    const compiler = new ProjectCompiler(files, packageTestFiles, esbuild);
    try {
      await assert.rejects(
        compiler.compile({files: []}, '/model.ts'),
        error => {
          assert.ok(error instanceof ModelDiagnosticError);
          const issue = error.diagnostic.packageCompatibility;
          assert.equal(issue?.packages[0].name, '@code3d/materials');
          assert.equal(issue?.packages[0].installed, '0.0.0');
          assert.equal(issue?.packages[0].manifestPath, '/package.json');
          assert.deepEqual(issue?.packages[0].manual, {
            reason: 'transitive',
            dependency: 'wrapper',
          });
          return true;
        },
      );
      const path =
        '/node_modules/wrapper/node_modules/legacy-materials/package.json';
      assert.equal(
        await compiler.canRestoreDependencies(
          {metadata: [[path, (await files.stat(path))!]]},
          {files: []},
          '/model.ts',
        ),
        false,
        'cached unchanged transitive packages cannot bypass the version check',
      );
    } finally {
      await compiler.dispose();
    }
  });
}

test('a reached hoisted modeling package without a direct declaration requires an explicit dependency', async () => {
  const current = JSON.parse(
    new TextDecoder().decode(await packageTestFiles.readFile(coreManifest)),
  );
  const entries = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': current.version}},
    '/model.ts': 'export {value} from "@code3d/materials";',
    '/node_modules/@code3d/materials/package.json': {
      name: '@code3d/materials',
      version: '0.0.0',
      type: 'module',
      main: './index.js',
    },
    '/node_modules/@code3d/materials/index.js': 'export const value = 1;',
  });
  const files: ProjectFileReader = {
    readFile: async path =>
      (await entries.readFile(path)) ?? packageTestFiles.readFile(path),
    stat: async path =>
      (await entries.stat(path)) ?? packageTestFiles.stat(path),
  };
  const compiler = new ProjectCompiler(files, packageTestFiles, esbuild);
  try {
    await assert.rejects(compiler.compile({files: []}, '/model.ts'), error => {
      assert.ok(error instanceof ModelDiagnosticError);
      const issue = error.diagnostic.packageCompatibility;
      assert.equal(issue?.packages[0].name, '@code3d/materials');
      assert.equal(issue?.packages[0].manifestPath, '/package.json');
      assert.deepEqual(issue?.packages[0].manual, {reason: 'undeclared'});
      return true;
    });
  } finally {
    await compiler.dispose();
  }
});

test('cache restoration rejects incompatible or changed installations and respects current manifest overlays', async () => {
  const files = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': '1.0.0'}},
    [coreManifest]: {name: '@code3d/core', version: '1.0.0'},
  });
  const builtins = builtinFiles();
  const compiler = new ProjectCompiler(files, builtins, esbuild);
  const old = {
    metadata: [[coreManifest, (await files.stat(coreManifest))!]] as const,
  };
  try {
    assert.equal(
      await compiler.canRestoreDependencies(old, {files: []}, '/model.ts'),
      false,
      'unchanged metadata must not revive an incompatible package',
    );
    files.contents.set(
      coreManifest,
      JSON.stringify({name: '@code3d/core', version: '2.0.0'}),
    );
    assert.equal(
      await compiler.canRestoreDependencies(old, {files: []}, '/model.ts'),
      false,
      'a repaired installation must not execute the old package artifact',
    );
    const current = {
      metadata: [[coreManifest, (await files.stat(coreManifest))!]] as const,
    };
    assert.equal(
      await compiler.canRestoreDependencies(current, {files: []}, '/model.ts'),
      true,
    );
    files.contents.set(
      coreManifest,
      JSON.stringify({name: '@code3d/core', version: '1.0.0'}),
    );
    assert.equal(
      await compiler.canRestoreDependencies(
        current,
        {files: [{path: '/package.json', source: '{}'}]},
        '/model.ts',
      ),
      true,
      'unsaved removal of core selects the compatible builtin artifact',
    );
  } finally {
    await compiler.dispose();
  }
});
