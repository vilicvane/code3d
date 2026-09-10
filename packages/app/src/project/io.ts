/** Bound independent I/O work and settle active jobs before reporting failure. */
export async function mapProjectIO<T, R>(
  items: readonly T[],
  action: (item: T) => Promise<R>,
  {concurrency = 16}: {concurrency?: number} = {},
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from(
    {length: Math.min(concurrency, items.length)},
    async () => {
      while (!failed && next < items.length) {
        const index = next++;
        try {
          results[index] = await action(items[index]!);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    },
  );
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return results;
}
