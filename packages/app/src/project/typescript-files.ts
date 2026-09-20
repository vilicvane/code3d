import ts from '@typescript/typescript6';
import es5Library from '@typescript/old/lib/lib.es5.d.ts?raw';
import {
  decodeProjectFile,
  statProjectFiles,
  type ProjectFileReader,
} from './file-reader';
import {normalizeProjectPath} from './project';

/** A synchronous TypeScript host discovers paths; its owner loads them between passes. */
export class TypeScriptFiles {
  readonly sources = new Map<string, string | undefined>();
  readonly realPaths = new Map<string, string>();
  private readonly presence = new Map<string, boolean>();
  private readonly parsed = new Map<string, ts.SourceFile>();
  private readonly pending = new Set<string>();
  private readonly pendingPresence = new Set<string>();

  constructor(private readonly reader: ProjectFileReader) {
    this.set('/lib.es5.d.ts', es5Library);
  }

  set(path: string, source: string | undefined): void {
    if (this.sources.get(path) !== source) this.parsed.delete(path);
    this.sources.set(path, source);
  }

  invalidate(changed: ReadonlySet<string>): boolean {
    const paths = new Set(changed);
    for (const [path, realPath] of this.realPaths) {
      if (changed.has(path) || changed.has(realPath)) {
        paths.add(path);
        paths.add(realPath);
        this.realPaths.delete(path);
      }
    }
    let invalidated = false;
    for (const path of paths) {
      if (!this.sources.has(path) && !this.presence.has(path)) continue;
      invalidated = true;
      this.sources.delete(path);
      this.presence.delete(path);
      this.parsed.delete(path);
      if (path.endsWith('.json')) this.parsed.clear();
    }
    return invalidated;
  }

  readonly read = (path: string): string | undefined => {
    path = normalizeProjectPath(path);
    if (!this.sources.has(path)) this.pending.add(path);
    return this.sources.get(path);
  };

  readonly host: ts.CompilerHost = {
    fileExists: path => {
      path = normalizeProjectPath(path);
      if (this.sources.has(path)) return this.sources.get(path) !== undefined;
      const present = this.presence.get(path);
      if (present !== undefined) return present;
      this.pendingPresence.add(path);
      return false;
    },
    realpath: path => this.realPaths.get(path) ?? path,
    readFile: this.read,
    directoryExists: () => true,
    getDirectories: () => [],
    getSourceFile: (path, options) => {
      const source = this.read(path);
      if (source === undefined) return undefined;
      let file = this.parsed.get(path);
      if (!file) {
        file = ts.createSourceFile(path, source, options, true);
        this.parsed.set(path, file);
      }
      return file;
    },
    getDefaultLibFileName: () => '/lib.es5.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: normalizeProjectPath,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };

  get needsRead(): boolean {
    return this.pending.size > 0 || this.pendingPresence.size > 0;
  }

  async readPending(): Promise<void> {
    const requests = [...this.pending];
    const presenceRequests = [...this.pendingPresence].filter(
      path => !this.pending.has(path),
    );
    this.pending.clear();
    this.pendingPresence.clear();
    await settleReads([
      statProjectFiles(this.reader, presenceRequests).then(infos => {
        for (const [index, path] of presenceRequests.entries())
          this.presence.set(path, infos[index]?.kind === 'file');
      }),
      ...requests.map(async path => {
        const [bytes, info] = await Promise.all([
          this.reader.readFile(path),
          this.reader.stat(path),
        ]);
        if (info?.realPath && bytes) {
          this.realPaths.set(path, info.realPath);
          this.set(info.realPath, decodeProjectFile(bytes));
        }
        this.set(
          path,
          bytes === undefined ? undefined : decodeProjectFile(bytes),
        );
        this.presence.set(path, bytes !== undefined);
      }),
    ]);
  }
}

export async function settleReads(
  reads: readonly Promise<unknown>[],
): Promise<void> {
  // Finish all cache writes before the owner retries or changes its revision.
  const results = await Promise.allSettled(reads);
  for (const result of results)
    if (result.status === 'rejected') throw result.reason;
}
