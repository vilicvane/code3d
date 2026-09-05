export type Pose = Readonly<{
  position: readonly [number, number, number];
  quaternion: readonly [number, number, number, number];
}>;

export type Marker = Pose & Readonly<{body: number}>;

/** Axes are zero based. Distance is measured in marker I's coordinate frame. */
export type Equation = Readonly<{
  kind: 'point' | 'distance' | 'dot';
  axisI: number;
  axisJ: number;
  value: number;
}>;

export type Relation = Readonly<{
  id: string;
  i: Marker;
  j: Marker;
  equations: readonly Equation[];
  /** Least squares preferences, subordinate to every hard equation. */
  preferences: readonly Equation[];
}>;

export type Problem = Readonly<{
  bodies: readonly (Pose & Readonly<{fixed: boolean}>)[];
  relations: readonly Relation[];
}>;

export type Solution = Readonly<{
  status: 'solved' | 'unsatisfied' | 'failed';
  poses: readonly Pose[];
  residuals: readonly Readonly<{id: string; error: number}>[];
  message: string;
}>;

export interface ConstraintSolver {
  solve(problem: Problem): Solution;
}

export default function initialize(options?: {
  wasmBinary?: Uint8Array;
  locateFile?: (path: string) => string;
  print?: (message: string) => void;
  printErr?: (message: string) => void;
}): Promise<ConstraintSolver>;
