import type {KernelArtifactStore} from '@code3d/core/tooling';
import {ArtifactJournal} from './artifact-journal';

const storageName = 'code3d-kernel-artifacts';
let retainedIndex: ReturnType<ArtifactJournal['index']> | undefined;

/** Content, including resolved Core/Replicad/codec input files and actual WASM bytes. */
export async function runtimeArtifactIdentity(
  parts: readonly Uint8Array[],
): Promise<string> {
  const hashes = await Promise.all(
    parts.map(
      async bytes =>
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            bytes as Uint8Array<ArrayBuffer>,
          ),
        ),
    ),
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        Uint8Array.from(hashes.flatMap(hash => [...hash])),
      ),
    ),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');
}

export type PersistentArtifactStats = ReturnType<ArtifactJournal['stats']> & {
  errors: number;
};

/**
 * One origin-wide journal and budget, shared by projects, App and agent workers.
 * Web Locks cover the complete open/evaluate/close transaction. Waiting remains
 * asynchronous and cancellable; no sync handle is kept by an idle compiler.
 */
export async function withPersistentArtifacts<Result>(
  namespace: string,
  action: (
    store: KernelArtifactStore | undefined,
    resources?: KernelArtifactStore,
  ) => Promise<Result>,
  checkCancelled: () => void,
  onStats: (stats: PersistentArtifactStats | undefined) => void,
): Promise<Result> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage?.getDirectory ||
    !navigator.locks
  ) {
    onStats(undefined);
    return action(undefined);
  }
  const controller = new AbortController();
  let entered = false;
  const timer = setInterval(() => {
    try {
      checkCancelled();
    } catch (error) {
      controller.abort(error);
    }
  }, 50);
  try {
    return await navigator.locks.request(
      storageName,
      {signal: controller.signal},
      async () => {
        entered = true;
        checkCancelled();
        const handles: FileSystemSyncAccessHandle[] = [];
        let journal: ArtifactJournal;
        let errors = 0;
        try {
          const root = await navigator.storage.getDirectory();
          const directory = await root.getDirectoryHandle(storageName, {
            create: true,
          });
          for (const name of ['a', 'b']) {
            const file = await directory.getFileHandle(name, {create: true});
            handles.push(await file.createSyncAccessHandle());
          }
          const estimate = await navigator.storage.estimate();
          // Reserve compaction space within the budget, without preallocation.
          // Quota exhaustion still goes through the memory-only storage boundary.
          const maximumBytes = Math.floor(
            Math.min(1024 ** 3, (estimate.quota ?? 10 * 1024 ** 3) / 10),
          );
          journal = new ArtifactJournal(
            handles as [FileSystemSyncAccessHandle, FileSystemSyncAccessHandle],
            maximumBytes,
            retainedIndex,
          );
          retainedIndex = undefined;
        } catch {
          for (const handle of handles) {
            try {
              handle.close();
            } catch {}
          }
          onStats(undefined);
          checkCancelled();
          return action(undefined);
        }
        const scopedStore = (prefix: string): KernelArtifactStore => ({
          get: id => journal.get(`${prefix}:${id}`),
          set: (id, bytes) => journal.set(`${prefix}:${id}`, bytes),
          touch: id => journal.touch(`${prefix}:${id}`),
          delete: id => journal.delete(`${prefix}:${id}`),
          flush: () => journal.flush(),
        });
        try {
          checkCancelled();
          return await action(scopedStore(namespace), scopedStore('resources'));
        } finally {
          try {
            journal.flush();
            retainedIndex = journal.index();
          } catch {
            errors++;
            retainedIndex = undefined;
          }
          try {
            onStats({...journal.stats(), errors});
          } catch {
            onStats(undefined);
          }
          for (const handle of handles) {
            try {
              handle.close();
            } catch {}
          }
        }
      },
    );
  } catch (error) {
    // Lock access itself can be denied by the browser, before storage is opened.
    // Never retry the model action after it has begun or swallow cancellation.
    if (entered || controller.signal.aborted) throw error;
    onStats(undefined);
    checkCancelled();
    return action(undefined);
  } finally {
    clearInterval(timer);
  }
}
