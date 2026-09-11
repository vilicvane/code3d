import type {KernelArtifactStore} from '@code3d/core/tooling';
import {ArtifactJournal} from './artifact-journal';

const storageName = 'code3d-kernel-artifacts';
let retainedIndex: ReturnType<ArtifactJournal['index']> | undefined;
let storageFiles:
  | {
      handles: readonly FileSystemFileHandle[];
      maximumBytes: number;
      checkedAt: number;
    }
  | undefined;

async function journalFiles() {
  if (storageFiles && performance.now() - storageFiles.checkedAt < 60_000)
    return storageFiles;
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(storageName, {create: true});
  const [handles, estimate] = await Promise.all([
    Promise.all(
      ['a', 'b'].map(name => directory.getFileHandle(name, {create: true})),
    ),
    navigator.storage.estimate(),
  ]);
  // File handles are capabilities, not exclusive sync access handles. Keeping
  // them does not hold the journal lock between individual transactions.
  return (storageFiles = {
    handles,
    maximumBytes: Math.floor(
      Math.min(1024 ** 3, (estimate.quota ?? 10 * 1024 ** 3) / 10),
    ),
    checkedAt: performance.now(),
  });
}

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

export type PersistentArtifactStore = KernelArtifactStore & {
  has(id: string): boolean;
  clear(): void;
};

/**
 * One origin-wide journal and budget, shared by projects, App and agent workers.
 * Web Locks cover only an I/O worker's open/read-or-write/close transaction.
 * No model compilation, execution, or response transfer runs under this lock.
 */
export async function withPersistentArtifacts<Result>(
  action: (
    scope: (namespace: string) => PersistentArtifactStore | undefined,
  ) => Promise<Result>,
  onStats: (stats: PersistentArtifactStats | undefined) => void,
  {touchReads = true}: {touchReads?: boolean} = {},
): Promise<Result> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage?.getDirectory ||
    !navigator.locks
  ) {
    onStats(undefined);
    return action(() => undefined);
  }
  let entered = false;
  try {
    return await navigator.locks.request(storageName, async () => {
      entered = true;
      const handles: FileSystemSyncAccessHandle[] = [];
      let journal: ArtifactJournal;
      let errors = 0;
      try {
        const {handles: files, maximumBytes} = await journalFiles();
        for (const file of files) {
          handles.push(await file.createSyncAccessHandle());
        }
        journal = new ArtifactJournal(
          handles as [FileSystemSyncAccessHandle, FileSystemSyncAccessHandle],
          maximumBytes,
          retainedIndex,
        );
        retainedIndex = undefined;
      } catch {
        storageFiles = undefined;
        for (const handle of handles) {
          try {
            handle.close();
          } catch {}
        }
        onStats(undefined);
        return action(() => undefined);
      }
      const scopedStore = (prefix: string): PersistentArtifactStore => ({
        has: id => journal.has(`${prefix}:${id}`),
        get: id => journal.get(`${prefix}:${id}`, touchReads),
        getMany: ids =>
          journal.getMany(
            ids.map(id => `${prefix}:${id}`),
            touchReads,
          ),
        set: (id, bytes) => journal.set(`${prefix}:${id}`, bytes),
        touch: id => journal.touch(`${prefix}:${id}`),
        touchMany: ids => journal.touchMany(ids.map(id => `${prefix}:${id}`)),
        delete: id => journal.delete(`${prefix}:${id}`),
        clear: () => journal.deletePrefix(`${prefix}:`),
        flush: () => journal.flush(),
      });
      try {
        return await action(scopedStore);
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
    });
  } catch (error) {
    // Lock access itself can be denied by the browser, before storage is opened.
    // Never retry an I/O operation after it has begun.
    if (entered) throw error;
    onStats(undefined);
    return action(() => undefined);
  }
}
