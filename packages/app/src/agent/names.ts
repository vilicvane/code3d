const agentNames = [
  'Euclid',
  'Archimedes',
  'Descartes',
  'Euler',
  'Gauss',
  'Riemann',
  'Möbius',
  'Klein',
  'Poincaré',
  'Hilbert',
  'Hausdorff',
  'Whitney',
];

export function randomAgentName(existingNames: Iterable<string>): string {
  const used = new Set([...existingNames].map(name => name.toLowerCase()));
  const candidates = agentNames.filter(name => !used.has(name.toLowerCase()));
  if (candidates.length)
    return candidates[Math.floor(Math.random() * candidates.length)]!;
  let index = 1;
  while (used.has(`agent ${index}`)) index++;
  return `Agent ${index}`;
}
