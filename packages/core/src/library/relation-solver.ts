import {
  axisRotation,
  solveBodies as solveBoundBodies,
  type BodyRelation as BoundRelation,
  type BodyRotation,
} from './bound-solver.js';
import {
  alignmentResidual,
  cross,
  dot,
  nearestPoint,
  orderedGeometry,
  perpendicular,
  reject,
  scale,
  subtract,
  transformGeometry,
  unit,
  validateAlignment,
  type AlignmentGeometry,
} from './alignment-geometry.js';
import {
  addVectors,
  composeTransforms,
  identityRigidTransform,
  invertTransform,
  origin,
  rotateVector,
  rotation,
  translation,
  type Quaternion,
  type RigidTransform,
  type Vec3,
} from './spatial.js';

export {axisRotation, type BodyRotation};
type AlignEndpoint = Readonly<{
  body: number;
  geometry: AlignmentGeometry;
  transform: RigidTransform;
}>;
type AlignRelation = Readonly<{
  kind: 'align';
  id: string;
  source: AlignEndpoint;
  target: AlignEndpoint;
  offset: Vec3 | undefined;
  rotations: readonly BodyRotation[];
}>;
type Relation = (BoundRelation & {kind: 'on'}) | AlignRelation;
export type Body = Readonly<{name: string; relations: readonly Relation[]}>;

/** Authored actions apply after satisfying the relation, about self or an external axis. */
export function beforeRelation(
  pose: RigidTransform,
  relation: Pick<Relation, 'kind' | 'rotations' | 'offset' | 'target'>,
  poses: readonly RigidTransform[],
  owner: number,
): RigidTransform {
  for (const action of [...relation.rotations].reverse())
    pose =
      'local' in action
        ? composeTransforms(pose, invertTransform(action.local))
        : composeTransforms(
            axisRotation(
              composeTransforms(poses[action.body], action.axis),
              -action.angle,
            ),
            pose,
          );
  if (relation.kind === 'align' && relation.offset) {
    const target =
      relation.target.body === owner ? pose : poses[relation.target.body];
    const frame = composeTransforms(target, relation.target.transform);
    pose = {
      ...pose,
      position: subtract(
        pose.position,
        rotateVector(relation.offset, frame.quaternion),
      ),
    };
  }
  return pose;
}

function afterRelation(
  pose: RigidTransform,
  relation: Relation,
  poses: readonly RigidTransform[],
  owner: number,
): RigidTransform {
  if (relation.kind === 'align' && relation.offset) {
    const target =
      relation.target.body === owner ? pose : poses[relation.target.body];
    pose = {
      ...pose,
      position: addVectors(
        pose.position,
        rotateVector(
          relation.offset,
          composeTransforms(target, relation.target.transform).quaternion,
        ),
      ),
    };
  }
  for (const action of relation.rotations)
    pose =
      'local' in action
        ? composeTransforms(pose, action.local)
        : composeTransforms(
            axisRotation(
              composeTransforms(poses[action.body], action.axis),
              action.angle,
            ),
            pose,
          );
  return pose;
}

function directionRotation(from: Vec3, to: Vec3): Quaternion {
  const product = dot(from, to);
  if (product < -1 + 1e-10) return [...perpendicular(from), 0];
  const vector = cross(from, to),
    w = 1 + product,
    length = Math.hypot(...vector, w);
  return [...scale(vector, 1 / length), w / length];
}

/** A geometric seed resolves antipodal stationary points without constraining free modes. */
function alignmentSeed(
  source: AlignmentGeometry,
  target: AlignmentGeometry,
): RigidTransform {
  if (alignmentResidual(source, target).every(value => Math.abs(value) < 1e-8))
    return identityRigidTransform;
  let q: Quaternion = [0, 0, 0, 1];
  const direction = (g: AlignmentGeometry) =>
    'normal' in g ? g.normal : 'direction' in g ? g.direction : undefined;
  const from = direction(source),
    to = direction(target);
  if (from && to) {
    const [a, b] = orderedGeometry(source, target);
    if (a.kind === 'line' && b.kind === 'plane') {
      const projected = reject(a.direction, b.normal);
      const tangent =
        Math.hypot(...projected) > 1e-10
          ? unit(projected)
          : perpendicular(b.normal);
      const projectedNormal = reject(b.normal, a.direction);
      q =
        source === a
          ? directionRotation(a.direction, tangent)
          : directionRotation(
              b.normal,
              Math.hypot(...projectedNormal) > 1e-10
                ? unit(projectedNormal)
                : perpendicular(a.direction),
            );
    } else {
      const sameDirection =
        source.kind === target.kind &&
        ['line', 'circle', 'ellipse', 'plane'].includes(source.kind);
      q = directionRotation(
        from,
        !sameDirection && dot(from, to) < 0 ? scale(to, -1) : to,
      );
    }
  }
  if (source.kind === 'ellipse' && target.kind === 'ellipse') {
    const major = rotateVector(source.major, q);
    q = composeTransforms(
      rotation(
        directionRotation(
          major,
          dot(major, target.major) < 0 ? scale(target.major, -1) : target.major,
        ),
      ),
      rotation(q),
    ).quaternion;
  } else if (source.kind === 'ellipse' && target.kind === 'cylinder') {
    const major = rotateVector(source.major, q),
      normal = rotateVector(source.normal, q),
      ratio = source.minorRadius / source.radius;
    q = composeTransforms(
      rotation(
        directionRotation(
          normal,
          addVectors(
            scale(normal, ratio),
            scale(major, Math.sqrt(1 - ratio * ratio)),
          ),
        ),
      ),
      rotation(q),
    ).quaternion;
  } else if (source.kind === 'cylinder' && target.kind === 'ellipse') {
    const ratio = target.minorRadius / target.radius;
    const axis = addVectors(
      scale(target.normal, ratio),
      scale(target.major, Math.sqrt(1 - ratio * ratio)),
    );
    q = directionRotation(
      source.direction,
      dot(source.direction, axis) < 0 ? scale(axis, -1) : axis,
    );
  }
  const pose = rotation(q);
  const moved = transformGeometry(source, pose);
  let shift: Vec3;
  if (source.kind === 'point')
    shift = subtract(nearestPoint(source.point, target), source.point);
  else if (target.kind === 'point')
    shift = subtract(target.point, nearestPoint(target.point, moved));
  else if (target.kind === 'plane')
    shift = subtract(nearestPoint(moved.point, target), moved.point);
  else if (source.kind === 'plane')
    shift = subtract(target.point, nearestPoint(target.point, moved));
  else if (source.kind === 'line' && target.kind === 'cylinder')
    shift = subtract(nearestPoint(moved.point, target), moved.point);
  else if (target.kind === 'line' && source.kind === 'cylinder')
    shift = subtract(target.point, nearestPoint(target.point, moved));
  else if (moved.kind === 'circle' && target.kind === 'sphere')
    shift = subtract(
      addVectors(
        target.point,
        scale(
          moved.normal,
          Math.sqrt(Math.max(0, target.radius ** 2 - moved.radius ** 2)) *
            (dot(subtract(moved.point, target.point), moved.normal) < 0
              ? -1
              : 1),
        ),
      ),
      moved.point,
    );
  else if (moved.kind === 'sphere' && target.kind === 'circle')
    shift = subtract(
      addVectors(
        target.point,
        scale(
          target.normal,
          Math.sqrt(Math.max(0, moved.radius ** 2 - target.radius ** 2)) *
            (dot(subtract(moved.point, target.point), target.normal) < 0
              ? -1
              : 1),
        ),
      ),
      moved.point,
    );
  else if ('direction' in target)
    shift = reject(subtract(target.point, moved.point), target.direction);
  else if ('direction' in moved)
    shift = reject(subtract(target.point, moved.point), moved.direction);
  else shift = subtract(target.point, moved.point);
  return {...pose, position: addVectors(pose.position, shift)};
}

/** Exact linear specialization for bound-only assemblies; geometric relations solve joint rigid poses. */
export function solveBodies(
  bodies: readonly Body[],
): readonly RigidTransform[] {
  if (bodies.every(body => body.relations.every(r => r.kind === 'on')))
    return solveBoundBodies(
      bodies as readonly {
        name: string;
        relations: readonly (BoundRelation & {kind: 'on'})[];
      }[],
    );
  for (const body of bodies)
    for (const relation of body.relations)
      if (relation.kind === 'align')
        validateAlignment(relation.source.geometry, relation.target.geometry);
  const active = bodies.flatMap((body, i) =>
    body.relations.length ? [i] : [],
  );
  const flexible = bodies.map(body =>
    body.relations.some(r => r.kind === 'align'),
  );
  // Stable ordering and deduplication keep repeated conditions from biasing seeds.
  const relations = bodies.flatMap((body, owner) =>
    body.relations.map(relation => ({owner, relation})),
  );
  const key = ({owner, relation}: (typeof relations)[number]) =>
    JSON.stringify({owner, relation: {...relation, id: undefined}});
  const unique = [
    ...new Map(relations.map(entry => [key(entry), entry])).entries(),
  ]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entry]) => entry);
  let poses = bodies.map(() => identityRigidTransform);
  for (const owner of active) {
    const authored =
      unique.find(
        entry => entry.owner === owner && entry.relation.rotations.length,
      )?.relation ??
      unique.find(
        entry =>
          entry.owner === owner &&
          entry.relation.kind === 'align' &&
          entry.relation.offset,
      )?.relation;
    if (authored)
      poses[owner] = afterRelation(
        identityRigidTransform,
        authored,
        poses,
        owner,
      );
  }
  for (const {owner, relation} of unique) {
    if (relation.kind !== 'align') continue;
    const sourceSelf = relation.source.body === owner;
    if (relation.target.body === relation.source.body) continue;
    const baseline = beforeRelation(poses[owner], relation, poses, owner);
    const source = transformGeometry(
        relation.source.geometry,
        relation.source.body === owner ? baseline : poses[relation.source.body],
      ),
      target = transformGeometry(
        relation.target.geometry,
        relation.target.body === owner ? baseline : poses[relation.target.body],
      );
    const seed = sourceSelf
      ? alignmentSeed(source, target)
      : alignmentSeed(target, source);
    poses[owner] = afterRelation(
      composeTransforms(seed, baseline),
      relation,
      poses,
      owner,
    );
  }
  const geometryScale = Math.max(
    1,
    ...unique.flatMap(({relation: r}) =>
      r.kind === 'align'
        ? [r.source.geometry, r.target.geometry].map(g =>
            'radius' in g ? g.radius : 1,
          )
        : [],
    ),
  );
  const variables = active.flatMap(body =>
    Array.from({length: 6}, (_, axis) => ({body, axis})),
  );
  const residual = (candidate: readonly RigidTransform[]): number[] => [
    ...unique.flatMap(({owner, relation: r}) => {
      const baseline = beforeRelation(candidate[owner], r, candidate, owner);
      const source =
          r.source.body === owner ? baseline : candidate[r.source.body],
        target = r.target.body === owner ? baseline : candidate[r.target.body];
      if (r.kind === 'align')
        return alignmentResidual(
          transformGeometry(r.source.geometry, source),
          transformGeometry(r.target.geometry, target),
        );
      const frame = composeTransforms(target, r.target.transform);
      const relative = composeTransforms(
        invertTransform(rotation(frame.quaternion)),
        rotation(source.quaternion),
      );
      const bounds = r.source.bounds(relative.quaternion);
      const center: Vec3 = [
        (bounds[0][0] + bounds[1][0]) / 2,
        bounds[r.target.facing === 1 ? 0 : 1][1],
        (bounds[0][2] + bounds[1][2]) / 2,
      ];
      const a = addVectors(
        source.position,
        rotateVector(center, frame.quaternion),
      );
      const b = composeTransforms(
        frame,
        translation(r.offset ?? origin),
      ).position;
      const delta = rotateVector(
        subtract(a, b),
        invertTransform(frame).quaternion,
      );
      return r.offset ? [...delta] : [delta[1]];
    }),
    ...active.flatMap(owner => {
      if (flexible[owner]) return [];
      const rotations = bodies[owner].relations.filter(r => r.rotations.length);
      return rotations.length
        ? rotations.flatMap(r =>
            beforeRelation(
              candidate[owner],
              r,
              candidate,
              owner,
            ).quaternion.slice(0, 3),
          )
        : candidate[owner].quaternion.slice(0, 3);
    }),
  ];
  const perturb = (
    base: readonly RigidTransform[],
    steps: readonly number[],
  ) => {
    const change = bodies.map(() => [0, 0, 0, 0, 0, 0]);
    variables.forEach(({body, axis}, i) => {
      change[body][axis] = steps[i];
    });
    return base.map((pose, i) => {
      const d = change[i],
        v: Vec3 = [d[3], d[4], d[5]],
        angle = Math.hypot(...v);
      const q: Quaternion =
        angle < 1e-14
          ? [0, 0, 0, 1]
          : [...scale(v, Math.sin(angle / 2) / angle), Math.cos(angle / 2)];
      return {
        position: addVectors(
          pose.position,
          scale([d[0], d[1], d[2]], geometryScale),
        ),
        quaternion: composeTransforms(rotation(q), rotation(pose.quaternion))
          .quaternion,
      };
    });
  };
  let values = residual(poses),
    damping = 1e-5;
  const norm = (values: readonly number[]) =>
    values.reduce((sum, x) => sum + x * x, 0);
  for (let iteration = 0; iteration < 160; iteration++) {
    if (values.every(v => Math.abs(v) < 1e-8)) return poses;
    const h = 1e-6;
    const columns = variables.map((_, i) => {
      const shifted = residual(
        perturb(
          poses,
          variables.map((_, j) => (i === j ? h : 0)),
        ),
      );
      return values.map((v, j) => (shifted[j] - v) / h);
    });
    const multiply = (a: readonly number[], b: readonly number[]) =>
      a.reduce((sum, x, i) => sum + x * b[i], 0);
    const matrix = columns.map((a, i) => [
      ...columns.map((b, j) => multiply(a, b) + (i === j ? damping : 0)),
      -multiply(a, values),
    ]);
    const step = eliminate(matrix);
    const candidate = perturb(poses, step),
      next = residual(candidate);
    if (norm(next) < norm(values)) {
      poses = candidate;
      values = next;
      damping = Math.max(1e-12, damping / 3);
    } else damping = Math.min(1e12, damping * 10);
  }
  throw new Error(
    `align() solver did not converge (${unique.map(({relation: r}) => r.id).join(', ')}; this does not prove geometric incompatibility. Add positioning information or check conflicting relations.`,
  );
}

/** Pivoted elimination of the positive definite damped normal equations. */
function eliminate(matrix: number[][]): number[] {
  const n = matrix.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    for (let j = i + 1; j < n; j++) {
      const factor = matrix[j][i] / matrix[i][i];
      for (let k = i; k <= n; k++) matrix[j][k] -= factor * matrix[i][k];
    }
  }
  const result = Array.from({length: n}, () => 0);
  for (let i = n - 1; i >= 0; i--) {
    let value = matrix[i][n];
    for (let j = i + 1; j < n; j++) value -= matrix[i][j] * result[j];
    result[i] = value / matrix[i][i];
  }
  return result;
}
