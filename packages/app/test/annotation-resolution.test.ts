import ts from '@typescript/typescript6';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defined} from '../../../test/assert.ts';
import {createAppTestServer} from './vite-test-server.ts';
import {
  annotationReference,
  declarationAnnotations,
  signatureAnnotationDeclaration,
  type Code3dAnnotationName,
} from '../src/model/annotations.ts';

function programFor(files: Record<string, string>) {
  const options: ts.CompilerOptions = {
    noLib: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = path => files[path] !== undefined;
  host.directoryExists = path =>
    Object.keys(files).some(file =>
      file.startsWith(path.replace(/\/$/, '') + '/'),
    );
  host.readFile = path => files[path];
  host.getSourceFile = path =>
    files[path] === undefined
      ? undefined
      : ts.createSourceFile(path, files[path], ts.ScriptTarget.Latest, true);
  const program = ts.createProgram(Object.keys(files), options, host);
  const checker = program.getTypeChecker();
  const calls = new Map<string, ts.CallExpression>();
  const file = defined(program.getSourceFile('/model.ts'));
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.set(node.getText(file), node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return {
    program,
    checker,
    owner(
      callText: string,
      names: readonly Code3dAnnotationName[] = ['inspect'],
    ) {
      const call = defined(calls.get(callText));
      const signature = defined(checker.getResolvedSignature(call));
      return signatureAnnotationDeclaration(
        signature,
        call.expression,
        checker,
        names,
      );
    },
  };
}

test('inspect references keep their declaration scope through aliases and re-exports', () => {
  const {owner, checker} = programFor({
    '/definition.ts': `
      function helper() {}
      /** @code3d.inspect helper */
      export function original(helper: number) { return helper; }
    `,
    '/bridge.ts': `export {original as renamed} from './definition';`,
    '/model.ts': `import {renamed} from './bridge'; const alias = renamed; alias(1);`,
  });
  const declaration = defined(owner('alias(1)'));
  assert.equal(declaration.getSourceFile().fileName, '/definition.ts');
  const annotation = declarationAnnotations(declaration)[0];
  const reference = defined(
    annotationReference(annotation.value, declaration, checker),
  );
  assert.deepEqual(reference.path, ['helper']);
  assert.ok(
    ts.isFunctionDeclaration(defined(reference.root?.valueDeclaration)),
  );
});

test('instance inspectors resolve their package inside nested installation stores', async () => {
  const server = await createAppTestServer();
  try {
    const {resolveProjectInspection} = await server.ssrLoadModule<
      typeof import('../src/model/inspect-schema.ts')
    >('/src/model/inspect-schema.ts');
    for (const packageName of ['inspection-library', '@code3d/core']) {
      for (const prefix of ['', '/.code3d/store/package/node_modules']) {
        const path = `/node_modules${prefix}/${packageName}/index.d.ts`;
        const source = `import {Part} from '${path}';
        const part = new Part(); part.build(1);`;
        const {program} = programFor({
          [path]: `export declare class Part {
          /** @code3d.inspect inspectBuild */
          build(width: number): number;
        }`,
          '/model.ts': source,
        });
        const index = resolveProjectInspection(
          {files: [{path: '/model.ts', source}]},
          program,
        );
        const signatures = [...defined(index.calls.get('/model.ts')).values()];
        const signature = defined(signatures[0]);
        assert.equal(signature.diagnostic, undefined);
        const binding = defined(signature.annotations[0]).binding;
        assert.equal(binding.kind, 'module');
        if (binding.kind === 'module')
          assert.equal(binding.module, packageName);
      }
    }
  } finally {
    await server.close();
  }
});

test('resolves hidden namespace members without requiring their stripped declarations', () => {
  const {owner, checker} = programFor({
    '/library.d.ts': `/** @code3d.inspect part.inspect */
      export declare function part(value: number): number;`,
    '/model.ts': `import {part as renamed} from './library'; renamed(1);`,
  });
  const declaration = defined(owner('renamed(1)'));
  const reference = defined(
    annotationReference('part.inspect', declaration, checker),
  );
  assert.equal(reference.root?.valueDeclaration, declaration);
  assert.deepEqual(reference.path, ['part', 'inspect']);
  const hiddenExport = defined(
    annotationReference('inspectPart', declaration, checker),
  );
  assert.equal(hiddenExport.root, undefined);
  assert.deepEqual(hiddenExport.path, ['inspectPart']);
});

test('keeps inspect and tool metadata on their resolved overload', () => {
  const {owner} = programFor({
    '/model.ts': `
      /** @code3d.inspect inspectNumber */
      function part(value: number): number;
      /** @code3d.param value {kind: 'scalar'} */
      function part(value: string): string;
      function part(value: string | number) { return value; }
      part(1); part('text');
    `,
  });
  assert.ok(owner('part(1)'));
  assert.equal(owner("part('text')"), undefined);
  assert.ok(owner("part('text')", ['param']));
  assert.equal(owner('part(1)', ['param']), undefined);
});

test('finds const callable annotations while keeping factory and wrapper scopes separate', () => {
  const {owner} = programFor({
    '/model.ts': `
      /** @code3d.inspect inspectPart */
      const part = (value: number) => value;
      const alias = part;
      /** @code3d.inspect inspectFactory */
      function factory() { return (value: number) => value; }
      const made = factory();
      const wrapper = (value: number) => part(value);
      alias(1); made(1); wrapper(1);
    `,
  });
  assert.ok(ts.isVariableDeclaration(defined(owner('alias(1)'))));
  assert.equal(owner('made(1)'), undefined);
  assert.equal(owner('wrapper(1)'), undefined);
  assert.ok(owner('factory()'));
});

test('callback references are symbolic paths and never executable expressions', () => {
  const {owner, checker} = programFor({
    '/model.ts': `
      namespace 检查 { export function 结果() {} }
      /** @code3d.inspect 检查.结果 */
      function part() {}
      part();
    `,
  });
  const declaration = defined(owner('part()'));
  assert.ok(annotationReference('检查.结果', declaration, checker)?.root);
  for (const value of [
    '',
    'helper()',
    'helper["inspect"]',
    'a..b',
    'a; b',
    '(() => {})',
    'a+b',
  ]) {
    assert.equal(
      annotationReference(value, declaration, checker),
      undefined,
      value,
    );
  }
});
