/** Model node IDs are evaluation-local; preserve their graph while comparing snapshots. */
export function normalizedModelSnapshot(value: string): string {
  const ids = new Map<string, string>();
  return JSON.stringify(JSON.parse(value), (_, item) => {
    if (typeof item !== 'string' || !/^node-\d+$/.test(item)) return item;
    let id = ids.get(item);
    if (!id) {
      id = `instance-${ids.size}`;
      ids.set(item, id);
    }
    return id;
  });
}
