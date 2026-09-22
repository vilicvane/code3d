import {withNativeScope} from './kernel-scope.js';
import {castOwnedShape3D} from './kernel-shapes.js';
import {getOC, type Shape3D} from 'replicad';
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
 * An ellipsoid centered at the local origin, with radii along X, Y and Z.
 * @code3d.param xRadius {kind: 'length', default: 5, label: 'X radius', constraints: {exclusiveMin: 0}}
 * @code3d.param yRadius {kind: 'length', default: 3, label: 'Y radius', constraints: {exclusiveMin: 0}}
 * @code3d.param zRadius {kind: 'length', default: 4, label: 'Z radius', constraints: {exclusiveMin: 0}}
 */
export function ellipsoid(
  xRadius: number,
  yRadius: number,
  zRadius: number,
): SolidModel;
export function ellipsoid(xRadius = 5, yRadius = 3, zRadius = 4): SolidModel {
  assertPositive('xRadius', xRadius);
  assertPositive('yRadius', yRadius);
  assertPositive('zRadius', zRadius);
  return ModelObject.create<CanonicalElements, 'solid'>({
    kind: 'solid',
    name: 'Ellipsoid',
    geometry: evaluateSolidGeometry(
      'ellipsoid',
      [xRadius, yRadius, zRadius],
      [],
      () => ({shape: ellipsoidShape(xRadius, yRadius, zRadius)}),
    ),
    elements: solidElements([
      [0, -yRadius, 0],
      [0, yRadius, 0],
    ]),
    operation: storedOperation('ellipsoid'),
  }) as unknown as SolidModel;
}

/** @internal Scale a rational unit sphere's poles, preserving an exact ellipsoid surface. */
export function ellipsoidShape(x: number, y: number, z: number): Shape3D {
  return withNativeScope(scope => {
    const oc = getOC(),
      sphere = scope.own(new oc.gp_Sphere());
    sphere.SetRadius(1);
    const spherical = scope.own(new oc.Geom_SphericalSurface(sphere));
    const surface = scope.own(
      oc.GeomConvert.SurfaceToBSplineSurface(spherical),
    );
    for (let u = 1; u <= surface.NbUPoles(); u++)
      for (let v = 1; v <= surface.NbVPoles(); v++) {
        const point = surface.Pole(u, v);
        try {
          point.SetCoord(point.X() * x, point.Y() * y, point.Z() * z);
          surface.SetPole(u, v, point);
        } finally {
          point.delete();
        }
      }
    const shellBuilder = scope.own(
      new oc.BRepBuilderAPI_MakeShell(surface, false),
    );
    const shell = scope.own(shellBuilder.Shell());
    const solidBuilder = scope.own(new oc.BRepBuilderAPI_MakeSolid(shell));
    return castOwnedShape3D(solidBuilder.Solid());
  });
}
