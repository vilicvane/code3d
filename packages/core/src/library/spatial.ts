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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
