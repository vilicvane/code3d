import type {
  ConstraintSolver,
  Equation,
  Marker,
  Relation,
} from '@code3d/solver';
import {
  composeTransforms,
  halfTurnAroundX,
  identityRigidTransform,
  invertTransform,
  origin,
  rotateVector,
  rotation,
  translation,
  type RigidTransform,
  type Vec3,
} from './spatial.js';

type Anchor = Readonly<{
  kind: 'point' | 'line' | 'face' | 'frame';
  transform: RigidTransform;
}>;

export type BodyRelation = Readonly<{
  id: string;
  source: Anchor;
  target: Anchor & Readonly<{body: number}>;
  flipped: boolean;
  offset: Vec3 | undefined;
}>;

export type Body = Readonly<{
  name: string;
  relations: readonly BodyRelation[];
}>;

let solver: ConstraintSolver;

export function installConstraintSolver(instance: ConstraintSolver): void {
  solver = instance;
}

const pointEquations = [0, 1, 2].map(axis => equation('point', axis));
const orientationPreferences = [0, 1, 2].flatMap(i =>
  [0, 1, 2].map(j => equation('dot', i, j, +(i === j))),
);
const parallelEquations = [equation('dot', 1, 0), equation('dot', 1, 2)];
const fixedEquations = [
  ...pointEquations,
  ...parallelEquations,
  equation('dot', 2, 0),
];

export function solveBodies(
  bodies: readonly Body[],
): readonly RigidTransform[] {
  if (bodies.every(body => body.relations.length === 0)) {
    return bodies.map(() => identityRigidTransform);
  }

  const {fixed, seeds} = seedBodies(bodies);

  // Normalize linear coordinates so the same residual tolerance works across
  // model units and sizes. Angular equations are already dimensionless.
  const lengths = seeds.map(pose => Math.hypot(...pose.position));
  bodies.forEach(body =>
    body.relations.forEach(relation => {
      lengths.push(Math.hypot(...relation.source.transform.position));
      lengths.push(Math.hypot(...targetFrame(relation).position));
    }),
  );
  const scale =
    lengths.reduce((maximum, length) => Math.max(maximum, length), 0) || 1;
  const normalized = (pose: RigidTransform) => scalePosition(pose, 1 / scale);
  const relations = bodies.flatMap((body, index) =>
    body.relations.map(relation => compileRelation(index, relation, scale)),
  );
  const result = solver.solve({
    bodies: seeds.map((pose, index) => ({
      ...normalized(pose),
      fixed: fixed[index],
    })),
    relations,
  });
  if (result.status !== 'solved') {
    const unsatisfied = result.residuals
      .filter(residual => residual.error > 1e-7)
      .map(residual => residual.id);
    throw new Error(
      `Could not satisfy the geometric constraints${unsatisfied.length ? ` (${unsatisfied.join(', ')})` : ''}. ${result.message || 'The relations may conflict or need a different initial placement.'}`,
    );
  }
  const poses = result.poses.map(pose => scalePosition(pose, scale));
  validateDirections(bodies, poses);
  return poses;
}

function seedBodies(bodies: readonly Body[]): {
  fixed: boolean[];
  seeds: RigidTransform[];
} {
  const fixed = bodies.map(body => body.relations.length === 0);
  const seeds = bodies.map(() => identityRigidTransform);
  const visited = new Set<number>();
  const seed = (index: number): void => {
    if (visited.has(index)) return;
    visited.add(index);
    const relations = bodies[index].relations;
    relations.forEach(relation => seed(relation.target.body));
    if (relations.length) {
      seeds[index] = averagePose(
        relations.map(relation =>
          composeTransforms(
            composeTransforms(
              seeds[relation.target.body],
              preferredTargetFrame(relation),
            ),
            invertTransform(relation.source.transform),
          ),
        ),
      );
    }
  };
  bodies.forEach((_, index) => seed(index));

  // Ground one body in each otherwise floating connected component. Authored
  // models without relations already define fixed reference geometry.
  const neighbors = bodies.map(() => new Set<number>());
  bodies.forEach((body, index) =>
    body.relations.forEach(relation => {
      neighbors[index].add(relation.target.body);
      neighbors[relation.target.body].add(index);
    }),
  );
  visited.clear();
  bodies.forEach((_, start) => {
    if (visited.has(start)) return;
    const component = [start];
    visited.add(start);
    for (const index of component)
      for (const neighbor of neighbors[index]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          component.push(neighbor);
        }
      }
    if (!component.some(index => fixed[index])) {
      fixed[start] = true;
      seeds[start] = identityRigidTransform;
    }
  });

  return {fixed, seeds};
}

function compileRelation(
  index: number,
  relation: BodyRelation,
  scale: number,
): Relation {
  let i: Marker = {
    body: relation.target.body,
    ...scalePosition(targetFrame(relation), 1 / scale),
  };
  let j: Marker = {
    body: index,
    ...scalePosition(relation.source.transform, 1 / scale),
  };
  let source = relation.source.kind;
  let target = relation.target.kind;
  let preferences = isLinePlane(relation)
    ? [0, 1, 2].flatMap(i =>
        [0, 1, 2].map(j =>
          equation(
            'dot',
            i,
            j,
            [
              [0, -1, 0],
              [1, 0, 0],
              [0, 0, 1],
            ][i][j],
          ),
        ),
      )
    : orientationPreferences;
  // Projection equations use marker I's line direction or plane normal.
  const rank = {point: 0, line: 1, face: 2, frame: 3};
  if (rank[source] > rank[target]) {
    [i, j] = [j, i];
    [source, target] = [target, source];
    preferences = preferences.map(item => ({
      ...item,
      axisI: item.axisJ,
      axisJ: item.axisI,
    }));
  }
  let equations: readonly Equation[];
  if (target === 'frame') equations = fixedEquations;
  else if (target === 'point') equations = pointEquations;
  else if (target === 'line') {
    equations = [
      equation('distance', 0),
      equation('distance', 2),
      ...(source === 'line' ? parallelEquations : []),
    ];
  } else {
    equations = [
      equation('distance', 1),
      ...(source === 'face'
        ? parallelEquations
        : source === 'line'
          ? [equation('dot', 1, 1)]
          : []),
    ];
  }
  if (relation.offset && target !== 'point' && target !== 'frame') {
    equations = [...equations, ...pointEquations];
  }
  return {
    id: relation.id,
    i,
    j,
    equations,
    preferences: [...pointEquations, ...preferences],
  };
}

function validateDirections(
  bodies: readonly Body[],
  poses: readonly RigidTransform[],
): void {
  // Direction-cosine equations also admit the opposite angular branch. Faces
  // and complete frames have authored direction semantics which must survive.
  bodies.forEach((body, index) =>
    body.relations.forEach(relation => {
      const source = composeTransforms(poses[index], relation.source.transform);
      const target = composeTransforms(
        poses[relation.target.body],
        targetFrame(relation),
      );
      const complete =
        relation.source.kind === 'frame' || relation.target.kind === 'frame';
      const faces =
        relation.source.kind === 'face' && relation.target.kind === 'face';
      if (complete || faces) {
        const axes: Vec3[] = complete
          ? [
              [1, 0, 0],
              [0, 1, 0],
            ]
          : [[0, 1, 0]];
        for (const axis of axes) {
          const a = rotateVector(axis, source.quaternion),
            b = rotateVector(axis, target.quaternion);
          if (a.reduce((sum, value, i) => sum + value * b[i], 0) < 1 - 1e-7) {
            throw new Error(
              `Could not satisfy the direction of constraint ${relation.id} for ${body.name}.`,
            );
          }
        }
      }
    }),
  );
}

function targetFrame(relation: BodyRelation): RigidTransform {
  const {source, target, flipped} = relation;
  const lines = source.kind === 'line' && target.kind === 'line';
  const facing =
    lines !== flipped ? identityRigidTransform.quaternion : halfTurnAroundX;
  return composeTransforms(
    composeTransforms(target.transform, translation(relation.offset ?? origin)),
    rotation(facing),
  );
}

function isLinePlane({source, target}: BodyRelation): boolean {
  return (
    (source.kind === 'line' && target.kind === 'face') ||
    (source.kind === 'face' && target.kind === 'line')
  );
}

function preferredTargetFrame(relation: BodyRelation): RigidTransform {
  const target = targetFrame(relation);
  return isLinePlane(relation)
    ? composeTransforms(target, rotation([0, 0, Math.SQRT1_2, Math.SQRT1_2]))
    : target;
}

function averagePose(poses: readonly RigidTransform[]): RigidTransform {
  const first = poses[0].quaternion;
  const quaternion = [0, 0, 0, 0];
  const position: [number, number, number] = [0, 0, 0];
  for (const pose of poses) {
    const sign =
      pose.quaternion.reduce((sum, value, i) => sum + value * first[i], 0) < 0
        ? -1
        : 1;
    pose.quaternion.forEach((value, i) => (quaternion[i] += sign * value));
    pose.position.forEach((value, i) => (position[i] += value / poses.length));
  }
  const norm = Math.hypot(...quaternion);
  return {
    position,
    quaternion: [
      quaternion[0] / norm,
      quaternion[1] / norm,
      quaternion[2] / norm,
      quaternion[3] / norm,
    ],
  };
}

function scalePosition(pose: RigidTransform, scale: number): RigidTransform {
  const [x, y, z] = pose.position;
  return {
    position: [x * scale, y * scale, z * scale],
    quaternion: pose.quaternion,
  };
}

function equation(
  kind: Equation['kind'],
  axisI: number,
  axisJ = 0,
  value = 0,
): Equation {
  return {kind, axisI, axisJ, value};
}
