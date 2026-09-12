import {
  addVectors,
  composeTransforms,
  identityRigidTransform,
  invertTransform,
  negateVector,
  origin,
  rotateVector,
  rotation,
  type Quaternion,
  type RigidTransform,
  type Vec3,
} from './spatial.js';

export type Bounds = readonly [minimum: Vec3, maximum: Vec3];
export type ExternalRotation =
  | Readonly<{axis: RigidTransform; body: number; angle: number}>
  | Readonly<{
      point: Vec3;
      body: number;
      rotation: Quaternion;
      displacement: Vec3;
    }>;
export type BodyRotation = Readonly<{local: RigidTransform}> | ExternalRotation;

/** External center relative to its owning body; point references retain self's axes. */
export function externalRotationFrame(
  action: ExternalRotation,
  self: Quaternion,
  reference: Quaternion,
  inverse = false,
): {center: Vec3; quaternion: Quaternion} {
  if ('axis' in action) {
    const axis = composeTransforms(rotation(reference), action.axis);
    return {
      center: axis.position,
      quaternion: axisRotation(axis, inverse ? -action.angle : action.angle)
        .quaternion,
    };
  }
  const local = inverse
    ? invertTransform(rotation(action.rotation))
    : rotation(action.rotation);
  const before = inverse
    ? composeTransforms(rotation(self), local)
    : rotation(self);
  return {
    center: addVectors(
      rotateVector(action.point, reference),
      rotateVector(action.displacement, before.quaternion),
    ),
    quaternion: composeTransforms(
      composeTransforms(before, local),
      invertTransform(before),
    ).quaternion,
  };
}

export type BodyAction = BodyRotation | Readonly<{offset: Vec3}>;
export type BodyRelation = Readonly<{
  id: string;
  source: Readonly<{
    body: number;
    key: string;
    bounds: (orientation: Quaternion) => Bounds;
  }>;
  target: Readonly<{body: number; transform: RigidTransform; facing: 1 | -1}>;
}>;

export type Body = Readonly<{
  name: string;
  relations: readonly BodyRelation[];
  /** Pose inherited from the preceding placement segment. */
  initial?: RigidTransform;
  /** Independent actions apply after the joint constraint solution. */
  transformations?: readonly BodyAction[];
}>;
type AffinePoint = {constant: Vec3; columns: Vec3[]};
type AffinePose = {position: AffinePoint; quaternion: Quaternion};
type Equation = {id: string; coefficients: number[]; value: number};
const axes: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const dot = (a: Vec3, b: Vec3): number =>
  a.reduce((sum, x, i) => sum + x * b[i], 0);
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/** A rotation about a positioned, directed line. Angles are in degrees. */
export function axisRotation(
  axis: RigidTransform,
  angle: number,
): RigidTransform {
  const direction = rotateVector([0, 1, 0], axis.quaternion);
  const half = (angle * Math.PI) / 360;
  const q: Quaternion = [...scale(direction, Math.sin(half)), Math.cos(half)];
  return {
    quaternion: q,
    position: addVectors(
      axis.position,
      negateVector(rotateVector(axis.position, q)),
    ),
  };
}

/** Explicit rotations determine orientation; contacts solve translations only. */
export function solveBodies(
  bodies: readonly Body[],
): readonly RigidTransform[] {
  const seeds = new Map<number, RigidTransform>();
  const visiting = new Set<number>();
  const seed = (index: number): RigidTransform => {
    const known = seeds.get(index);
    if (known) return known;
    if (visiting.has(index))
      throw new Error(
        'Cyclic external rotation axes cannot determine an authored orientation.',
      );
    visiting.add(index);
    let pose = bodies[index].initial ?? identityRigidTransform;
    for (const action of bodies[index].transformations ?? []) {
      if ('offset' in action) continue;
      pose =
        'local' in action
          ? composeTransforms(pose, action.local)
          : 'point' in action
            ? composeTransforms(pose, rotation(action.rotation))
            : composeTransforms(
                axisRotation(
                  composeTransforms(seed(action.body), action.axis),
                  action.angle,
                ),
                pose,
              );
    }
    visiting.delete(index);
    seeds.set(index, pose);
    return pose;
  };
  bodies.forEach((_, index) => seed(index));
  const variables = bodies.flatMap((body, index) =>
    body.relations.length ? [index] : [],
  );
  const dimension = variables.length * 3;
  const positioned = new Map<number, AffinePose>();
  const positionBody = (index: number): AffinePose => {
    const known = positioned.get(index);
    if (known) return known;
    let pose: AffinePose = {
      quaternion: (bodies[index].initial ?? identityRigidTransform).quaternion,
      position: {
        constant: (bodies[index].initial ?? identityRigidTransform).position,
        columns: variables.flatMap(body =>
          axes.map(axis => (body === index ? axis : origin)),
        ),
      },
    };
    for (const action of bodies[index].transformations ?? []) {
      if ('offset' in action) {
        pose = {...pose, position: shiftPoint(pose.position, action.offset)};
      } else if ('local' in action) {
        pose = {
          position: shiftPoint(
            pose.position,
            rotateVector(action.local.position, pose.quaternion),
          ),
          quaternion: composeTransforms(
            rotation(pose.quaternion),
            rotation(action.local.quaternion),
          ).quaternion,
        };
      } else {
        const axisPose = positionBody(action.body);
        const {center, quaternion: q} = externalRotationFrame(
          action,
          pose.quaternion,
          axisPose.quaternion,
        );
        const axisPoint = shiftPoint(axisPose.position, center);
        const rotatedAxis = rotatePoint(axisPoint, q);
        pose = {
          position: addPoints(
            rotatePoint(pose.position, q),
            addPoints(axisPoint, {
              constant: negateVector(rotatedAxis.constant),
              columns: rotatedAxis.columns.map(negateVector),
            }),
          ),
          quaternion: composeTransforms(rotation(q), rotation(pose.quaternion))
            .quaternion,
        };
      }
    }
    positioned.set(index, pose);
    return pose;
  };
  const poses = bodies.map((_, index) => positionBody(index));
  const equations: Equation[] = [];
  const preferences = new Map<string, Equation>();
  bodies.forEach((body, owner) =>
    body.relations.forEach(relation => {
      // Every contact constrains the joint result before independent transforms.
      const baseline = undoActions(
        poses[owner],
        body.transformations ?? [],
        poses,
      );
      for (let axis = 0; axis < 3; axis++) {
        const preference = {
          id: relation.id,
          coefficients: baseline.position.columns.map(column => column[axis]),
          value:
            (body.initial?.position[axis] ?? 0) -
            baseline.position.constant[axis],
        };
        preferences.set(
          JSON.stringify([preference.coefficients, preference.value]),
          preference,
        );
      }
      const source =
        relation.source.body === owner ? baseline : poses[relation.source.body];
      const target =
        relation.target.body === owner ? baseline : poses[relation.target.body];
      const targetFrame = composeTransforms(
        rotation(target.quaternion),
        relation.target.transform,
      );
      const inverseFrame = invertTransform(rotation(targetFrame.quaternion));
      const relativeOrientation = composeTransforms(
        inverseFrame,
        rotation(source.quaternion),
      ).quaternion;
      const bounds = relation.source.bounds(relativeOrientation);
      const center: Vec3 = [
        (bounds[0][0] + bounds[1][0]) / 2,
        bounds[relation.target.facing === 1 ? 0 : 1][1],
        (bounds[0][2] + bounds[1][2]) / 2,
      ];
      const sourcePoint = shiftPoint(
        source.position,
        rotateVector(center, targetFrame.quaternion),
      );
      const targetPoint = shiftPoint(target.position, targetFrame.position);
      for (const localAxis of [axes[1]]) {
        const normal = rotateVector(localAxis, targetFrame.quaternion);
        equations.push({
          id: relation.id,
          coefficients: sourcePoint.columns.map((column, i) =>
            dot(
              addVectors(column, negateVector(targetPoint.columns[i])),
              normal,
            ),
          ),
          value: dot(
            addVectors(
              targetPoint.constant,
              negateVector(sourcePoint.constant),
            ),
            normal,
          ),
        });
      }
    }),
  );
  const solution = solveTranslations(
    equations,
    [...preferences.values()],
    dimension,
  );
  return poses.map(pose => ({
    quaternion: pose.quaternion,
    position: pose.position.columns.reduce(
      (point, column, i) => addVectors(point, scale(column, solution[i])),
      pose.position.constant,
    ),
  }));
}

function shiftPoint(point: AffinePoint, offset: Vec3): AffinePoint {
  return {...point, constant: addVectors(point.constant, offset)};
}
function rotatePoint(point: AffinePoint, quaternion: Quaternion): AffinePoint {
  return {
    constant: rotateVector(point.constant, quaternion),
    columns: point.columns.map(column => rotateVector(column, quaternion)),
  };
}
function addPoints(left: AffinePoint, right: AffinePoint): AffinePoint {
  return {
    constant: addVectors(left.constant, right.constant),
    columns: left.columns.map((column, i) =>
      addVectors(column, right.columns[i]),
    ),
  };
}

function undoActions(
  pose: AffinePose,
  actions: readonly BodyAction[],
  poses: readonly AffinePose[],
): AffinePose {
  for (const action of [...actions].reverse()) {
    if ('offset' in action) {
      pose = {
        ...pose,
        position: shiftPoint(pose.position, negateVector(action.offset)),
      };
    } else if ('local' in action) {
      const inverse = invertTransform(action.local);
      pose = {
        position: shiftPoint(
          pose.position,
          rotateVector(inverse.position, pose.quaternion),
        ),
        quaternion: composeTransforms(
          rotation(pose.quaternion),
          rotation(inverse.quaternion),
        ).quaternion,
      };
    } else {
      const axisPose = poses[action.body];
      const {center, quaternion: q} = externalRotationFrame(
        action,
        pose.quaternion,
        axisPose.quaternion,
        true,
      );
      const axisPoint = shiftPoint(axisPose.position, center);
      const rotatedAxis = rotatePoint(axisPoint, q);
      pose = {
        position: addPoints(
          rotatePoint(pose.position, q),
          addPoints(axisPoint, {
            constant: negateVector(rotatedAxis.constant),
            columns: rotatedAxis.columns.map(negateVector),
          }),
        ),
        quaternion: composeTransforms(rotation(q), rotation(pose.quaternion))
          .quaternion,
      };
    }
  }
  return pose;
}

/** Solve Ax=b, then minimize contact-stage displacement in its nullspace. */
export function solveTranslations(
  equations: readonly Equation[],
  preferences: readonly Equation[],
  dimension: number,
): number[] {
  const basis: {row: number[]; value: number}[] = [];
  const magnitude = Math.max(
    1,
    ...equations.map(equation => Math.abs(equation.value)),
  );
  for (const equation of equations) {
    const row = [...equation.coefficients];
    let value = equation.value;
    for (let pass = 0; pass < 2; pass++) {
      for (const previous of basis) {
        const projection = row.reduce(
          (sum, x, i) => sum + x * previous.row[i],
          0,
        );
        row.forEach((x, i) => {
          row[i] = x - projection * previous.row[i];
        });
        value -= projection * previous.value;
      }
    }
    const length = Math.hypot(...row);
    if (length < 1e-10) {
      if (Math.abs(value) > 1e-7 * magnitude)
        throw new Error(
          `Conflicting bound positions (${equation.id}). on() only translates; adjust the position or an explicit rotation.`,
        );
    } else basis.push({row: row.map(x => x / length), value: value / length});
  }
  const particular = Array.from({length: dimension}, (_, i) =>
    basis.reduce((sum, entry) => sum + entry.row[i] * entry.value, 0),
  );
  const nullspace: number[][] = [];
  for (let axis = 0; axis < dimension; axis++) {
    const vector = Array.from({length: dimension}, (_, i) => +(axis === i));
    for (let pass = 0; pass < 2; pass++)
      for (const row of [...basis.map(entry => entry.row), ...nullspace]) {
        const projection = vector.reduce(
          (sum, value, i) => sum + value * row[i],
          0,
        );
        vector.forEach((value, i) => {
          vector[i] = value - projection * row[i];
        });
      }
    const length = Math.hypot(...vector);
    if (length > 1e-10) nullspace.push(vector.map(value => value / length));
  }
  if (!nullspace.length) return particular;
  const project = (row: readonly number[], column: readonly number[]) =>
    row.reduce((sum, value, i) => sum + value * column[i], 0);
  const columns = nullspace.map(vector =>
    preferences.map(preference => project(preference.coefficients, vector)),
  );
  const residual = preferences.map(
    preference =>
      preference.value - project(preference.coefficients, particular),
  );
  const orthogonal: number[][] = [];
  const upper = columns.map(() => columns.map(() => 0));
  const rhs: number[] = [];
  columns.forEach((column, index) => {
    const vector = [...column];
    for (let pass = 0; pass < 2; pass++)
      orthogonal.forEach((previous, i) => {
        const projection = project(previous, vector);
        upper[i][index] += projection;
        vector.forEach((value, j) => {
          vector[j] = value - projection * previous[j];
        });
      });
    const length = Math.hypot(...vector);
    upper[index][index] = length;
    const normalized = vector.map(value => value / length);
    orthogonal.push(normalized);
    rhs.push(project(normalized, residual));
  });
  const free = [...rhs];
  for (let i = free.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < free.length; j++) free[i] -= upper[i][j] * free[j];
    free[i] /= upper[i][i];
  }
  return particular.map(
    (value, i) =>
      value +
      nullspace.reduce((sum, vector, j) => sum + vector[i] * free[j], 0),
  );
}
