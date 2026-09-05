import enhancedResolve, {type FileSystem} from 'enhanced-resolve';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';

const nodeBuiltins = new Set(
  'assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https inspector module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib'.split(
    ' ',
  ),
);

export function nodeBuiltinError(specifier: string): Error {
  return new Error(
    `Node built-in ${specifier} is not available in the browser. Use a package with a browser implementation.`,
  );
}

/** Package semantics belong to the resolver, not to a compiler require shim. */
export class ProjectPackageResolver {
  private readonly importResolver;
  private readonly requireResolver;

  constructor(reader: ProjectFileReader) {
    const missing = (path: string) =>
      Object.assign(new Error(`Project file not found: ${path}`), {
        code: 'ENOENT',
      });
    const fileSystem = {
      readFile(
        path: string,
        callback: (error: Error | null, value?: string) => void,
      ) {
        reader.readFile(path).then(
          bytes =>
            bytes === undefined
              ? callback(missing(path))
              : callback(null, decodeProjectFile(bytes)),
          error => callback(error),
        );
      },
      stat(
        path: string,
        callback: (error: Error | null, value?: unknown) => void,
      ) {
        reader.stat(path).then(
          info =>
            info === undefined
              ? callback(missing(path))
              : callback(null, {
                  isFile: () => info.kind === 'file',
                  isDirectory: () => info.kind === 'directory',
                }),
          error => callback(error),
        );
      },
    } as FileSystem;
    const create = (condition: 'import' | 'require') =>
      enhancedResolve.ResolverFactory.createResolver({
        fileSystem,
        conditionNames: ['browser', condition, 'default'],
        mainFields: ['browser', 'module', 'main'],
        aliasFields: ['browser'],
        extensions: ['.js', '.json', '.mjs', '.cjs'],
        exportsFields: ['exports'],
        importsFields: ['imports'],
        symlinks: false,
        useSyncFileSystemCalls: false,
      });
    this.importResolver = create('import');
    this.requireResolver = create('require');
  }

  resolve(
    specifier: string,
    importer: string,
    kind: 'import' | 'require' = 'import',
  ): Promise<string | false> {
    if (specifier.startsWith('node:')) {
      return Promise.reject(nodeBuiltinError(specifier));
    }
    const resolver =
      kind === 'require' ? this.requireResolver : this.importResolver;
    return new Promise((resolve, reject) => {
      resolver.resolve(
        {},
        projectDirectory(importer),
        specifier,
        {},
        (error, result) => {
          if (error)
            reject(
              nodeBuiltins.has(specifier.split('/')[0])
                ? nodeBuiltinError(specifier)
                : error,
            );
          else if (result === false) resolve(false);
          else if (result) resolve(normalizeProjectPath(result));
          else
            reject(
              new Error(`Could not resolve ${specifier} from ${importer}`),
            );
        },
      );
    });
  }
}
