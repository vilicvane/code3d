import enhancedResolve, {type FileSystem} from 'enhanced-resolve';
import {decodeProjectFile, type ProjectFileReader} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';

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
      return Promise.reject(
        new Error(
          `Node built-in ${specifier} is not available in the browser.`,
        ),
      );
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
          if (error) reject(error);
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
