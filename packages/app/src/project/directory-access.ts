const databaseName = 'code3d-settings-v1';
const storeName = 'settings';
const directoryHandleKeyPrefix = 'project-directory:';

type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options: {mode: 'readwrite'}): Promise<PermissionState>;
  requestPermission(options: {mode: 'readwrite'}): Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker(options: {
    id: string;
    mode: 'readwrite';
  }): Promise<FileSystemDirectoryHandle>;
};

export function supportsProjectDirectories(): boolean {
  return 'showDirectoryPicker' in window;
}

export async function pickProjectDirectory(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  const picker = (window as unknown as DirectoryPickerWindow)
    .showDirectoryPicker;
  try {
    return await picker.call(window, {
      id: 'code3d-project',
      mode: 'readwrite',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return undefined;
    }
    throw error;
  }
}

export async function projectDirectoryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const permissioned = handle as Partial<PermissionedDirectoryHandle>;
  return permissioned.queryPermission
    ? permissioned.queryPermission({mode: 'readwrite'})
    : 'granted';
}

export async function requestProjectDirectoryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const permissioned = handle as Partial<PermissionedDirectoryHandle>;
  return permissioned.requestPermission
    ? permissioned.requestPermission({mode: 'readwrite'})
    : 'granted';
}

export async function storedProjectDirectory(
  workspaceId: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  const database = await openDatabase();
  try {
    const request = database
      .transaction(storeName, 'readonly')
      .objectStore(storeName)
      .get(directoryHandleKey(workspaceId));
    return await requestResult<FileSystemDirectoryHandle | undefined>(request);
  } finally {
    database.close();
  }
}

export async function storeProjectDirectory(
  workspaceId: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction
      .objectStore(storeName)
      .put(handle, directoryHandleKey(workspaceId));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

function directoryHandleKey(workspaceId: string): string {
  return `${directoryHandleKeyPrefix}${workspaceId}`;
}

/** Reopening the same directory retains its workspace and agent identities. */
export async function rememberProjectDirectory(
  handle: FileSystemDirectoryHandle,
): Promise<string> {
  return navigator.locks.request('code3d:project-directories', async () => {
    const database = await openDatabase();
    let entries: [IDBValidKey[], FileSystemDirectoryHandle[]];
    try {
      const store = database.transaction(storeName).objectStore(storeName);
      const range = IDBKeyRange.bound(
        directoryHandleKeyPrefix,
        directoryHandleKeyPrefix + '\uffff',
      );
      entries = await Promise.all([
        requestResult(store.getAllKeys(range)),
        requestResult<FileSystemDirectoryHandle[]>(store.getAll(range)),
      ]);
    } finally {
      database.close();
    }
    for (const [index, stored] of entries[1].entries()) {
      if (await handle.isSameEntry(stored))
        return String(entries[0][index]).slice(directoryHandleKeyPrefix.length);
    }
    const workspaceId = crypto.randomUUID();
    await storeProjectDirectory(workspaceId, handle);
    return workspaceId;
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(storeName);
  };
  return requestResult(request);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

type DirectoryChangeRecord = {
  type:
    'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored';
  relativePathComponents: string[];
  relativePathMovedFrom?: string[];
};
type DirectoryObserver = {
  observe(
    handle: FileSystemDirectoryHandle,
    options: {recursive: boolean},
  ): Promise<void>;
  disconnect(): void;
};

/** Experimental browser capability; absence or lost observation uses the caller's polling path. */
export async function observeProjectDirectory(
  handle: FileSystemDirectoryHandle,
  changed: (paths?: readonly string[]) => void,
  unavailable: () => void,
): Promise<(() => void) | undefined> {
  const Observer = (
    globalThis as typeof globalThis & {
      FileSystemObserver?: new (
        callback: (records: DirectoryChangeRecord[]) => void,
      ) => DirectoryObserver;
    }
  ).FileSystemObserver;
  if (!Observer) return undefined;
  let active = true;
  let observer: DirectoryObserver | undefined;
  const disconnect = () => {
    active = false;
    observer?.disconnect();
  };
  try {
    observer = new Observer(records => {
      if (!active) return;
      if (records.some(record => record.type === 'errored')) {
        disconnect();
        unavailable();
        return;
      }
      if (records.some(record => record.type === 'unknown')) {
        changed();
        return;
      }
      const paths = new Set<string>();
      for (const record of records) {
        for (const parts of [
          record.relativePathComponents,
          record.relativePathMovedFrom,
        ]) {
          if (
            !parts ||
            parts.some(part =>
              ['node_modules', '.code3d', '.git'].includes(part),
            )
          )
            continue;
          paths.add('/' + parts.join('/'));
        }
      }
      if (paths.size) changed([...paths]);
    });
    await observer.observe(handle, {recursive: true});
    return active ? disconnect : undefined;
  } catch {
    disconnect();
    return undefined;
  }
}
