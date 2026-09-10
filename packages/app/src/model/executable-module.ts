import ts from '@typescript/typescript6';

/** Compile a closed bundle into a fresh per-evaluation scope. */
export function executableModuleSource(
  label: string,
  source: string,
  contextNames: readonly string[],
): string {
  const parsed = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const imports: string[] = [];
  const body: string[] = [];
  const exports: string[] = [];
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(statement.getFullText(parsed));
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (statement.moduleSpecifier || !clause || !ts.isNamedExports(clause))
        throw new Error('Expected a bundled local export list.');
      for (const element of clause.elements) {
        exports.push(
          'get [' +
            JSON.stringify(element.name.text) +
            ']() { return ' +
            (element.propertyName ?? element.name).text +
            '; }',
        );
      }
    } else {
      body.push(statement.getFullText(parsed));
    }
  }
  const code =
    imports.join('\n') +
    '\nexport default async function({' +
    contextNames.join(',') +
    '}) {\n' +
    body.join('\n') +
    '\nreturn {' +
    exports.join(',') +
    '};\n}';

  return code;
}
