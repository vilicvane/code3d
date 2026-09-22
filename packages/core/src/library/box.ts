import {getOC, type Shape3D} from 'replicad';
import {castOwnedShape3D} from './kernel-shapes.js';
import {identityRigidTransform} from './spatial.js';
import {assertPositive} from './validation.js';
import type {InspectContext, InspectResult} from './inspect.js';
import {
  ModelObject,
  evaluateSolidGeometry,
  solidElements,
  storedOperation,
  type CanonicalElements,
  type SolidModel,
} from './runtime.js';

/**
 * @code3d.inspect x box.inspectDimension
 * @code3d.inspect y box.inspectDimension
 * @code3d.inspect z box.inspectDimension
 * @code3d.param x {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 * @code3d.param y {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 * @code3d.param z {kind: 'length', default: 10, constraints: {exclusiveMin: 0}}
 */
export function box(x: number, y: number, z: number): SolidModel;
export function box(x = 10, y = 10, z = 10): SolidModel {
  assertPositive('x', x);
  assertPositive('y', y);
  assertPositive('z', z);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Box',
    geometry: evaluateSolidGeometry('box', [x, y, z], [], () => ({
      shape: centeredBoxShape(x, y, z),
    })),
    elements: solidElements([
      [0, -y / 2, 0],
      [0, y / 2, 0],
    ]),
    operation: storedOperation('box', [], {
      dimensions: {
        x: {origin: [-x / 2, -y / 2, -z / 2], vector: [x, 0, 0]},
        y: {origin: [-x / 2, -y / 2, -z / 2], vector: [0, y, 0]},
        z: {origin: [-x / 2, -y / 2, -z / 2], vector: [0, 0, z]},
      },
    }),
  }) as unknown as SolidModel;
}

/** @internal */
export namespace box {
  export function inspectDimension(
    args: [number, number, number],
    context: InspectContext<SolidModel>,
  ): InspectResult | undefined {
    if (!context.return) return undefined;
    const parameter = context.focused.parameter!;
    const value = args[['x', 'y', 'z'].indexOf(parameter)];
    return {
      target: [
        context.return,
        ModelObject.inspectDimension(
          context.return,
          parameter,
          value,
          context.return,
          identityRigidTransform,
          parameter.toUpperCase(),
        ),
      ],
    };
  }
}

/** @internal */
export function centeredBoxShape(x: number, y: number, z: number): Shape3D {
  const oc = getOC();
  const corner = new oc.gp_Pnt(-x / 2, -y / 2, -z / 2);
  try {
    const builder = new oc.BRepPrimAPI_MakeBox(corner, x, y, z);
    try {
      return castOwnedShape3D(builder.Shape());
    } finally {
      builder.delete();
    }
  } finally {
    corner.delete();
  }
}
