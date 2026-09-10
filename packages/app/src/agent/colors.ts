/** Indices correspond to the shared agent-color-* palette in style.css. */
export function randomAgentColor(existingColors: Iterable<number>): number {
  const counts = Array<number>(6).fill(0);
  for (const color of existingColors) counts[color] = counts[color]! + 1;
  const minimum = Math.min(...counts);
  const candidates = counts.flatMap((count, color) =>
    count === minimum ? [color] : [],
  );
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
