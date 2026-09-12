/** The rendered grid, legend and coarse translation snap share this interval. */
export const majorGridCells = 5;

/** Scale is measured in CSS pixels per model unit; minor cells span 8–20px. */
export function gridStep(scale: number): number {
  const minimum = 8 / scale;
  const decade = 10 ** Math.floor(Math.log10(minimum));
  return [1, 2, 5, 10].find(value => value * decade >= minimum)! * decade;
}

export function formatGridStep(step: number): string {
  return step >= 1e6 || step < 1e-3
    ? step.toExponential().replace('e+', 'e')
    : String(Number(step.toPrecision(12)));
}
