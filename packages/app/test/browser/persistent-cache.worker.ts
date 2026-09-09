/// <reference lib="webworker" />
import * as esbuild from 'esbuild-wasm';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import {ProjectCompiler} from '../../src/model/project-compiler';
import {browserPackageFiles} from '../../src/project/browser-packages';
import type {ModelSnapshotObject} from '@code3d/core/tooling';

export type CacheRequest = {
  source: string;
  revision?: number;
  disabled?: boolean;
  cancellation?: Int32Array;
  inspect?: boolean;
  summary?: boolean;
};
export type CacheResult = {
  milliseconds: number;
  stats: ProjectCompiler['kernelCacheStats'];
  objects?: string;
  topology?: string;
  stepBytes?: number;
  diagnostic?: unknown;
  error?: string;
  phases?: {phase: string; milliseconds: number}[];
};
const scope = self as DedicatedWorkerGlobalScope;
const ready = esbuild.initialize({wasmURL: esbuildWasmUrl, worker: false});
let compiler: ProjectCompiler | undefined;
scope.onmessage = async ({data}: MessageEvent<CacheRequest>) => {
  await ready;
  if (data.disabled)
    Object.defineProperty(navigator.storage, 'getDirectory', {
      value: async () => {
        throw new DOMException('Unavailable', 'SecurityError');
      },
    });
  if (!compiler) {
    compiler = new ProjectCompiler(
      {
        async readFile() {
          return undefined;
        },
        async stat() {
          return undefined;
        },
      },
      {
        stat: browserPackageFiles.stat,
        async readFile(path) {
          const bytes = await browserPackageFiles.readFile(path);
          if (
            !bytes ||
            !data.revision ||
            !path.endsWith('/library/kernel-cache.js')
          )
            return bytes;
          return new TextEncoder().encode(
            new TextDecoder().decode(bytes) +
              `\nexport const fixtureCoreRevision = ${data.revision};`,
          );
        },
      },
      esbuild,
    );
  }
  const start = performance.now();
  const phases: {phase: string; milliseconds: number}[] = [];
  try {
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source: data.source}]},
      '/model.ts',
      undefined,
      undefined,
      phase => {
        phases.push({phase, milliseconds: performance.now() - start});
        scope.postMessage({phase});
      },
      () => {
        if (data.cancellation && Atomics.load(data.cancellation, 0))
          throw new Error('Cancelled');
      },
    );
    const objects = [...module.objects.values()];
    const topology: unknown[] = [];
    let stepBytes: number | undefined;
    if (data.inspect && !module.diagnostic) {
      for (const object of objects.filter(object => !!object.mesh)) {
        const pages = [];
        let offset = 0;
        for (;;) {
          const page = compiler.inspectTopology(object.nodeId, {
            offset,
            limit: 200,
          });
          pages.push(page);
          if (page.nextOffset === undefined) break;
          offset = page.nextOffset;
        }
        topology.push([object.nodeId, pages]);
      }
      const id =
        module.exports.get('default') ?? module.exports.values().next().value;
      const object: ModelSnapshotObject | undefined = id
        ? module.objects.get(id)
        : undefined;
      if (object?.mesh)
        stepBytes = compiler.export(
          [
            {
              nodeId: object.nodeId,
              name: 'fixture',
              kind: object.kind,
              transform: object.transform,
            },
          ],
          {
            format: 'step',
            scale: 1,
            upAxis: 'y',
            tolerance: 0.1,
            angularTolerance: 0.1,
            binary: true,
          },
        ).size;
    }
    const milliseconds = performance.now() - start;
    const digest = async (value: unknown) => {
      const json = JSON.stringify(value);
      if (!data.summary) return json;
      return Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)),
        ),
        byte => byte.toString(16).padStart(2, '0'),
      ).join('');
    };
    scope.postMessage({
      milliseconds,
      stats: compiler.kernelCacheStats,
      objects: await digest(objects),
      topology: await digest(topology),
      phases,
      stepBytes,
      diagnostic: module.diagnostic,
    } satisfies CacheResult);
  } catch (error) {
    scope.postMessage({
      milliseconds: performance.now() - start,
      stats: compiler.kernelCacheStats,
      error: String(error),
    } satisfies CacheResult);
  }
};
