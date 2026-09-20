/// <reference lib="webworker" />

import * as esbuild from 'esbuild-wasm';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import compilerRecipe from 'virtual:code3d-compiler-recipe';
import type {ProjectFileInfo, ProjectFileReader} from '../project/file-reader';
import {ProjectAutoImportLoader} from '../project/project-auto-imports';
import {ArtifactStoreConnection} from './artifact-store';
import {
  BuildArtifactCache,
  buildEntryKey,
  buildProjectNamespace,
  projectArtifactIdentity,
} from './build-artifact-cache';
import {checkCompilationCancellation} from './compilation-cancellation';
import {
  ArtifactChannel,
  type CompileRequest,
  type CompilerRequest,
  type CompilerResponse,
  type FileQuery,
  type FileRequest,
} from './compiler-protocol';
import {diagnosticFromError} from './diagnostic';
import {ProjectCompiler} from './project-compiler';

const workerScope = self as DedicatedWorkerGlobalScope;
const send = (message: CompilerResponse) => workerScope.postMessage(message);
let engineReady: Promise<void> | undefined;
let nextFileId = 1;
const pendingFiles = new Map<
  number,
  {resolve(value: unknown): void; reject(error: Error): void}
>();

function requestFile<T>(
  source: FileRequest['source'],
  query: FileQuery,
): Promise<T> {
  const id = nextFileId++;
  return new Promise((resolve, reject) => {
    pendingFiles.set(id, {resolve: value => resolve(value as T), reject});
    send({kind: 'file', id, source, ...query});
  });
}

const storage = new ArtifactStoreConnection();
const artifactChannel = new ArtifactChannel();
let cachedProject: {identity: string; cache: BuildArtifactCache} | undefined;
function cacheFor(identity: string): BuildArtifactCache {
  if (cachedProject?.identity !== identity) {
    const namespace = `${buildProjectNamespace(identity)}:${compilerRecipe}`;
    cachedProject = {
      identity,
      cache: new BuildArtifactCache(
        storage.scope(namespace),
        (key, value, required) =>
          storage.publish(namespace, key, value, required),
      ),
    };
  }
  return cachedProject.cache;
}
let clearing = Promise.resolve();
const fileReader = (source: FileRequest['source']): ProjectFileReader => ({
  readFile: path =>
    requestFile<Uint8Array | undefined>(source, {operation: 'readFile', path}),
  stat: path =>
    requestFile<ProjectFileInfo | undefined>(source, {operation: 'stat', path}),
  statMany: paths =>
    requestFile<readonly (ProjectFileInfo | undefined)[]>(source, {
      operation: 'statMany',
      paths,
    }),
});
const projectFiles = fileReader('project');
const builtinFiles = fileReader('builtin');
const compiler = new ProjectCompiler(projectFiles, builtinFiles, esbuild);
const autoImports = new ProjectAutoImportLoader(projectFiles, builtinFiles);

let activeRequest: number | undefined;
const restoring = new Map<number, Promise<void>>();

// The client coalesces pending revisions while esbuild cancels its current work.
// Cancellation retains the compiler's contexts for the next revision.
async function compile(request: CompileRequest): Promise<void> {
  activeRequest = request.id;
  autoImports.cancel();
  const checkCancelled = () =>
    checkCompilationCancellation(request.cancellation);
  try {
    await clearing;
    await storage.ready;
    storage.readCancellation = request.cancellation;
    checkCancelled();
    if (!engineReady) {
      send({kind: 'progress', id: request.id, phase: 'loading-compiler'});
      engineReady = esbuild
        .initialize({wasmURL: esbuildWasmUrl, worker: false})
        .catch(error => {
          engineReady = undefined;
          throw error;
        });
    }
    await engineReady;
    checkCancelled();
    const artifact = await compiler.compile(
      request.project,
      request.rootPath,
      request.designContext,
      language => {
        send({kind: 'language', id: request.id, language});
        // Export discovery is optional and can finish after model execution.
        void autoImports.load(request.project, request.rootPath, language).then(
          index => {
            if (index && !Atomics.load(request.cancellation, 0))
              send({
                kind: 'language',
                id: request.id,
                language: {...language, autoImports: index},
              });
          },
          error => console.error('Package export discovery failed:', error),
        );
      },
      phase => send({kind: 'progress', id: request.id, phase}),
      checkCancelled,
      request.projectIdentity
        ? async scope =>
            cacheFor(request.projectIdentity!).restoreDependencies(
              await buildEntryKey(request.projectIdentity!, scope),
            )
        : undefined,
    );
    checkCancelled();
    if (request.projectIdentity) {
      const key = await buildEntryKey(
        request.projectIdentity,
        request.rootPath,
        request.designContext,
      );
      const dependencyKey = await buildEntryKey(
        request.projectIdentity,
        compiler.dependencyScope,
      );
      await cacheFor(request.projectIdentity).save(
        key,
        artifact,
        request.stamp,
        checkCancelled,
        'latest',
        dependencyKey,
      );
    }
    // Compilation and disk restoration run concurrently, but the client must
    // receive the previous successful view before a newer result replaces it.
    await restoring.get(request.id);
    checkCancelled();
    send({
      kind: 'compiled',
      id: request.id,
      ...artifactChannel.encode(artifact),
    });
  } catch (error) {
    await restoring.get(request.id);
    if (Atomics.load(request.cancellation, 0)) {
      send({kind: 'cancelled', id: request.id});
      return;
    }
    send({
      kind: 'result',
      id: request.id,
      ok: false,
      diagnostic: diagnosticFromError(error, 'project'),
    });
  } finally {
    storage.readCancellation = undefined;
    storage.scope('resources').flush();
    if (activeRequest === request.id) activeRequest = undefined;
  }
}

workerScope.onmessage = ({data}: MessageEvent<CompilerRequest>) => {
  if (data.kind === 'artifact-store') {
    storage.connect(data.endpoint);
  } else if (data.kind === 'file-result') {
    const pending = pendingFiles.get(data.id);
    pendingFiles.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.value);
  } else if (data.kind === 'restore') {
    const checkCancelled = () =>
      checkCompilationCancellation(data.cancellation);
    const pending = (async () => {
      await clearing;
      await storage.ready;
      const key = await buildEntryKey(
        data.projectIdentity,
        data.rootPath,
        data.designContext,
      );
      checkCancelled();
      const cache = cacheFor(data.projectIdentity);
      const artifact = storage.withReadCancellation(data.cancellation, () => {
        const successful = cache.restore(key, 'successful');
        checkCancelled();
        return successful ?? cache.restore(key);
      });
      checkCancelled();
      if (artifact) {
        const dependencies = compiler.restoreDependencies(
          artifact.dependencies,
        );
        let restored =
          dependencies === artifact.dependencies
            ? artifact
            : {
                ...artifact,
                dependencies,
                resources: new Map([
                  ...dependencies.resources,
                  ...artifact.resources,
                ]),
              };
        if (restored !== artifact)
          restored = {...restored, id: await projectArtifactIdentity(restored)};
        checkCancelled();
        send({
          kind: 'cached',
          id: data.id,
          ...artifactChannel.encode(restored),
        });
      }
    })()
      .catch(() => {})
      .finally(() => restoring.delete(data.id));
    restoring.set(data.id, pending);
  } else if (data.kind === 'compile') {
    void compile(data);
  } else if (data.kind === 'cancel-compile') {
    autoImports.cancel();
    if (activeRequest === data.id) void compiler.cancel();
  } else if (data.kind === 'refresh-project') {
    compiler.refreshProject();
    autoImports.reset();
  } else if (data.kind === 'clear-build-cache') {
    // The client starts this command in a fresh compiler Worker. Any new source
    // or restore request waits until the old project's disk records are gone.
    clearing = storage.ready.then(() => {
      storage.clear(buildProjectNamespace(data.projectIdentity));
      cachedProject = undefined;
    });
    void clearing.then(
      () => send({kind: 'build-cache-cleared'}),
      error => send({kind: 'build-cache-cleared', error: String(error)}),
    );
  } else if (data.kind === 'execution-succeeded') {
    void buildEntryKey(
      data.projectIdentity,
      data.rootPath,
      data.designContext,
    ).then(key =>
      cacheFor(data.projectIdentity).succeeded(key, data.artifact, data.stamp),
    );
  }
};
