import {URI} from 'monaco-editor/base/common/uri';

/** TypeScript uses filesystem paths; Monaco uses serialized URIs at the RPC boundary. */
export function typeScriptFileName(fileName: string): string {
  return fileName.startsWith('file:') ? URI.parse(fileName).path : fileName;
}

export function monacoFileName(fileName: string): string {
  return fileName.startsWith('/') ? URI.file(fileName).toString() : fileName;
}

function mapFileNames(
  value: unknown,
  convert: (name: string) => string,
): unknown {
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  let changed = false;
  const mapped = entries.map(([key, item]) => {
    const next =
      key === 'fileName' && typeof item === 'string'
        ? convert(item)
        : mapFileNames(item, convert);
    changed ||= next !== item;
    return [key, next];
  });
  return changed
    ? Array.isArray(value)
      ? mapped.map(([, item]) => item)
      : Object.fromEntries(mapped)
    : value;
}

/** Normalize at the RPC boundary, including Monaco's built-in providers. */
export function typeScriptWorkerRequests<T extends object>(
  worker: T,
  selectWorker: (method: PropertyKey, file: unknown) => T = () => worker,
): T {
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
        const selected = selectWorker(method, args[0]);
        const result = Reflect.apply(
          Reflect.get(selected, method) as typeof member,
          selected,
          args.map(arg => mapFileNames(arg, typeScriptFileName)),
        );
        const serialize = (value: unknown) =>
          mapFileNames(value, monacoFileName);
        return result instanceof Promise
          ? result.then(serialize)
          : serialize(result);
      };
    },
  });
}
