import {URI} from 'monaco-editor/base/common/uri';

/** TypeScript resolves package paths literally; Monaco RPC serializes URIs. */
export function typeScriptFileName(fileName: string): string {
  return fileName.startsWith('file:')
    ? URI.parse(fileName).toString(true)
    : fileName;
}

/** Normalize at the RPC boundary, including Monaco's built-in providers. */
export function typeScriptWorkerRequests<T extends object>(worker: T): T {
  return new Proxy(worker, {
    get(target, method) {
      const member = Reflect.get(target, method);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        // Worker language operations take the document URI as their first
        // argument. Configuration updates and library queries do not.
        if (typeof args[0] === 'string') {
          args[0] = typeScriptFileName(args[0]);
        }
        if (method === 'getDocumentHighlights') {
          args[2] = (args[2] as string[]).map(typeScriptFileName);
        }
        return Reflect.apply(member, target, args);
      };
    },
  });
}
