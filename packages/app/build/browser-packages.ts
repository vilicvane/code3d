import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import type {Plugin, ViteDevServer} from 'vite';

const execute = promisify(execFile);
const moduleId = 'virtual:code3d-browser-packages';
const assetPrefix = '/__code3d-packages/';

/** Distribute npm's published file lists, never the Studio's bundled modules. */
export function browserPackages(repository: string): Plugin {
  type Artifact = {path: string; disk: string; version: string; bytes: Buffer};
  type PackageMetadata = {
    dependencies?: Record<string, string>;
  };
  const assets = new Map<string, Buffer>();
  const watched = new Set<string>();
  let artifacts: Promise<{files: Artifact[]}> | undefined;
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
    async function add(name: string, from: string, parent = '') {
      const disk = await locate(name, from);
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
    await add('@code3d/core', repository);
    await add('@code3d/screws', repository);
    for (const pkg of packages.values()) {
      for (const name of Object.keys(pkg.metadata.dependencies ?? {}))
        await add(name, pkg.disk, pkg.destination);
    }
    const files: Artifact[] = [];
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
          disk,
          version,
          bytes,
        });
      }
    }
    return {files};
  }

  return {
    name: 'code3d-browser-packages',
    configResolved(config) {
      development = config.command === 'serve';
    },
    resolveId(id) {
      if (id === moduleId) return '\0' + moduleId;
    },
    async load(id) {
      if (id !== '\0' + moduleId) return;
      let files: Artifact[];
      for (;;) {
        const collection = (artifacts ??= collect());
        let collected: {files: Artifact[]};
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
          break;
        }
      }
      const records = files.map(file => {
        // These are package bytes, not Studio imports. Vite's addWatchFile
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
      return 'export const files = {' + records.join(',') + '};';
    },
    hotUpdate({file}) {
      if (this.environment.config.consumer !== 'client') return;
      if (
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
  };
}
