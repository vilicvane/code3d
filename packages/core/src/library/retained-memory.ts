/**
 * A conservative weight for retained plain JavaScript data. Typed-array backing
 * storage is counted once within a value; object/string overhead is estimated.
 * Native handles are excluded by callers and measured by the kernel allocator.
 */
export function estimateRetainedBytes(value: unknown): number {
  const seen = new Set<object>();
  function visit(value: unknown): number {
    if (typeof value === 'string') return 16 + value.length * 2;
    if (value === null || typeof value !== 'object') return 8;
    if (seen.has(value)) return 0;
    seen.add(value);
    if (ArrayBuffer.isView(value)) return 64 + visit(value.buffer);
    if (value instanceof ArrayBuffer) return 32 + value.byteLength;
    const values = Object.values(value);
    return (
      32 +
      values.length * 8 +
      values.reduce<number>((sum, item) => sum + visit(item), 0)
    );
  }
  return visit(value);
}
