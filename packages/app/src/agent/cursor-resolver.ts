import {AgentError, type AgentCursor} from '@code3d/agent';
import type {ResolvedAgentCursor} from './cursor';
import type {CursorWorkerResult} from './cursor.worker';

/** Each preflight gets an isolated worker, terminated on completion, cancellation or timeout. */
export async function inspectAgentCursor(
  source: string,
  cursor: AgentCursor,
  signal?: AbortSignal,
): Promise<ResolvedAgentCursor> {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./cursor.worker.ts', import.meta.url), {
    type: 'module',
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<ResolvedAgentCursor>((resolve, reject) => {
      abort = () => reject(signal!.reason);
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(
        () =>
          reject(
            new AgentError(
              'cursor_timeout',
              'Cursor regex exceeded the 1-second resolution deadline. Simplify it or narrow the line range.',
            ),
          ),
        1000,
      );
      worker.onmessage = (event: MessageEvent<CursorWorkerResult>) => {
        const result = event.data;
        if (result.ok) resolve(result.cursor);
        else reject(new AgentError(result.code, result.message));
      };
      worker.onerror = event => {
        event.preventDefault();
        reject(new AgentError('cursor_failed', 'Cursor worker failed.'));
      };
      worker.onmessageerror = () =>
        reject(
          new AgentError(
            'cursor_failed',
            'Cursor worker returned an unreadable message.',
          ),
        );
      worker.postMessage({source, cursor});
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
    worker.terminate();
  }
}
