import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {glob, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import type {Plugin, ViteDevServer} from 'vite';
import {builtinPackageNames} from '../src/project/builtin-packages.ts';
import type {WorkspacePackage} from '../src/project/workspace-packages.ts';

const execute = promisify(execFile);
const moduleId = 'virtual:code3d-browser-packages';
const assetPrefix = '/__code3d-packages/';

/** Distribute npm's published file lists, never the App's bundled modules. */
export function browserPackages(repository: string) {
  type Artifact = {
    path: string;
    root: string;
    disk: string;
    version: string;
    bytes: Buffer;
  };
  type PackageMetadata = {
    name: string;
    version: string;
    private?: boolean;
    dependencies?: Record<string, string>;
  };
  const assets = new Map<string, Buffer>();
  const watched = new Set<string>();
  const watchedManifests = new Set<string>();
  type Collection = {
    files: Artifact[];
    workspaces: Record<
      string,
      {
        manifest: WorkspacePackage['manifest'];
        revision: string;
        destination: string;
      }
    >;
  };
  let artifacts: Promise<Collection> | undefined;
  let development = false;
  let watcher: ViteDevServer['watcher'];

  async function collect() {
    const packages = new Map<
      string,
      {disk: string; destination: string; metadata: PackageMetadata}
    >();
    const destinations = new Set<string>();

    async function locate(name: string, from: string): Promise<string> {
      for (let directory = from; ; directory = path.dirname(directory)) {
        try {
          return await realpath(path.join(directory, 'node_modules', name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (path.dirname(directory) === directory)
          throw new Error(
            'Browser project dependency is not installed: ' + name,
          );
      }
    }
    async function add(
      name: string,
      from: string,
      parent = '',
      workspace?: string,
    ) {
      const disk = workspace ?? (await locate(name, from));
      if (packages.has(disk)) return;
      // Watch before reading metadata or bytes: collection awaits npm and can
      // overlap a clean/build. Directory watches also see new published files.
      if (development && !watched.has(disk)) {
        watched.add(disk);
        watcher.add(disk);
      }
      const destination = destinations.has('/node_modules/' + name)
        ? parent + '/node_modules/' + name
        : '/node_modules/' + name;
      const metadata = JSON.parse(
        await readFile(path.join(disk, 'package.json'), 'utf8'),
      );
      packages.set(disk, {disk, destination, metadata});
      destinations.add(destination);
    }
    const workspaceRoots = new Set<string>();
    if (development) {
      const manifestPath = path.join(repository, 'package.json');
      // Workspace declarations themselves are inputs, including newly added packages.
      watcher.add(manifestPath);
      watchedManifests.add(manifestPath);
      let manifest: {workspaces?: string[]};
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        manifest = {};
      }
      for await (const relative of glob(manifest.workspaces ?? [], {
        cwd: repository,
      })) {
        const disk = await realpath(path.join(repository, relative));
        const manifestPath = path.join(disk, 'package.json');
        watchedManifests.add(manifestPath);
        watcher.add(manifestPath);
        const metadata: PackageMetadata = JSON.parse(
          await readFile(path.join(disk, 'package.json'), 'utf8'),
        );
        if (!metadata.name.startsWith('@code3d/') || metadata.private) continue;
        workspaceRoots.add(disk);
        await add(metadata.name, repository, '', disk);
      }
    }
    for (const name of builtinPackageNames)
      if (!destinations.has('/node_modules/' + name))
        await add(name, repository);
    for (const pkg of packages.values()) {
      for (const name of Object.keys(pkg.metadata.dependencies ?? {}))
        await add(name, pkg.disk, pkg.destination);
    }
    const files: Artifact[] = [];
    const workspaces: Collection['workspaces'] = {};
    for (const pkg of packages.values()) {
      const {stdout} = await execute(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        [
          'pack',
          '--dry-run',
          '--json',
          '--ignore-scripts',
          '--workspaces=false',
        ],
        {
          cwd: pkg.disk,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          shell: process.platform === 'win32',
        },
      );
      const [{files: entries}] = JSON.parse(stdout) as {
        files: {path: string}[];
      }[];
      for (const entry of entries) {
        const disk = path.join(pkg.disk, entry.path);
        const bytes = await readFile(disk);
        const version = createHash('sha256').update(bytes).digest('hex');
        files.push({
          path: pkg.destination + '/' + entry.path,
          root: pkg.destination,
          disk,
          version,
          bytes,
        });
      }
      if (workspaceRoots.has(pkg.disk)) {
        const revision = createHash('sha256')
          .update(
            JSON.stringify(
              files
                .filter(file => file.root === pkg.destination)
                .map(file => [file.path, file.version])
                .sort(),
            ),
          )
          .digest('hex');
        workspaces[pkg.metadata.name] = {
          manifest: pkg.metadata,
          revision,
          destination: pkg.destination,
        };
      }
    }
    return {files, workspaces};
  }

  return {
    name: 'code3d-browser-packages',
    configResolved(config) {
      development = config.command === 'serve';
    },
    resolveId(id) {
      if (id === moduleId) return '\0' + moduleId;
      return undefined;
    },
    async load(id) {
      if (id !== '\0' + moduleId) return;
      let files: Artifact[];
      let workspaces: Collection['workspaces'];
      for (;;) {
        const collection = (artifacts ??= collect());
        let collected: Collection;
        try {
          collected = await collection;
        } catch (error) {
          // A clean rebuild can remove a file while npm is enumerating it.
          // Retry an invalidated snapshot; do not cache other read failures.
          if (artifacts !== collection) continue;
          artifacts = undefined;
          throw error;
        }
        // An update during collection invalidates the whole snapshot. Never
        // publish a stale manifest after the update's reload already happened.
        if (artifacts === collection) {
          files = collected.files;
          workspaces = collected.workspaces;
          break;
        }
      }
      const records = files.map(file => {
        // These are package bytes, not App imports. Vite's addWatchFile
        // also adds module-graph edges on reload, including Node-only entries.
        if (!development) this.addWatchFile(file.disk);
        const key = file.version + path.extname(file.path);
        const url = development
          ? JSON.stringify(assetPrefix + key)
          : 'import.meta.ROLLUP_FILE_URL_' +
            this.emitFile({
              type: 'asset',
              name: path.basename(file.path),
              source: file.bytes,
            });
        assets.set(key, file.bytes);
        return (
          JSON.stringify(file.path) +
          ':{version:' +
          JSON.stringify(file.version) +
          ',url:' +
          url +
          '}'
        );
      });
      const workspaceRecords = Object.entries(workspaces).map(
        ([name, pkg]) =>
          JSON.stringify(name) +
          ':{manifest:' +
          JSON.stringify(pkg.manifest) +
          ',revision:' +
          JSON.stringify(pkg.revision) +
          ',files:{' +
          files
            .filter(file => file.root === pkg.destination)
            .map(
              file =>
                JSON.stringify(file.path.slice(pkg.destination.length + 1)) +
                ':files[' +
                JSON.stringify(file.path) +
                ']',
            )
            .join(',') +
          '}}',
      );
      return (
        'export const files = {' +
        records.join(',') +
        '};\nexport const workspaces = {' +
        workspaceRecords.join(',') +
        '};'
      );
    },
    hotUpdate({file}) {
      if (this.environment.config.consumer !== 'client') return;
      if (
        !watchedManifests.has(file) &&
        ![...watched].some(directory => file.startsWith(directory + path.sep))
      )
        return;
      artifacts = undefined;
      const module = this.environment.moduleGraph.getModuleById(
        '\0' + moduleId,
      );
      if (module) this.environment.moduleGraph.invalidateModule(module);
      this.environment.hot.send({type: 'full-reload'});
      return [];
    },
    configureServer(server) {
      watcher = server.watcher;
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(assetPrefix)) return next();
        const bytes = assets.get(request.url.slice(assetPrefix.length));
        if (!bytes) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'application/octet-stream');
        response.setHeader(
          'Cache-Control',
          'public, max-age=31536000, immutable',
        );
        response.end(bytes);
      });
    },
  } satisfies Plugin;
}
