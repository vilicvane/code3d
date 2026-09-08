import type {SketchSolveProblem} from './sketch-solver.js';

export const sketchRelativePrecision = 1e-9;

/** Feature-local numeric budget, independent of screen/grid size or decimal
 * count. Native normalized steps and decimal cleanup use fractions of it.
 * An unrelated large object must not erase a deliberate small feature.
 */
export class SketchPrecision {
  readonly relative = sketchRelativePrecision;
  /** Reject invalid native output before the stricter local cleanup check. */
  readonly nativeAcceptance = this.relative * 100;
  readonly pointScales: readonly number[];
  readonly origin: readonly [number, number];
  readonly scale: number;
  readonly convergence: number;

  constructor(problem: SketchSolveProblem) {
    this.origin = problem.points[0]?.position ?? [0, 0];
    this.pointScales = problem.points.map((point, index) => {
      const sizes = [
        ...problem.lines
          .filter(line => line.includes(index))
          .map(([a, b]) =>
            Math.hypot(
              ...problem.points[a].position.map(
                (v, axis) => v - problem.points[b].position[axis],
              ),
            ),
          ),
        ...problem.circles.filter(c => c.center === index).map(c => c.radius),
        ...problem.arcs
          .filter(a => a.center === index || a.points.includes(index))
          .map(a => a.radius),
      ].filter(size => size > 0);
      return sizes.length
        ? Math.min(...sizes)
        : Math.max(...point.position.map(Math.abs)) || 1;
    });
    this.scale =
      Math.max(
        ...problem.points.flatMap(p =>
          p.position.map((v, axis) => Math.abs(v - this.origin[axis])),
        ),
        ...problem.circles.map(c => c.radius),
        ...problem.arcs.map(a => a.radius),
        ...problem.constraints.flatMap(c =>
          c.kind === 'length' || c.kind === 'radius' ? [c.value] : [],
        ),
      ) || 1;
    this.convergence = Math.max(
      Number.EPSILON * 8,
      ((Math.min(this.scale, ...this.pointScales) / this.scale) *
        this.relative) /
        10000,
    );
  }

  tolerance(scale: number, value = 0): number {
    return Math.max(
      scale * this.relative,
      Math.abs(value) * Number.EPSILON * 8,
    );
  }

  clean(value: number, scale: number, preferred: readonly number[]): number {
    const tolerance = this.tolerance(scale, value);
    for (const target of preferred)
      if (Math.abs(target - value) <= tolerance) return target;
    const rounding = Math.max(
      (scale * this.relative) / 100,
      Math.abs(value) * Number.EPSILON * 8,
    );
    if (Math.abs(value) <= rounding) return 0;
    for (let digits = 1; digits < 16; digits++) {
      const rounded = Number(value.toPrecision(digits));
      if (Math.abs(rounded - value) <= rounding) return rounded;
    }
    return value;
  }
}
