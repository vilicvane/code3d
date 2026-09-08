import {AgentError, type AgentCursor} from '@code3d/agent';
import {resolveAgentCursor, type ResolvedAgentCursor} from './cursor';

export type CursorWorkerResult =
  | {ok: true; cursor: ResolvedAgentCursor}
  | {ok: false; code: string; message: string};

self.onmessage = (
  event: MessageEvent<{source: string; cursor: AgentCursor}>,
) => {
  let result: CursorWorkerResult;
  try {
    result = {
      ok: true,
      cursor: resolveAgentCursor(event.data.source, event.data.cursor),
    };
  } catch (error) {
    result =
      error instanceof AgentError
        ? {ok: false, code: error.code, message: error.message}
        : {
            ok: false,
            code: 'cursor_failed',
            message: 'Cursor resolution failed.',
          };
  }
  self.postMessage(result);
};
