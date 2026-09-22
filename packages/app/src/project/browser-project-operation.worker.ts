import type {
  BrowserProjectOperationRequest,
  BrowserProjectOperationResult,
} from './browser-project-operation';
import {copyProjectToEmptyDirectory} from './file-operations';
import {
  initializeBrowserProjectContents,
  openBrowserProjectFileSystem,
  openDirectoryProjectFileSystem,
} from './filesystem';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (
  event: MessageEvent<BrowserProjectOperationRequest>,
) => {
  let result: BrowserProjectOperationResult;
  try {
    const request = event.data;
    const source = await openBrowserProjectFileSystem(request.databaseName);
    await initializeBrowserProjectContents(source, {
      ...request.contents,
      createExamples: request.createExamples,
    });
    if (request.kind === 'copy') {
      const target = await openDirectoryProjectFileSystem(request.target);
      await copyProjectToEmptyDirectory(source, target);
    }
    result = {ok: true};
  } catch (error) {
    result = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  scope.postMessage(result);
  scope.close();
};
