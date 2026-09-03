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
