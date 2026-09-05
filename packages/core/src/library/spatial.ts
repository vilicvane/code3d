export type Vec3 = readonly [x: number, y: number, z: number];

export type Quaternion = readonly [x: number, y: number, z: number, w: number];

export type RigidTransform = Readonly<{
  position: Vec3;
  quaternion: Quaternion;
}>;

export const origin: Vec3 = [0, 0, 0];
export const identityQuaternion: Quaternion = [0, 0, 0, 1];
export const halfTurnAroundX: Quaternion = [1, 0, 0, 0];
export const identityRigidTransform: RigidTransform = {
  position: origin,
  quaternion: identityQuaternion,
};

export function translation(position: Vec3): RigidTransform {
  return {position, quaternion: identityQuaternion};
}

export function rotation(quaternion: Quaternion): RigidTransform {
  return {position: origin, quaternion};
}

/** Degrees, applied about fixed X, then Y, then Z axes. */
export function xyzRotation(angles: Vec3): Quaternion {
  const [x, y, z] = angles.map(angle => (angle * Math.PI) / 360);
  const rx: Quaternion = [Math.sin(x), 0, 0, Math.cos(x)];
  const ry: Quaternion = [0, Math.sin(y), 0, Math.cos(y)];
  const rz: Quaternion = [0, 0, Math.sin(z), Math.cos(z)];
  return multiplyQuaternions(rz, multiplyQuaternions(ry, rx));
}

export function rotationAround(position: Vec3, angles: Vec3): RigidTransform {
  const quaternion = xyzRotation(angles);
  return {
    position: addVectors(
      position,
      negateVector(rotateVector(position, quaternion)),
    ),
    quaternion,
  };
}

export function frameFromYAxis(
  position: Vec3,
  direction: Vec3,
): RigidTransform {
  const y = normalizeVector(direction);
  const preferredX: Vec3 = Math.abs(y[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const x = normalizeVector(rejectVector(preferredX, y));
  const z = crossVectors(x, y);
  return {
    position,
    quaternion: quaternionFromBasis(x, y, z),
  };
}

export function composeTransforms(
  outer: RigidTransform,
  inner: RigidTransform,
): RigidTransform {
  return {
    position: addVectors(
      outer.position,
      rotateVector(inner.position, outer.quaternion),
    ),
    quaternion: multiplyQuaternions(outer.quaternion, inner.quaternion),
  };
}

export function invertTransform(transform: RigidTransform): RigidTransform {
  const quaternion = conjugateQuaternion(transform.quaternion);
  return {
    position: rotateVector(negateVector(transform.position), quaternion),
    quaternion,
  };
}

export function relativeTransform(
  source: RigidTransform,
  target: RigidTransform,
): RigidTransform {
  return composeTransforms(invertTransform(target), source);
}

export function rotateVector(vector: Vec3, quaternion: Quaternion): Vec3 {
  const [x, y, z] = vector;
  const [qx, qy, qz, qw] = quaternion;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

export function addVectors(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function negateVector(vector: Vec3): Vec3 {
  return [-vector[0], -vector[1], -vector[2]];
}

export function transformsAreEquivalent(
  left: RigidTransform,
  right: RigidTransform,
  tolerance = 1e-7,
): boolean {
  const positionDelta = Math.hypot(
    left.position[0] - right.position[0],
    left.position[1] - right.position[1],
    left.position[2] - right.position[2],
  );
  const quaternionDot = Math.abs(
    left.quaternion[0] * right.quaternion[0] +
      left.quaternion[1] * right.quaternion[1] +
      left.quaternion[2] * right.quaternion[2] +
      left.quaternion[3] * right.quaternion[3],
  );
  return positionDelta <= tolerance && 1 - quaternionDot <= tolerance;
}

export function quaternionAxisAngle(quaternion: Quaternion): Readonly<{
  axis: Vec3;
  angleDegrees: number;
}> {
  const normalized = normalizeQuaternion(quaternion);
  const sign = normalized[3] < 0 ? -1 : 1;
  const canonical: Quaternion = [
    normalized[0] * sign,
    normalized[1] * sign,
    normalized[2] * sign,
    normalized[3] * sign,
  ];
  const angle = 2 * Math.acos(clamp(canonical[3], -1, 1));
  const sine = Math.sqrt(Math.max(0, 1 - canonical[3] * canonical[3]));
  return {
    axis:
      sine < 1e-9
        ? [1, 0, 0]
        : [canonical[0] / sine, canonical[1] / sine, canonical[2] / sine],
    angleDegrees: (angle * 180) / Math.PI,
  };
}

function multiplyQuaternions(left: Quaternion, right: Quaternion): Quaternion {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  return normalizeQuaternion([
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ]);
}

function conjugateQuaternion(quaternion: Quaternion): Quaternion {
  return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]];
}

function normalizeQuaternion(quaternion: Quaternion): Quaternion {
  const length = Math.hypot(...quaternion);
  return [
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ];
}

function normalizeVector(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  if (length < 1e-12) {
    throw new Error('A relation frame direction cannot be zero.');
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function rejectVector(vector: Vec3, normal: Vec3): Vec3 {
  const projection = dotVectors(vector, normal);
  return [
    vector[0] - projection * normal[0],
    vector[1] - projection * normal[1],
    vector[2] - projection * normal[2],
  ];
}

function dotVectors(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function crossVectors(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function quaternionFromBasis(x: Vec3, y: Vec3, z: Vec3): Quaternion {
  const m00 = x[0];
  const m01 = y[0];
  const m02 = z[0];
  const m10 = x[1];
  const m11 = y[1];
  const m12 = z[1];
  const m20 = x[2];
  const m21 = y[2];
  const m22 = z[2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    return normalizeQuaternion([
      (m21 - m12) / scale,
      (m02 - m20) / scale,
      (m10 - m01) / scale,
      scale / 4,
    ]);
  }
  if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuaternion([
      scale / 4,
      (m01 + m10) / scale,
      (m02 + m20) / scale,
      (m21 - m12) / scale,
    ]);
  }
  if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuaternion([
      (m01 + m10) / scale,
      scale / 4,
      (m12 + m21) / scale,
      (m02 - m20) / scale,
    ]);
  }
  const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuaternion([
    (m02 + m20) / scale,
    (m12 + m21) / scale,
    scale / 4,
    (m10 - m01) / scale,
  ]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
