import {
  browserProjectDatabaseName,
  type BrowserProject,
} from './browser-projects';
import type {ModelProject, ProjectDirectoryTemplate} from './project';

export type BrowserProjectContents = Readonly<{
  examples: ProjectDirectoryTemplate;
  starter: ModelProject;
}>;

type BrowserProjectOperation =
  {kind: 'reset'} | {kind: 'copy'; target: FileSystemDirectoryHandle};

export type BrowserProjectOperationRequest = BrowserProjectOperation & {
  databaseName: string;
  createExamples: boolean;
  contents: BrowserProjectContents;
};

export type BrowserProjectOperationResult =
  {ok: true} | {ok: false; message: string};

/** The caller holds the target project's exclusive lease until this worker closes. */
export async function runBrowserProjectOperation(
  project: BrowserProject,
  operation: BrowserProjectOperation,
  contents: BrowserProjectContents,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL('./browser-project-operation.worker.ts', import.meta.url),
    {type: 'module'},
  );
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once: true});
      worker.onmessage = (
        event: MessageEvent<BrowserProjectOperationResult>,
      ) => {
        if (event.data.ok) resolve();
        else reject(new Error(event.data.message));
      };
      worker.onerror = event => {
        event.preventDefault();
        reject(
          new Error(event.message || 'Could not open the browser project.'),
        );
      };
      worker.onmessageerror = () =>
        reject(new Error('The browser project operation could not be read.'));
      const request: BrowserProjectOperationRequest = {
        ...operation,
        databaseName: browserProjectDatabaseName(project.id),
        createExamples:
          operation.kind === 'reset' || project.template === 'examples',
        contents,
      };
      worker.postMessage(request);
    });
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    // ZenFS does not expose a connection close API; worker teardown owns the DB.
    worker.terminate();
  }
}
