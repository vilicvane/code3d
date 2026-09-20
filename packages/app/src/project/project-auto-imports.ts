import ts from '@typescript/typescript6';
import {ProjectFileCache} from './file-cache';
import type {ProjectFileReader} from './file-reader';
import {patchModelPackages} from './model-package-patches';
import {
  normalizeProjectPath,
  projectDirectory,
  type ModelProject,
  type ProjectSourceFile,
} from './project';
import type {ProjectLanguage} from './project-language';
import {ProjectPackages} from './project-packages';
import {TypeScriptFiles} from './typescript-files';

export type ProjectAutoImports = Readonly<{
  root: ProjectSourceFile;
  files: readonly ProjectSourceFile[];
  realPaths: Readonly<Record<string, string>>;
  /** Optional discovery failures never become model compilation errors. */
  failures: readonly Readonly<{path: string; message: string}>[];
}>;

/** Optional export discovery owns its caches, independently of mandatory model reads. */
export class ProjectAutoImportLoader {
  private readonly projectFiles: ProjectFileCache;
  private readonly builtinFiles: ProjectFileCache;
  private readonly packages: ProjectPackages;
  private files: TypeScriptFiles;
  private program?: ts.Program;
  private readonly failures = new Map<string, string>();
  private pending: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private resetRequested = false;

  constructor(
    projectFiles: ProjectFileReader,
    builtinFiles: ProjectFileReader,
  ) {
    const optional = (reader: ProjectFileReader): ProjectFileReader => {
      const read = async <T>(
        path: string,
        request: () => Promise<T>,
      ): Promise<T | undefined> => {
        try {
          return await request();
        } catch (error) {
          this.failures.set(
            path,
            error instanceof Error ? error.message : String(error),
          );
          return undefined;
        }
      };
      return {
        readFile: path => read(path, () => reader.readFile(path)),
        stat: path => read(path, () => reader.stat(path)),
      };
    };
    this.projectFiles = new ProjectFileCache(
      optional(patchModelPackages(projectFiles)),
    );
    this.builtinFiles = new ProjectFileCache(
      optional(patchModelPackages(builtinFiles)),
    );
    this.packages = new ProjectPackages(this.projectFiles, this.builtinFiles);
    this.files = new TypeScriptFiles(this.packages);
  }

  cancel(): void {
    this.revision++;
  }

  reset(): void {
    this.cancel();
    this.resetRequested = true;
  }

  load(
    project: ModelProject,
    rootPath: string,
    language: ProjectLanguage,
  ): Promise<ProjectAutoImports | undefined> {
    const revision = ++this.revision;
    const current = () => revision === this.revision;
    // Serialize cache writes, coalescing requests superseded before they start.
    const pending = this.pending.then(async () => {
      if (!current()) return undefined;
      const failed = new Set(this.failures.keys());
      this.failures.clear();
      this.projectFiles.clear(path => this.resetRequested || failed.has(path));
      this.builtinFiles.clear(path => this.resetRequested || failed.has(path));
      if (this.resetRequested) {
        this.files = new TypeScriptFiles(this.packages);
        this.program = undefined;
        this.resetRequested = false;
      }
      const changes = await Promise.all([
        this.projectFiles.refresh(),
        this.builtinFiles.refresh(),
      ]);
      // Refresh consumes file versions. Apply invalidation even if superseded,
      // so the successor cannot reuse syntax from before those changes.
      if (
        this.files.invalidate(
          new Set([...failed, ...changes.flatMap(paths => [...paths])]),
        )
      ) {
        this.program = undefined;
      }
      if (!current()) return undefined;
      if (await this.packages.update(project, rootPath)) {
        this.files = new TypeScriptFiles(this.packages);
        this.program = undefined;
      }
      if (!current()) return undefined;
      const path = normalizeProjectPath(
        this.packages.directory + '/.__code3d-auto-imports.ts',
      );
      const options = language.compilerOptions;
      let program: ts.Program;
      for (;;) {
        if (this.files.needsRead) {
          this.program = undefined;
          await this.files.readPending();
          if (!current()) return undefined;
        }
        const entries = language.packageSpecifiers.flatMap(name =>
          packageEntrypoints(name, this.packages.directory, this.files.read),
        );
        this.files.set(
          path,
          [...new Set(entries)]
            .map(name => `import type {} from ${JSON.stringify(name)};`)
            .join('\n'),
        );
        program = ts.createProgram({
          rootNames: [path, '/lib.es5.d.ts'],
          options,
          host: this.files.host,
          oldProgram: this.program,
        });
        if (!this.files.needsRead) break;
      }
      this.program = program;
      const reachable = new Set(
        program.getSourceFiles().map(file => file.fileName),
      );
      return {
        root: {path, source: this.files.sources.get(path)!},
        files: [...this.files.sources].flatMap(([file, source]) =>
          source !== undefined &&
          file !== path &&
          file !== '/lib.es5.d.ts' &&
          (reachable.has(file) ||
            reachable.has(this.files.realPaths.get(file) ?? '') ||
            file.endsWith('.json'))
            ? [{path: file, source}]
            : [],
        ),
        realPaths: Object.fromEntries(this.files.realPaths),
        failures: [...this.failures].map(([path, message]) => ({
          path,
          message,
        })),
      };
    });
    // The caller observes errors; a failed optional request cannot poison its successor.
    this.pending = pending.catch(() => {});
    return pending;
  }
}

/** Enumerate finite public names; TypeScript selects their types/browser/import conditions. */
function packageEntrypoints(
  name: string,
  directory: string,
  read: (path: string) => string | undefined,
): string[] {
  for (;;) {
    const path = normalizeProjectPath(
      directory + '/node_modules/' + name + '/package.json',
    );
    const source = read(path);
    if (source !== undefined) {
      const manifest = ts.parseConfigFileTextToJson(path, source).config;
      const exports = manifest?.exports;
      if (exports === null) return [];
      if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
        const keys = Object.keys(exports);
        if (keys.some(key => key.startsWith('.')))
          return keys
            .filter(key => !key.includes('*') && exports[key] !== null)
            .map(key => (key === '.' ? name : name + key.slice(1)));
      }
      return [name];
    }
    if (directory === '/') return [];
    directory = projectDirectory(directory);
  }
}
