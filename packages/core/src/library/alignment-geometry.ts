import {getOC, type Edge, type Face} from 'replicad';
import {
  addVectors,
  composeTransforms,
  rotateVector,
  translation,
  type RigidTransform,
  type Vec3,
} from './spatial.js';

export type AlignmentGeometry =
  | Readonly<{kind: 'point'; point: Vec3}>
  | Readonly<{kind: 'line'; point: Vec3; direction: Vec3}>
  | Readonly<{
      kind: 'circle' | 'ellipse';
      point: Vec3;
      normal: Vec3;
      major: Vec3;
      radius: number;
      minorRadius: number;
    }>
  | Readonly<{kind: 'plane'; point: Vec3; normal: Vec3}>
  | Readonly<{
      kind: 'cylinder';
      point: Vec3;
      direction: Vec3;
      radius: number;
      facing: number;
    }>
  | Readonly<{kind: 'sphere'; point: Vec3; radius: number; facing: number}>;

export const dot = (a: Vec3, b: Vec3): number =>
  a.reduce((sum, v, i) => sum + v * b[i], 0);
export const scale = (a: Vec3, s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
export const subtract = (a: Vec3, b: Vec3): Vec3 => addVectors(a, scale(b, -1));
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit = (v: Vec3): Vec3 => scale(v, 1 / Math.hypot(...v));
export const reject = (v: Vec3, normal: Vec3): Vec3 =>
  subtract(v, scale(normal, dot(v, normal)));
export const perpendicular = (v: Vec3): Vec3 =>
  unit(reject(Math.abs(v[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], v));

function coordinates(value: {
  X(): number;
  Y(): number;
  Z(): number;
  delete(): void;
}): Vec3 {
  try {
    return [value.X(), value.Y(), value.Z()];
  } finally {
    value.delete();
  }
}

/** Read complete analytic loci, independent of edge/face trimming and parametrization. */
export function edgeGeometry(edge: Edge, direction: number): AlignmentGeometry {
  const oc = getOC();
  const adaptor = new oc.BRepAdaptor_Curve(edge.wrapped);
  try {
    if (edge.geomType === 'LINE') {
      const point = edge.pointAt(0),
        tangent = edge.tangentAt(0);
      try {
        const axis = scale(tangent.toTuple(), direction);
        return {
          kind: 'line',
          point: reject(point.toTuple(), axis),
          direction: axis,
        };
      } finally {
        point.delete();
        tangent.delete();
      }
    }
    if (edge.geomType === 'CIRCLE' || edge.geomType === 'ELLIPSE') {
      const curve =
        edge.geomType === 'CIRCLE' ? adaptor.Circle() : adaptor.Ellipse();
      const frame = curve.Position();
      try {
        const radius = 'Radius' in curve ? curve.Radius() : curve.MajorRadius();
        const minorRadius = 'Radius' in curve ? radius : curve.MinorRadius();
        return {
          kind: Math.abs(radius - minorRadius) < 1e-10 ? 'circle' : 'ellipse',
          point: coordinates(curve.Location()),
          normal: scale(coordinates(frame.Direction()), direction),
          major: coordinates(frame.XDirection()),
          radius,
          minorRadius,
        };
      } finally {
        frame.delete();
        curve.delete();
      }
    }
    throw new Error(
      `align() does not yet support underlying ${edge.geomType} curves. Select a point on the curve for further positioning.`,
    );
  } finally {
    adaptor.delete();
  }
}

export function faceGeometry(face: Face, facing: number): AlignmentGeometry {
  const adaptor = new (getOC().BRepAdaptor_Surface)(face.wrapped, false);
  try {
    if (face.geomType === 'PLANE') {
      const plane = adaptor.Plane(),
        axis = plane.Axis();
      try {
        const normal = scale(
          coordinates(axis.Direction()),
          facing * (face.orientation === 'forward' ? 1 : -1),
        );
        return {
          kind: 'plane',
          point: scale(normal, dot(coordinates(plane.Location()), normal)),
          normal,
        };
      } finally {
        axis.delete();
        plane.delete();
      }
    }
    if (face.geomType === 'CYLINDRE' || face.geomType === 'SPHERE') {
      const surface =
        face.geomType === 'SPHERE' ? adaptor.Sphere() : adaptor.Cylinder();
      try {
        const point = coordinates(surface.Location());
        const sense =
          facing *
          (face.orientation === 'forward' ? 1 : -1) *
          (surface.Direct() ? 1 : -1);
        if (face.geomType === 'SPHERE')
          return {
            kind: 'sphere',
            point,
            radius: surface.Radius(),
            facing: sense,
          };
        const axis = (surface as ReturnType<typeof adaptor.Cylinder>).Axis();
        try {
          const direction = coordinates(axis.Direction());
          return {
            kind: 'cylinder',
            point: reject(point, direction),
            direction,
            radius: surface.Radius(),
            facing: sense,
          };
        } finally {
          axis.delete();
        }
      } finally {
        surface.delete();
      }
    }
    throw new Error(
      `align() does not yet support underlying ${face.geomType} surfaces.`,
    );
  } finally {
    adaptor.delete();
  }
}

export function transformGeometry(
  geometry: AlignmentGeometry,
  pose: RigidTransform,
): AlignmentGeometry {
  const point = composeTransforms(pose, translation(geometry.point)).position;
  if ('direction' in geometry) {
    const direction = rotateVector(geometry.direction, pose.quaternion);
    return {...geometry, point: reject(point, direction), direction};
  }
  if ('normal' in geometry) {
    const normal = rotateVector(geometry.normal, pose.quaternion);
    return 'major' in geometry
      ? {
          ...geometry,
          point,
          normal,
          major: rotateVector(geometry.major, pose.quaternion),
        }
      : {...geometry, point: scale(normal, dot(point, normal)), normal};
  }
  return {...geometry, point};
}

const rank = (g: AlignmentGeometry): number =>
  g.kind === 'point'
    ? 0
    : ['line', 'circle', 'ellipse'].includes(g.kind)
      ? 1
      : 2;
export function orderedGeometry(
  a: AlignmentGeometry,
  b: AlignmentGeometry,
): readonly [AlignmentGeometry, AlignmentGeometry] {
  return rank(a) <= rank(b) ? [a, b] : [b, a];
}

/** Reject only proven incompatibilities; unsupported pairs and iteration failures have distinct errors. */
export function validateAlignment(
  first: AlignmentGeometry,
  second: AlignmentGeometry,
): void {
  const [a, b] = orderedGeometry(first, second);
  const incompatible = (reason: string): never => {
    throw new Error(`Geometrically incompatible align(): ${reason}`);
  };
  const sameSize = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-7 * Math.max(1, a, b);
  if (a.kind === 'point') return;
  if (rank(a) === rank(b)) {
    if (a.kind !== b.kind)
      incompatible(
        `${a.kind} and ${b.kind} cannot coincide under a rigid transform.`,
      );
    if ('radius' in a && 'radius' in b && !sameSize(a.radius, b.radius))
      incompatible('radii differ.');
    if (
      'minorRadius' in a &&
      'minorRadius' in b &&
      !sameSize(a.minorRadius, b.minorRadius)
    )
      incompatible('minor radii differ.');
    if ('facing' in a && 'facing' in b && a.facing !== b.facing)
      incompatible(
        'closed surface normal senses differ; use flip() to select matching facing.',
      );
    return;
  }
  if (b.kind === 'plane') return;
  if (a.kind === 'line' && b.kind === 'cylinder') return;
  if (a.kind === 'line' && b.kind === 'sphere')
    incompatible('a whole straight line cannot lie on a sphere.');
  if (a.kind === 'circle' && b.kind === 'cylinder') {
    if (!sameSize(a.radius, b.radius))
      incompatible('a circle on a cylinder must have its radius.');
    return;
  }
  if (a.kind === 'circle' && b.kind === 'sphere') {
    if (a.radius > b.radius + 1e-7)
      incompatible('the circle is larger than the sphere.');
    return;
  }
  if (a.kind === 'ellipse' && b.kind === 'sphere')
    incompatible('a non-circular ellipse cannot lie on a sphere.');
  if (a.kind === 'ellipse' && b.kind === 'cylinder') {
    if (!sameSize(a.minorRadius, b.radius))
      incompatible(
        'an elliptic cylinder section must have the cylinder radius as its minor radius.',
      );
    return;
  }
  throw new Error(
    `align() does not yet support ${a.kind}–${b.kind} relations.`,
  );
}

/** All residuals describe complete analytic loci; no trim endpoints or sampled tangent frames. */
export function alignmentResidual(
  first: AlignmentGeometry,
  second: AlignmentGeometry,
): number[] {
  const [a, b] = orderedGeometry(first, second),
    delta = subtract(a.point, b.point);
  if (a.kind === 'point') {
    switch (b.kind) {
      case 'point':
        return [...delta];
      case 'line':
        return [...reject(delta, b.direction)];
      case 'plane':
        return [dot(delta, b.normal)];
      case 'sphere':
        return [Math.hypot(...delta) - b.radius];
      case 'cylinder':
        return [Math.hypot(...reject(delta, b.direction)) - b.radius];
      case 'circle':
        return [
          dot(delta, b.normal),
          Math.hypot(...reject(delta, b.normal)) - b.radius,
        ];
      case 'ellipse': {
        const x = dot(delta, b.major) / b.radius,
          y = dot(delta, cross(b.normal, b.major)) / b.minorRadius;
        return [dot(delta, b.normal), (Math.hypot(x, y) - 1) * b.minorRadius];
      }
    }
  }
  if (a.kind === 'line') {
    if (b.kind === 'line')
      return [
        ...reject(delta, b.direction),
        ...subtract(a.direction, b.direction),
      ];
    if (b.kind === 'plane')
      return [dot(delta, b.normal), dot(a.direction, b.normal)];
    if (b.kind === 'cylinder')
      return [
        ...cross(a.direction, b.direction),
        Math.hypot(...reject(delta, b.direction)) - b.radius,
      ];
  }
  if (a.kind === 'circle' || a.kind === 'ellipse') {
    if (b.kind === 'circle' || b.kind === 'ellipse')
      return [
        ...delta,
        ...subtract(a.normal, b.normal),
        ...(a.kind === 'ellipse' ? cross(a.major, b.major) : []),
      ];
    if (b.kind === 'plane')
      return [dot(delta, b.normal), ...cross(a.normal, b.normal)];
    if (b.kind === 'sphere')
      return [
        ...reject(delta, a.normal),
        dot(delta, delta) + a.radius * a.radius - b.radius * b.radius,
      ];
    if (b.kind === 'cylinder') {
      // Fourier coefficients of squared distance to the cylinder axis. Their
      // vanishing is equivalent to membership of the complete ellipse/circle.
      const c = reject(delta, b.direction),
        x = reject(scale(a.major, a.radius), b.direction),
        y = reject(scale(cross(a.normal, a.major), a.minorRadius), b.direction);
      return [
        dot(c, c) + (dot(x, x) + dot(y, y)) / 2 - b.radius * b.radius,
        dot(c, x),
        dot(c, y),
        dot(x, x) - dot(y, y),
        dot(x, y),
      ];
    }
  }
  if (a.kind === 'plane' && b.kind === 'plane')
    return [dot(delta, b.normal), ...subtract(a.normal, b.normal)];
  if (a.kind === 'cylinder' && b.kind === 'cylinder')
    return [...reject(delta, b.direction), ...cross(a.direction, b.direction)];
  if (a.kind === 'sphere' && b.kind === 'sphere') return [...delta];
  throw new Error(`Unsupported alignment residual: ${a.kind}–${b.kind}.`);
}

export function nearestPoint(point: Vec3, geometry: AlignmentGeometry): Vec3 {
  const delta = subtract(point, geometry.point);
  const radial = (v: Vec3, radius: number, fallback: Vec3) =>
    scale(Math.hypot(...v) > 1e-12 ? unit(v) : fallback, radius);
  switch (geometry.kind) {
    case 'point':
      return geometry.point;
    case 'line':
      return addVectors(
        geometry.point,
        scale(geometry.direction, dot(delta, geometry.direction)),
      );
    case 'plane':
      return subtract(
        point,
        scale(geometry.normal, dot(delta, geometry.normal)),
      );
    case 'sphere':
      return addVectors(
        geometry.point,
        radial(delta, geometry.radius, [1, 0, 0]),
      );
    case 'cylinder':
      return addVectors(
        addVectors(
          geometry.point,
          scale(geometry.direction, dot(delta, geometry.direction)),
        ),
        radial(
          reject(delta, geometry.direction),
          geometry.radius,
          perpendicular(geometry.direction),
        ),
      );
    case 'circle':
      return addVectors(
        geometry.point,
        radial(reject(delta, geometry.normal), geometry.radius, geometry.major),
      );
    case 'ellipse': {
      const y = cross(geometry.normal, geometry.major);
      const x0 = dot(delta, geometry.major),
        y0 = dot(delta, y);
      const distance = (angle: number) =>
        (geometry.radius * Math.cos(angle) - x0) ** 2 +
        (geometry.minorRadius * Math.sin(angle) - y0) ** 2;
      // Bracket all minima of distance on the ellipse, then refine them. This
      // chooses a nearby free parameter; membership still uses the exact locus.
      const step = Math.PI / 16,
        candidates: number[] = [];
      for (let i = 0; i < 32; i++) {
        const angle = i * step;
        if (
          distance(angle) > distance(angle - step) ||
          distance(angle) > distance(angle + step)
        )
          continue;
        let lower = angle - step,
          upper = angle + step;
        for (let iteration = 0; iteration < 64; iteration++) {
          const a = lower + (upper - lower) * 0.3819660112501051,
            b = upper - (upper - lower) * 0.3819660112501051;
          if (distance(a) < distance(b)) upper = b;
          else lower = a;
        }
        candidates.push((lower + upper) / 2);
      }
      const angle = candidates.reduce(
        (best, angle) => (distance(angle) < distance(best) ? angle : best),
        candidates[0],
      );
      return addVectors(
        geometry.point,
        addVectors(
          scale(geometry.major, geometry.radius * Math.cos(angle)),
          scale(y, geometry.minorRadius * Math.sin(angle)),
        ),
      );
    }
  }
}
