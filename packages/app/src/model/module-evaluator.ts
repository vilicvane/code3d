export type ModuleExports = Record<string, any>;
export type NativeModuleLoader = (source: string) => Promise<ModuleExports>;
type ExecuteModule = (
  context: Readonly<Record<string, unknown>>,
) => Promise<ModuleExports>;

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
 * Loads executable scopes prepared by the compiler. Each invocation keeps
 * per-run model objects out of the browser's permanent module exports.
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
    source: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<ModuleExports> {
    const bytes = new TextEncoder().encode(source);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const key = Array.from(new Uint8Array(digest), value =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    let execute = this.compiled.get(key);
    if (!execute) {
      execute = (await this.loadModule(source)).default as ExecuteModule;
      this.compiled.set(key, execute);
      this.retainedSourceBytes += bytes.byteLength;
    }
    return execute(context);
  }

  dispose(): void {
    this.compiled.clear();
    // Native module records belong to the project Worker. Only terminating
    // that Worker releases its complete module cache.
  }
}
