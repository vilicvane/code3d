import type {SketchPosition} from './sketch.js';
import type {
  SketchContact,
  SketchSolveCurve,
  SketchSolveProblem,
} from './sketch-solve-model.js';

const curveKey = (curve: SketchSolveCurve) => `${curve.kind}:${curve.index}`;

/** Authored membership and structural endpoints, independent of current coordinates.
 * Explicit coincidence joins membership queries, never persistent point identity. */
export class SketchContactAnalysis {
  readonly contacts: readonly SketchContact[];
  readonly pointOn: readonly SketchContact[];
  private readonly members = new Map<string, Set<number>>();

  constructor(problem: SketchSolveProblem) {
    const representatives = problem.points.map((_, i) => i);
    const representative = (point: number): number => {
      while (representatives[point] !== point) point = representatives[point];
      return point;
    };
    for (const constraint of problem.constraints) {
      if (constraint.kind !== 'coincident') continue;
      const [a, b] = constraint.points.map(representative);
      representatives[Math.max(a, b)] = Math.min(a, b);
    }
    const canonical = representatives.map((_, i) => representative(i));
    const contacts: SketchContact[] = [];
    const register = (contact: SketchContact) => {
      contacts.push(contact);
      const key = curveKey(contact.curve);
      const members = this.members.get(key) ?? new Set<number>();
      members.add(canonical[contact.point]);
      this.members.set(key, members);
    };
    problem.lines.forEach((points, index) =>
      points.forEach(point =>
        register({
          point,
          curve: {kind: 'line', index},
          sources: [],
          structural: true,
        }),
      ),
    );
    problem.arcs.forEach((arc, index) =>
      arc.points.forEach(point =>
        register({
          point,
          curve: {kind: 'arc', index},
          sources: [],
          structural: true,
        }),
      ),
    );
    const pointOn: SketchContact[] = [];
    problem.constraints.forEach((constraint, source) => {
      if (constraint.kind === 'pointOn') {
        const contact: SketchContact = {
          point: constraint.point,
          curve: constraint.curve,
          sources: [source],
          structural: false,
        };
        pointOn.push(contact);
        register(contact);
      } else if (constraint.kind === 'midpoint') {
        const [point, a, b] = constraint.points.map(i => canonical[i]);
        problem.lines.forEach((ends, index) => {
          const [start, end] = ends.map(i => canonical[i]);
          if ((a === start && b === end) || (b === start && a === end))
            register({
              point,
              curve: {kind: 'line', index},
              sources: [source],
              structural: true,
            });
        });
      }
    });
    this.contacts = contacts;
    this.pointOn = pointOn;
  }

  sharedPoint(
    curves: readonly [SketchSolveCurve, SketchSolveCurve],
  ): number | undefined {
    const [a, b] = curves.map(curve => this.members.get(curveKey(curve)));
    if (!a || !b) return;
    return [...a].sort((x, y) => x - y).find(point => b.has(point));
  }
}

/** A fact records why a value is known; seed inferences never become native locks. */
export type SketchParameterFact = Readonly<{
  value: number;
  origin: 'lock' | 'dimension' | 'structure' | 'relation';
  sources: readonly number[];
}>;

export class SketchParameterAnalysis {
  private readonly coordinates: readonly (readonly (
    SketchParameterFact | undefined
  )[])[];
  private readonly structuralRadii = new Map<string, SketchParameterFact>();
  private readonly seedRadii = new Map<string, SketchParameterFact>();

  constructor(problem: SketchSolveProblem) {
    this.coordinates = problem.points.map((point, index) =>
      [0, 1].map(axis => {
        if (point.locked[axis])
          return {
            value: point.position[axis],
            origin: 'lock' as const,
            sources: [],
          };
        const source = problem.constraints.findIndex(
          c => c.kind === 'fixed' && c.point === index,
        );
        const fixed = problem.constraints[source];
        if (fixed?.kind === 'fixed')
          return {
            value: fixed.position[axis],
            origin: 'dimension' as const,
            sources: [source],
          };
        const coordinateSource = problem.constraints.findIndex(
          c => c.kind === (axis === 0 ? 'x' : 'y') && c.point === index,
        );
        const coordinate = problem.constraints[coordinateSource];
        if (coordinate && 'value' in coordinate)
          return {
            value: coordinate.value,
            origin: 'dimension' as const,
            sources: [coordinateSource],
          };
        return undefined;
      }),
    );
    for (const kind of ['circle', 'arc'] as const)
      (kind === 'circle' ? problem.circles : problem.arcs).forEach(
        (curve, index) => {
          const key = curveKey({kind, index});
          let fact: SketchParameterFact | undefined;
          if (curve.locked)
            fact = {value: curve.radius, origin: 'lock', sources: []};
          else if (kind === 'arc') {
            const arc = problem.arcs[index];
            const center = this.position(arc.center);
            const endpoint = arc.points.find(point => this.position(point));
            if (center && endpoint !== undefined) {
              const position = this.position(endpoint)!;
              fact = {
                value: Math.hypot(
                  position[0] - center[0],
                  position[1] - center[1],
                ),
                origin: 'structure',
                sources: [
                  ...new Set(
                    [arc.center, endpoint].flatMap(point =>
                      this.coordinates[point].flatMap(
                        fact => fact?.sources ?? [],
                      ),
                    ),
                  ),
                ],
              };
            }
          }
          if (fact) this.structuralRadii.set(key, fact);
          const source = problem.constraints.findIndex(
            c => c.kind === 'radius' && c.curve === kind && c.index === index,
          );
          const dimension = problem.constraints[source];
          // Authored dimensions guide initial values even if endpoints are also known.
          // Native equations still diagnose inconsistent endpoint/dimension facts.
          const seed = curve.locked
            ? fact
            : dimension?.kind === 'radius'
              ? {
                  value: dimension.value,
                  origin: 'dimension' as const,
                  sources: [source],
                }
              : fact;
          if (seed) this.seedRadii.set(key, seed);
        },
      );
    for (let changed = true; changed;) {
      changed = false;
      problem.constraints.forEach((constraint, source) => {
        if (constraint.kind !== 'equalRadius') return;
        const [a, b] = constraint.curves.map(curveKey);
        const first = this.seedRadii.get(a),
          second = this.seedRadii.get(b);
        const transfer = (key: string, fact: SketchParameterFact) => {
          this.seedRadii.set(key, {
            value: fact.value,
            origin: 'relation',
            sources: [...new Set([...fact.sources, source])],
          });
          changed = true;
        };
        if (first && !second) transfer(b, first);
        else if (second && !first) transfer(a, second);
      });
    }
  }

  coordinate(point: number, axis: number): SketchParameterFact | undefined {
    return this.coordinates[point][axis];
  }

  position(point: number): SketchPosition | undefined {
    const [x, y] = this.coordinates[point];
    return x && y ? [x.value, y.value] : undefined;
  }

  /** Only locks and arc structure justify constant native equations. */
  structuralRadius(curve: SketchSolveCurve): SketchParameterFact | undefined {
    return this.structuralRadii.get(curveKey(curve));
  }

  /** May depend on radius/equalRadius equations which must remain in the solve. */
  seedRadius(curve: SketchSolveCurve): SketchParameterFact | undefined {
    return this.seedRadii.get(curveKey(curve));
  }
}
