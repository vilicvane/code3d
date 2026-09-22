import {assembleWire, genericSweep, makeCircle, makeHelix} from 'replicad';
import {assertPositive} from './validation.js';
import {
  ModelObject,
  evaluateSolidGeometry,
  solidElements,
  storedOperation,
  type CanonicalElements,
  type SolidModel,
} from './runtime.js';

/**
 * A right-handed, constant-pitch coil with a circular wire section and plain ends.
 * coilRadius measures to the wire centerline; pitch is the Y advance per turn.
 * The centerline spans -pitch * turns / 2 to +pitch * turns / 2 on the Y axis.
 * Fractional turns are supported. No spring-specific end treatments are applied.
 * @code3d.param coilRadius {kind: 'length', default: 5, label: 'Coil radius', constraints: {exclusiveMin: 0}}
 * @code3d.param wireRadius {kind: 'length', default: 1, label: 'Wire radius', constraints: {exclusiveMin: 0}}
 * @code3d.param pitch {kind: 'length', default: 3, constraints: {exclusiveMin: 0}}
 * @code3d.param turns {kind: 'scalar', default: 3, constraints: {exclusiveMin: 0}}
 */
export function coil(
  coilRadius: number,
  wireRadius: number,
  pitch: number,
  turns: number,
): SolidModel;
export function coil(
  coilRadius = 5,
  wireRadius = 1,
  pitch = 3,
  turns = 3,
): SolidModel {
  assertPositive('coilRadius', coilRadius);
  assertPositive('wireRadius', wireRadius);
  assertPositive('pitch', pitch);
  assertPositive('turns', turns);
  if (wireRadius >= coilRadius) {
    throw new Error('wireRadius must be smaller than coilRadius.');
  }
  if (pitch <= 2 * wireRadius) {
    throw new Error('pitch must be greater than the wire diameter.');
  }
  assertCoilClearance(coilRadius, wireRadius, pitch, turns);
  const y = pitch * turns;
  assertPositive('pitch * turns', y);
  const geometry = evaluateSolidGeometry(
    'coil',
    [coilRadius, wireRadius, pitch, turns],
    [],
    () => {
      const spine = makeHelix(pitch, y, coilRadius, [0, -y / 2, 0], [0, 1, 0]);
      const start = spine.pointAt(0);
      const tangent = spine.tangentAt(0);
      const circle = makeCircle(wireRadius, start, tangent);
      const section = assembleWire([circle]);
      try {
        return {shape: genericSweep(section, spine, {frenet: true})};
      } finally {
        section.delete();
        circle.delete();
        tangent.delete();
        start.delete();
        spine.delete();
      }
    },
  );
  // A fractional turn has asymmetric X/Z bounds, but its axis is still Y.
  // The circular end sections extend beyond the centerline's Y interval.
  const circumference = 2 * Math.PI * coilRadius;
  const halfHeight =
    y / 2 + wireRadius * (circumference / Math.hypot(circumference, pitch));
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Coil',
    geometry,
    elements: solidElements([
      [0, -halfHeight, 0],
      [0, halfHeight, 0],
    ]),
    operation: storedOperation('coil'),
  }) as unknown as SolidModel;
}

function assertCoilClearance(
  radius: number,
  wireRadius: number,
  pitch: number,
  turns: number,
): void {
  // Neighboring turns approach obliquely: pitch alone overestimates clearance.
  // For angular separation t, squared centerline distance is
  // 2 R² (1 - cos(t)) + (pitch * t / 2π)². Its only possible minimum
  // between half a turn and a full turn lies after the derivative's minimum.
  // Beyond a full turn, the Y separation already exceeds the wire diameter.
  if (turns <= 0.5) return;
  const fullTurn = 2 * Math.PI;
  const slopeSquared = (pitch / (fullTurn * radius)) ** 2;
  if (slopeSquared >= 1) return;
  let lower = fullTurn - Math.acos(-slopeSquared);
  if (Math.sin(lower) + slopeSquared * lower >= 0) return;
  let upper = fullTurn;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (Math.sin(middle) + slopeSquared * middle < 0) lower = middle;
    else upper = middle;
  }
  const separation = Math.min(fullTurn * turns, (lower + upper) / 2);
  const distance = Math.hypot(
    2 * radius * Math.sin(separation / 2),
    (pitch * separation) / fullTurn,
  );
  if (distance <= 2 * wireRadius) {
    throw new Error(
      'Coil turns must not touch or overlap; increase pitch or decrease wireRadius.',
    );
  }
}
