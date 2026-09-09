import type {ProjectLanguage} from '../src/project/project-language.ts';
import type {ModelProject} from '../src/project/project.ts';
import {defined} from '../../../test/assert.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as esbuild from 'esbuild';
import ts from '@typescript/typescript6';
import {createAppTestServer} from './vite-test-server.ts';
import {
  createTestEvaluator,
  testEvaluatorClass,
  importTestModule,
  packageTestFiles,
} from './project-test-files.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectPackages: (typeof import('../src/project/project-packages.ts'))['ProjectPackages'];
let ProjectPackageResolver: (typeof import('../src/project/package-resolver.ts'))['ProjectPackageResolver'];
let ProjectBuilder: (typeof import('../src/project/project-builder.ts'))['ProjectBuilder'];
let ProjectCompiler: (typeof import('../src/model/project-compiler.ts'))['ProjectCompiler'];
let ProjectLanguageLoader: (typeof import('../src/project/project-language.ts'))['ProjectLanguageLoader'];
let Evaluator: Awaited<ReturnType<typeof testEvaluatorClass>>;
before(async () => {
  server = await createAppTestServer();
  ({ProjectPackages} = await server.ssrLoadModule<
    typeof import('../src/project/project-packages.ts')
  >('/src/project/project-packages.ts'));
  ({ProjectPackageResolver} = await server.ssrLoadModule<
    typeof import('../src/project/package-resolver.ts')
  >('/src/project/package-resolver.ts'));
  ({ProjectBuilder} = await server.ssrLoadModule<
    typeof import('../src/project/project-builder.ts')
  >('/src/project/project-builder.ts'));
  ({ProjectCompiler} = await server.ssrLoadModule<
    typeof import('../src/model/project-compiler.ts')
  >('/src/model/project-compiler.ts'));
  ({ProjectLanguageLoader} = await server.ssrLoadModule<
    typeof import('../src/project/project-language.ts')
  >('/src/project/project-language.ts'));
  Evaluator = await testEvaluatorClass(server);
});
after(async () => server?.close());

function memoryFiles(
  entries: Record<string, unknown> = {},
): ProjectFileReader & {contents: Map<string, string>} {
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

const emptyProject = {files: []};
const unavailableBuiltins = {
  async readFile() {
    assert.fail('Project mode must not read built-in packages');
  },
  async stat() {
    assert.fail('Project mode must not inspect built-in packages');
  },
};

for (const field of [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const) {
  test(`${field} declaration selects project packages, even before installation`, async () => {
    const files = memoryFiles({
      '/package.json': {[field]: {'@code3d/core': '*'}},
    });
    const packages = new ProjectPackages(files, unavailableBuiltins);
    await packages.update(emptyProject);
    assert.equal(packages.source, 'project');
    assert.deepEqual(packages.packageSpecifiers, []);
    const resolver = new ProjectPackageResolver(packages);
    await assert.rejects(
      resolver.resolve('@code3d/core', '/model.ts'),
      /resolve/i,
    );
    await assert.rejects(
      resolver.resolve('@code3d/screws', '/model.ts'),
      /resolve/i,
    );
    assert.equal(
      new TextDecoder().decode(await packages.readFile('/package.json')),
      files.contents.get('/package.json'),
    );
  });
}

test('does not treat malformed project metadata as permission to use built-ins', async () => {
  const packages = new ProjectPackages(
    memoryFiles({'/package.json': '{broken'}),
    unavailableBuiltins,
  );
  await assert.rejects(packages.update(emptyProject), /Invalid \/package.json/);
});

test('isolates the built-in dependency closure and gives source, screws and reusable packages one core identity and type graph', async () => {
  const exports = {types: './index.d.ts', default: './index.js'};
  const builtins = memoryFiles({
    '/node_modules/@code3d/core/package.json': {
      name: '@code3d/core',
      type: 'module',
      exports: {'.': exports, './tooling': exports},
    },
    '/node_modules/@code3d/core/index.js':
      'import {origin} from "replicad"; export const core = {origin};',
    '/node_modules/@code3d/core/index.d.ts':
      'import {origin} from "replicad"; export declare const core: {origin: typeof origin};',
    '/node_modules/@code3d/screws/package.json': {
      name: '@code3d/screws',
      type: 'module',
      exports,
    },
    '/node_modules/@code3d/screws/index.js':
      'export {core as screwCore} from "@code3d/core";',
    '/node_modules/@code3d/screws/index.d.ts':
      'export {core as screwCore} from "@code3d/core";',
    '/node_modules/@code3d/materials/package.json': {
      name: '@code3d/materials',
      type: 'module',
      exports,
    },
    '/node_modules/@code3d/materials/index.js':
      'export {core as materialCore} from "@code3d/core";',
    '/node_modules/@code3d/materials/index.d.ts':
      'export {core as materialCore} from "@code3d/core";',
    '/node_modules/replicad/package.json': {
      name: 'replicad',
      type: 'module',
      exports,
    },
    '/node_modules/replicad/index.js': 'export const origin = "builtin";',
    '/node_modules/replicad/index.d.ts':
      'export declare const origin: "builtin";',
  });
  const files = memoryFiles({
    '/package.json': {
      dependencies: {'@code3d/screws': '*', replicad: '*', reusable: '*'},
    },
    '/node_modules/replicad/package.json': {
      name: 'replicad',
      type: 'module',
      exports,
    },
    '/node_modules/replicad/index.js': 'export const origin = "project";',
    '/node_modules/replicad/index.d.ts':
      'export declare const origin: "project";',
    '/node_modules/reusable/package.json': {
      name: 'reusable',
      type: 'module',
      exports,
    },
    '/node_modules/reusable/index.js':
      'export {core as reusableCore} from "@code3d/core";',
    '/node_modules/reusable/index.d.ts':
      'export {core as reusableCore} from "@code3d/core";',
    '/node_modules/reusable/node_modules/@code3d/core/package.json': {
      name: '@code3d/core',
      type: 'module',
      exports,
    },
    '/node_modules/reusable/node_modules/@code3d/core/index.js':
      'throw new Error("wrong core");',
    '/node_modules/reusable/node_modules/@code3d/core/index.d.ts':
      'export declare const core: "wrong core";',
    '/node_modules/@code3d/screws/package.json': {
      name: '@code3d/screws',
      type: 'module',
      exports,
    },
    '/node_modules/@code3d/screws/index.js': 'throw new Error("wrong screws");',
  });
  const originalFiles = new Map(files.contents);
  const project = {
    files: [
      {
        path: '/model.ts',
        source: [
          'import {core} from "@code3d/core";',
          'import {screwCore} from "@code3d/screws";',
          'import {materialCore} from "@code3d/materials";',
          'import {reusableCore} from "reusable";',
          'import {origin} from "replicad";',
          'const builtinOrigin: "builtin" = core.origin;',
          'const projectOrigin: "project" = origin;',
          'const reusableOrigin: "builtin" = reusableCore.origin;',
          'export {core, screwCore, materialCore, reusableCore, origin};',
        ].join('\n'),
      },
    ],
  };
  const packages = new ProjectPackages(files, builtins);
  await packages.update(project);
  const bundle = await new ProjectBuilder(packages, esbuild).build(
    'export * from "/model.ts";',
  );
  const result = await importTestModule(bundle.source);
  assert.equal(result.core, result.screwCore);
  assert.equal(result.core, result.materialCore);
  assert.equal(result.core, result.reusableCore);
  assert.equal(result.core.origin, 'builtin');
  assert.equal(result.origin, 'project');
  const language = await new ProjectLanguageLoader(packages).load(
    project,
    packages.packageSpecifiers,
  );
  assert.deepEqual(
    new Set(language.packageSpecifiers),
    new Set([
      '@code3d/core',
      '@code3d/screws',
      '@code3d/materials',
      'replicad',
      'reusable',
    ]),
  );
  assert.ok(
    language.files.some(
      file =>
        file.path === '/node_modules/@code3d/node_modules/replicad/index.d.ts',
    ),
  );
  assert.ok(
    !language.files.some(file =>
      file.path.includes('/reusable/node_modules/@code3d/core/'),
    ),
  );
  const sources = new Map(
    [...project.files, ...language.files].map(file => [file.path, file.source]),
  );
  const program = ts.createProgram({
    rootNames: ['/model.ts'],
    options: {...language.compilerOptions, noLib: true},
    host: {
      fileExists: path => sources.has(path),
      readFile: path => sources.get(path),
      getSourceFile: (path, target) =>
        sources.has(path)
          ? ts.createSourceFile(path, defined(sources.get(path)), target, true)
          : undefined,
      directoryExists: () => true,
      getDirectories: () => [],
      getDefaultLibFileName: () => '',
      getCurrentDirectory: () => '/',
      getCanonicalFileName: path => path,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      writeFile: () => {},
    },
  });
  assert.deepEqual(
    program
      .getSemanticDiagnostics(program.getSourceFile('/model.ts'))
      .map(diagnostic =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ),
    [],
  );
  assert.deepEqual(
    files.contents,
    originalFiles,
    'No packages or metadata are written to the project',
  );
});

for (const mode of ['builtin', 'project'] as const) {
  test(`shares core/three materials across packages in ${mode} mode without adopting package-local Three.js`, async () => {
    const exports = {types: './index.d.ts', default: './index.js'};
    const files = memoryFiles({
      '/package.json': {
        type: 'module',
        dependencies: {
          'material-library': '*',
          ...(mode === 'project' ? {'@code3d/core': '*'} : {}),
        },
      },
      '/node_modules/material-library/package.json': {
        name: 'material-library',
        type: 'module',
        exports,
        peerDependencies: {'@code3d/core': '*'},
      },
      '/node_modules/material-library/index.js': `import {MeshPhysicalMaterial} from '@code3d/core/three';
export const lacquer = new MeshPhysicalMaterial({color: '#ff8800', roughness: 0.25, clearcoat: 1});
export {MeshPhysicalMaterial as MaterialClass};`,
      '/node_modules/material-library/index.d.ts': `import {MeshPhysicalMaterial} from '@code3d/core/three';
export declare const lacquer: MeshPhysicalMaterial;
export {MeshPhysicalMaterial as MaterialClass};`,
      '/node_modules/material-library/node_modules/three/package.json': {
        name: 'three',
        type: 'module',
        exports,
      },
      '/node_modules/material-library/node_modules/three/index.js':
        'throw new Error("The material library must use Core-owned Three.js");',
      '/node_modules/material-library/node_modules/three/index.d.ts':
        'export declare const unrelated: unique symbol;',
      ...(mode === 'builtin'
        ? {
            '/node_modules/three/package.json': {
              name: 'three',
              type: 'module',
              exports,
            },
            '/node_modules/three/index.js': 'export const owner = "project";',
            '/node_modules/three/index.d.ts':
              'export declare const owner: "project";',
          }
        : {}),
    });
    const reader: ProjectFileReader = {
      readFile: async path =>
        (await files.readFile(path)) ??
        (mode === 'project' ? packageTestFiles.readFile(path) : undefined),
      stat: async path =>
        (await files.stat(path)) ??
        (mode === 'project' ? packageTestFiles.stat(path) : undefined),
    };
    const compiler = new ProjectCompiler(
      reader,
      packageTestFiles,
      esbuild,
      () => new Evaluator(),
    );
    let language: ProjectLanguage | undefined;
    try {
      const source = `import {box} from '@code3d/core';
import * as THREE from '@code3d/core/three';
import {lacquer, MaterialClass} from 'material-library';
${mode === 'builtin' ? 'import {owner} from "three"; if (owner !== "project") throw new Error("User Three.js was shadowed");' : ''}
if (THREE.MeshPhysicalMaterial !== MaterialClass) throw new Error('Different material class identities');
export default box(2, 3, 4).material(lacquer);`;
      const result = await compiler.compile(
        {files: [{path: '/model.ts', source}]},
        '/model.ts',
        undefined,
        value => {
          language = value;
        },
      );
      assert.equal(result.diagnostic, undefined);
      const material = defined(
        result.objects.get(defined(result.exports.get('default'))),
      ).material;
      assert.ok(material && typeof material !== 'string');
      assert.equal(material.type, 'MeshPhysicalMaterial');
      assert.equal(material.color, 0xff8800);
      assert.equal(material.clearcoat, 1);
      const modules = [...defined(compiler['runtime']).modules.keys()];
      assert.ok(
        !modules.some(path =>
          path.includes('/material-library/node_modules/three/'),
        ),
      );
      const languageFiles = defined(language).files;
      assert.ok(
        languageFiles.some(
          file => file.path === '/node_modules/material-library/index.d.ts',
        ),
      );
      assert.ok(
        languageFiles.some(
          file =>
            file.path === '/node_modules/@code3d/core/bld/library/three.d.ts',
        ),
      );
      assert.ok(
        languageFiles.some(file =>
          file.path.endsWith(
            '/@types/three/src/materials/MeshPhysicalMaterial.d.ts',
          ),
        ),
      );
    } finally {
      compiler.dispose();
    }
  });
}

test('runs a zero-install screw model, retains its runtime on edits, and switches packages after a manifest edit', async () => {
  const files = memoryFiles();
  let installed = false;
  const projectFiles = {
    readFile: async (path: string) =>
      (await files.readFile(path)) ??
      (installed ? packageTestFiles.readFile(path) : undefined),
    stat: async (path: string) =>
      (await files.stat(path)) ??
      (installed ? packageTestFiles.stat(path) : undefined),
  };
  const compiler = new ProjectCompiler(
    projectFiles,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
  const project = (radius: number) => ({
    files: [
      {
        path: '/model.ts',
        source: [
          'import {box, group} from "@code3d/core";',
          'import {ISO4762} from "@code3d/screws";',
          'import {paint} from "@code3d/materials";',
          'import {MeshPhysicalMaterial, type Material} from "@code3d/core/three";',
          'const material: Material = paint({color: "#ff8800", clearcoat: 1});',
          `const plate = box(40, 10, 30).fillet(${radius}).material(material);`,
          'const screw = ISO4762.screw("M6", 18).relate(part => part.center.on(plate.up).offset(30, 0, 0));',
          'export default group([plate, screw]);',
        ].join('\n'),
      },
    ],
  });
  let language: ProjectLanguage | undefined;
  const compile = (model: ModelProject) =>
    compiler.compile(model, '/model.ts', undefined, value => {
      language = value;
    });
  try {
    const first = await compile(project(1));
    assert.equal(first.diagnostic, undefined);
    const builtinRuntime = compiler['runtime'];
    assert.ok(
      [...defined(builtinRuntime).modules.keys()].some(path =>
        path.startsWith('/node_modules/@code3d/node_modules/replicad/'),
      ),
    );
    assert.ok(
      defined(language).files.some(
        file =>
          file.path === '/node_modules/@code3d/screws/bld/library/index.d.ts',
      ),
    );
    assert.ok(
      defined(language).files.some(
        file =>
          file.path ===
          '/node_modules/@code3d/materials/bld/library/index.d.ts',
      ),
    );
    assert.ok(
      defined(language).files.some(file =>
        file.path.endsWith(
          '/@types/three/src/materials/MeshPhysicalMaterial.d.ts',
        ),
      ),
    );
    assert.ok(
      defined(language).files.some(file =>
        file.path.includes('/@types/webxr/'),
      ),
    );
    assert.ok(
      defined(language).files.every(
        file => !file.path.startsWith('/node_modules/three/'),
      ),
    );
    assert.equal((await compile(project(1.1))).diagnostic, undefined);
    assert.equal(compiler['runtime'], builtinRuntime);
    assert.equal(files.contents.size, 0);

    files.contents.set(
      '/package.json',
      '{"type":"module","dependencies":{"@code3d/core":"*","@code3d/screws":"*","@code3d/materials":"*"}}',
    );
    await assert.rejects(compile(project(1.1)), /@code3d\/core/);
    assert.equal(compiler['runtime'], undefined);
    assert.ok(
      !defined(language).files.some(file =>
        file.path.includes('/node_modules/@code3d/core/'),
      ),
    );

    installed = true;
    assert.equal((await compile(project(1.1))).diagnostic, undefined);
    const runtime = () => compiler['runtime'];
    const projectRuntime = runtime();
    assert.notEqual(projectRuntime, builtinRuntime);
    assert.ok(
      [...defined(projectRuntime).modules.keys()].some(path =>
        path.startsWith('/node_modules/replicad/'),
      ),
    );
    assert.ok(
      ![...defined(projectRuntime).modules.keys()].some(path =>
        path.includes('/@code3d/node_modules/'),
      ),
    );

    const unsaved = project(1.2);
    unsaved.files.push({path: '/package.json', source: '{"type":"module"}'});
    assert.equal((await compile(unsaved)).diagnostic, undefined);
    assert.notEqual(compiler['runtime'], projectRuntime);
    assert.ok(
      [...defined(runtime()).modules.keys()].some(path =>
        path.startsWith('/node_modules/@code3d/node_modules/replicad/'),
      ),
    );
    assert.equal(files.contents.size, 1);
  } finally {
    compiler.dispose();
  }
});
