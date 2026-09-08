import assert from 'node:assert/strict';
import {test} from 'node:test';
import ts from '@typescript/typescript6';
import {cursorTypeInfo} from '../src/monaco/type-info.ts';

test('selected calls expose result types while identifiers expose callable signatures', () => {
  const file = '/model.ts';
  const source =
    'function make<T>(value: T): {value: T; label?: string} { return {value}; }\nconst item = make(42);\n// no model execution is needed';
  const service = ts.createLanguageService({
    getScriptFileNames: () => [file],
    getScriptVersion: () => '1',
    getScriptSnapshot: path =>
      path === file ? ts.ScriptSnapshot.fromString(source) : undefined,
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => ({strict: true}),
    getDefaultLibFileName: () => '',
    fileExists: path => path === file,
    readFile: path => (path === file ? source : undefined),
  });
  try {
    const start = source.indexOf('make(42)');
    const result = cursorTypeInfo(service, file, start - 1, start + 8)!;
    assert.equal(result.syntax, 'CallExpression');
    assert.match(result.type, /value: number/);
    assert.deepEqual(result.members, [
      {name: 'value', type: 'number', optional: false},
      {name: 'label', type: 'string | undefined', optional: true},
    ]);
    const callable = cursorTypeInfo(service, file, start, start + 4)!;
    assert.match(callable.signatures[0], /<T>\(value: T\)/);
    assert.equal(
      cursorTypeInfo(service, file, source.indexOf('//') + 5, source.length),
      undefined,
    );
  } finally {
    service.dispose();
  }
});
