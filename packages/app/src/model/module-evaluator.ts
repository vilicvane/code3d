import ts from '@typescript/typescript6';

export type ModuleExports = Record<string, any>;
export type NativeModuleLoader = (source: string) => Promise<ModuleExports>;
type ExecuteModule = (...context: unknown[]) => Promise<ModuleExports>;

async function importNativeModule(source: string): Promise<ModuleExports> {
  const url = URL.createObjectURL(
    new Blob([source], {type: 'text/javascript'}),
  );
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    // Revocation releases the Blob mapping, not the browser's module record.
    URL.revokeObjectURL(url);
  }
}

/**
 * Native ESM owns linking and execution. A generated execution scope keeps
 * per-run model objects out of the browser's permanent module exports.
 * This accepts closed esbuild bundles, not arbitrary unbundled author modules.
 */
export class ModuleEvaluator {
  private readonly compiled = new Map<string, ExecuteModule>();
  private retainedSourceBytes = 0;

  constructor(
    private readonly loadModule: NativeModuleLoader = importNativeModule,
  ) {}

  get compiledBytes(): number {
    return this.retainedSourceBytes;
  }

  async evaluate(
    label: string,
    source: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<ModuleExports> {
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
      '\nexport default async function(' +
      Object.keys(context).join(',') +
      ') {\n' +
      body.join('\n') +
      '\nreturn {' +
      exports.join(',') +
      '};\n}';
    const bytes = new TextEncoder().encode(code);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const key = Array.from(new Uint8Array(digest), value =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    let execute = this.compiled.get(key);
    if (!execute) {
      execute = (await this.loadModule(code)).default as ExecuteModule;
      this.compiled.set(key, execute);
      this.retainedSourceBytes += bytes.byteLength;
    }
    return execute(...Object.values(context));
  }

  dispose(): void {
    this.compiled.clear();
    // Native module records belong to the project Worker. Only terminating
    // that Worker releases its complete module cache.
  }
}
