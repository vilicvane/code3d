const agentNames = [
  {name: 'Euclid', article: 'Euclid'},
  {name: 'Archimedes', article: 'Archimedes'},
  {name: 'Descartes', article: 'René_Descartes'},
  {name: 'Euler', article: 'Leonhard_Euler'},
  {name: 'Gauss', article: 'Carl_Friedrich_Gauss'},
  {name: 'Riemann', article: 'Bernhard_Riemann'},
  {name: 'Möbius', article: 'August_Ferdinand_Möbius'},
  {name: 'Klein', article: 'Felix_Klein'},
  {name: 'Poincaré', article: 'Henri_Poincaré'},
  {name: 'Hilbert', article: 'David_Hilbert'},
  {name: 'Hausdorff', article: 'Felix_Hausdorff'},
  {name: 'Whitney', article: 'Hassler_Whitney'},
];

export function findAgentName(name: string) {
  const normalized = normalizeName(name);
  return agentNames.find(person => normalizeName(person.name) === normalized);
}

export function randomAgentName(existingNames: Iterable<string>): string {
  const used = new Set([...existingNames].map(normalizeName));
  const candidates = agentNames.filter(
    person => !used.has(normalizeName(person.name)),
  );
  if (candidates.length)
    return candidates[Math.floor(Math.random() * candidates.length)]!.name;
  let index = 1;
  while (used.has(`agent ${index}`)) index++;
  return `Agent ${index}`;
}

function normalizeName(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}
