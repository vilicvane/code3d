import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ModelDiagnostic} from '../src/model/diagnostic.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import type {PackageManifest} from '../src/project/package-manifest.ts';
import type {PackageCompatibilityIssue} from '../src/project/package-compatibility.ts';
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

async function checkCompatibility(
  files: ProjectFileReader,
  builtinFiles: ProjectFileReader,
  rootPath: string,
) {
  const check = await compatibility.PackageCompatibilityCheck.create(
    files,
    builtinFiles,
  );
  await check.checkDeclared(rootPath);
  return check.issue;
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
    const issue = await checkCompatibility(packages, builtins, '/model.ts');
    if (installed === versions['@code3d/core']) {
      assert.equal(issue, undefined);
    } else {
      assert.deepEqual(issue, {
        directory: '/',
        packages: [
          {
            name: '@code3d/core',
            specifier: '@code3d/core',
            packagePath: '/node_modules/@code3d/core',
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
  const issue = await checkCompatibility(
    packages,
    builtins,
    '/panel/src/model.ts',
  );
  assert.deepEqual(issue?.packages, [
    {
      name: '@code3d/materials',
      specifier: 'surface',
      packagePath: '/panel/node_modules/surface',
      installed: '1.0.0',
      expected: '3.0.0',
      manifestPath: '/panel/package.json',
    },
    {
      name: '@code3d/core',
      specifier: '@code3d/core',
      packagePath: '/node_modules/@code3d/core',
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
    await checkCompatibility(packages, builtins, '/panel/src/model.ts'),
    undefined,
  );
});

for (const [specifier, name] of [
  ['@code3d/core', '@code3d/core'],
  ['surface', '@code3d/materials'],
]) {
  test(`a symlinked ${specifier} installation keeps its direct declaration after module resolution`, async () => {
    const builtins = builtinFiles();
    const declaredPath = '/node_modules/' + specifier;
    const packagePath = '/.code3d/fixture/node_modules/' + name;
    const entries = memoryFiles({
      '/package.json': {
        dependencies: {
          [specifier]: specifier === name ? 'latest' : `npm:${name}@latest`,
          wrapper: '1.0.0',
        },
      },
      [packagePath + '/package.json']: {name, version: '1.0.0'},
      [packagePath + '/index.js']: 'export const value = 1;',
      '/node_modules/wrapper/package.json': {name: 'wrapper', version: '1.0.0'},
      '/node_modules/wrapper/index.js': `export {value} from '${specifier}';`,
    });
    const dereference = (path: string) =>
      path === declaredPath || path.startsWith(declaredPath + '/')
        ? packagePath + path.slice(declaredPath.length)
        : path;
    const files: ProjectFileReader = {
      readFile: path => entries.readFile(dereference(path)),
      async stat(path) {
        const realPath = dereference(path);
        const info = await entries.stat(realPath);
        return info && {...info, realPath};
      },
    };
    const check = await compatibility.PackageCompatibilityCheck.create(
      files,
      builtins,
    );
    await check.checkDeclared('/model.ts');
    const declared = check.issue;
    assert.ok(declared);
    assert.equal(declared.packages.length, 1);
    assert.equal(declared.packages[0].packagePath, packagePath);
    assert.equal(declared.packages[0].specifier, specifier);
    for (const importer of ['/model.ts', '/node_modules/wrapper/index.js']) {
      await check.checkResolved(packagePath + '/index.js', importer);
      const resolved: PackageCompatibilityIssue | undefined = check.issue;
      assert.deepEqual(
        resolved,
        declared,
        'resolving a physical path must preserve the single directly upgradable package',
      );
      assert.equal(resolved?.packages[0].manual, undefined);
    }
  });
}

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
    await checkCompatibility(packages, builtins, '/model.ts'),
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
    await checkCompatibility(packages, builtins, '/model.ts'),
    undefined,
  );
  files.contents.set(
    '/package.json',
    JSON.stringify({dependencies: {'@code3d/core': '1.0.0'}}),
  );
  await packages.update({files: []});
  assert.equal(
    (await checkCompatibility(packages, builtins, '/model.ts'))?.packages[0]
      .installed,
    '1.0.0',
  );
});

test('missing installations keep their module error while an installed package without version is identified', async () => {
  const builtins = builtinFiles();
  const files = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': 'latest'}},
  });
  assert.equal(
    await checkCompatibility(files, builtins, '/model.ts'),
    undefined,
  );
  files.contents.set(coreManifest, '{}');
  assert.equal(
    (await checkCompatibility(files, builtins, '/model.ts'))?.packages[0]
      .installed,
    'unknown',
  );
});

test('one compilation shares manifest and version reads across declared and resolved package checks', async () => {
  const files = memoryFiles({
    '/package.json': {
      dependencies: {'@code3d/core': 'latest', '@code3d/materials': 'latest'},
    },
    [coreManifest]: {name: '@code3d/core', version: '1.0.0'},
    '/node_modules/@code3d/materials/package.json': {
      name: '@code3d/materials',
      version: '1.0.0',
    },
    '/node_modules/wrapper/package.json': {name: 'wrapper', version: '1.0.0'},
  });
  const tracked = (reader: ProjectFileReader) => {
    const reads = new Map<string, number>();
    return {
      reads,
      files: {
        ...reader,
        readFile(path: string) {
          reads.set(path, (reads.get(path) ?? 0) + 1);
          return reader.readFile(path);
        },
      },
    };
  };
  const source = tracked(files);
  const builtins = tracked(builtinFiles());
  const check = await compatibility.PackageCompatibilityCheck.create(
    source.files,
    builtins.files,
  );
  await check.checkDeclared('/model.ts');
  await Promise.all([
    check.checkResolved('/node_modules/@code3d/core/index.js', '/model.ts'),
    check.checkResolved('/node_modules/@code3d/core/tooling.js', '/other.ts'),
    check.checkResolved(
      '/node_modules/@code3d/core/index.js',
      '/parts/model.ts',
    ),
    check.checkResolved(
      '/node_modules/@code3d/materials/index.js',
      '/node_modules/wrapper/index.js',
    ),
  ]);
  assert.equal(check.issue?.packages.length, 2);
  assert.ok(check.issue?.packages.every(pkg => !pkg.manual));
  assert.equal(source.reads.get('/package.json'), 1);
  assert.equal(source.reads.get(coreManifest), 1);
  assert.ok([...builtins.reads.values()].every(count => count === 1));

  files.contents.set(
    coreManifest,
    JSON.stringify({name: '@code3d/core', version: versions['@code3d/core']}),
  );
  const next = await checkCompatibility(
    source.files,
    builtins.files,
    '/model.ts',
  );
  assert.deepEqual(
    next?.packages.map(pkg => pkg.name),
    ['@code3d/materials'],
    'the next compilation reads the updated installation',
  );
});

test('cancelled package reads cannot publish issues into a later compilation', async () => {
  const files = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': 'latest'}},
    [coreManifest]: {name: '@code3d/core', version: '1.0.0'},
  });
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => {
    start = resolve;
  });
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  const delayed: ProjectFileReader = {
    ...files,
    async readFile(path) {
      const bytes = await files.readFile(path);
      if (path === coreManifest) {
        start();
        await released;
      }
      return bytes;
    },
  };
  let cancelled = false;
  const old = await compatibility.PackageCompatibilityCheck.create(
    delayed,
    builtinFiles(),
    () => {
      if (cancelled) throw new Error('Compilation superseded.');
    },
  );
  const pending = old.checkDeclared('/model.ts');
  await started;
  cancelled = true;
  files.contents.set(
    coreManifest,
    JSON.stringify({name: '@code3d/core', version: versions['@code3d/core']}),
  );
  assert.equal(
    await checkCompatibility(files, builtinFiles(), '/model.ts'),
    undefined,
  );
  release();
  await assert.rejects(pending, /Compilation superseded/);
  assert.equal(
    old.issue,
    undefined,
    'an old asynchronous check must not publish its stale result',
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

test('version warnings allow real package compilation and preserve genuine compilation errors', async () => {
  const current = JSON.parse(
    new TextDecoder().decode(await packageTestFiles.readFile(coreManifest)),
  );
  const entries = memoryFiles({
    '/package.json': {dependencies: {'@code3d/core': 'latest', wrapper: '1'}},
    '/node_modules/wrapper/package.json': {
      name: 'wrapper',
      version: '1',
      type: 'module',
      main: './index.js',
    },
    '/node_modules/wrapper/index.js': 'export {box} from "@code3d/core";',
    [coreManifest]: {...current, version: '0.0.0'},
    '/model.ts':
      'import {box} from "@code3d/core"; import {box as otherBox} from "wrapper"; export default box(1, 2, 3); export const another = otherBox(2, 3, 4);',
  });
  const files: ProjectFileReader = {
    readFile: async path =>
      (await entries.readFile(path)) ?? packageTestFiles.readFile(path),
    stat: async path =>
      (await entries.stat(path)) ?? packageTestFiles.stat(path),
  };
  const compiler = new ProjectCompiler(files, packageTestFiles, esbuild);
  let warnings: readonly ModelDiagnostic[] = [];
  const compile = () =>
    compiler.compile(
      {files: []},
      '/model.ts',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      value => {
        warnings = value;
      },
    );
  try {
    const original = await compile();
    assert.ok(original.model);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].severity, 'warning');
    assert.equal(warnings[0].sourceRef?.file, '/model.ts');
    assert.equal(
      warnings[0].packageCompatibility?.packages[0].installed,
      '0.0.0',
    );
    assert.equal(
      warnings[0].packageCompatibility?.packages.length,
      1,
      'direct and transitive imports share one installation warning',
    );
    assert.equal(
      warnings[0].packageCompatibility?.packages[0].manual,
      undefined,
      'a directly declared package keeps its upgrade action',
    );
    entries.contents.set(
      '/model.ts',
      'import {box} from "@code3d/core"; export default box(7, 2, 3);',
    );
    const edited = await compile();
    assert.notEqual(
      edited.id,
      original.id,
      'warnings must not freeze subsequent edits',
    );
    assert.equal(warnings[0].severity, 'warning');
    entries.contents.set(
      '/model.ts',
      'import {value} from "./missing-compatibility-fixture.js"; export default value;',
    );
    await assert.rejects(compile(), error => {
      assert.ok(error instanceof ModelDiagnosticError);
      assert.notEqual(
        error.diagnostic.summary,
        'Code3D package version mismatch',
      );
      assert.equal(error.diagnostic.packageCompatibility, undefined);
      assert.match(error.message, /missing-compatibility-fixture/);
      return true;
    });
    assert.equal(
      warnings[0].severity,
      'warning',
      'real failures retain the separate actionable warning',
    );
    entries.contents.set(coreManifest, JSON.stringify(current));
    entries.contents.set('/model.ts', 'export const value = 1;');
    await compile();
    assert.deepEqual(
      warnings,
      [],
      'the next resolved installation clears the warning',
    );
  } finally {
    await compiler.dispose();
  }
});

test('an alias-only installed Core warns without preventing the builtin runtime from compiling', async () => {
  const entries = memoryFiles({
    '/package.json': {dependencies: {'legacy-core': 'npm:@code3d/core@1.0.0'}},
    '/node_modules/legacy-core/package.json': {
      name: '@code3d/core',
      version: '1.0.0',
    },
    '/model.ts':
      'import {box} from "@code3d/core"; export default box(1, 2, 3);',
  });
  const compiler = new ProjectCompiler(entries, packageTestFiles, esbuild);
  let warnings: readonly ModelDiagnostic[] = [];
  try {
    await compiler.compile(
      {files: []},
      '/model.ts',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      value => {
        warnings = value;
      },
    );
    assert.equal(warnings[0].severity, 'warning');
    assert.equal(
      warnings[0].packageCompatibility?.packages[0].name,
      '@code3d/core',
    );
    assert.equal(
      warnings[0].packageCompatibility?.packages[0].manifestPath,
      '/package.json',
    );
    assert.equal(
      await compiler.canRestoreDependencies(
        {metadata: []},
        {files: []},
        '/model.ts',
      ),
      true,
    );
  } finally {
    await compiler.dispose();
  }
});

for (const dynamic of [false, true]) {
  test(`a reached ${dynamic ? 'dynamic' : 'static'} transitive package retains its dependency owner in a nonblocking warning`, async () => {
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
      let warnings: readonly ModelDiagnostic[] = [];
      const original = await compiler.compile(
        {files: []},
        '/model.ts',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        value => {
          warnings = value;
        },
      );
      const issue = warnings[0].packageCompatibility;
      assert.equal(warnings[0].severity, 'warning');
      assert.equal(issue?.packages[0].name, '@code3d/materials');
      assert.equal(issue?.packages[0].installed, '0.0.0');
      assert.equal(issue?.packages[0].manifestPath, '/package.json');
      assert.deepEqual(issue?.packages[0].manual, {
        reason: 'transitive',
        dependency: 'wrapper',
      });
      await compiler.compile(
        {files: []},
        '/model.ts',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        value => {
          warnings = value;
        },
      );
      assert.deepEqual(
        warnings[0].packageCompatibility,
        issue,
        'warm dependency reuse retains reached transitive warnings',
      );
      const restored = new ProjectCompiler(files, packageTestFiles, esbuild);
      try {
        await restored.compile(
          {files: []},
          '/model.ts',
          undefined,
          undefined,
          undefined,
          undefined,
          async () => original.dependencies,
          value => {
            warnings = value;
          },
        );
        assert.deepEqual(
          warnings[0].packageCompatibility,
          issue,
          'a fresh compiler adopting saved dependencies rechecks reached packages',
        );
      } finally {
        await restored.dispose();
      }
      const path =
        '/node_modules/wrapper/node_modules/legacy-materials/package.json';
      assert.equal(
        await compiler.canRestoreDependencies(
          {metadata: [[path, (await files.stat(path))!]]},
          {files: []},
          '/model.ts',
        ),
        true,
        'an unchanged transitive package warning must not block cache restoration',
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
    let warnings: readonly ModelDiagnostic[] = [];
    await compiler.compile(
      {files: []},
      '/model.ts',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      value => {
        warnings = value;
      },
    );
    const issue = warnings[0].packageCompatibility;
    assert.equal(warnings[0].severity, 'warning');
    assert.equal(issue?.packages[0].name, '@code3d/materials');
    assert.equal(issue?.packages[0].manifestPath, '/package.json');
    assert.deepEqual(issue?.packages[0].manual, {reason: 'undeclared'});
  } finally {
    await compiler.dispose();
  }
});

test('cache restoration permits version differences but rejects changed installations and respects current manifest overlays', async () => {
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
      true,
      'an unchanged installation remains restorable despite its version warning',
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
