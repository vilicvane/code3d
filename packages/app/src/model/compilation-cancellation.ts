/** Shared memory remains observable while the model Worker runs synchronous JS/WASM. */
export type CompilationCancellation = Int32Array<SharedArrayBuffer>;

export function checkCompilationCancellation(
  signal: CompilationCancellation,
): void {
  if (Atomics.load(signal, 0)) throw new Error('Compilation superseded.');
}
