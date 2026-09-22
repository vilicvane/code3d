import type {Edge as ReplicadEdge} from 'replicad';
import type {KernelKeyPart} from './kernel-cache.js';
import type {Vec3} from './spatial.js';
import {assertFiniteVector} from './validation.js';
import {
  ModelObject,
  evaluateModelGeometry,
  storedOperation,
  type CurveElements,
  type EdgeModel,
  type ModelOperationKind,
  curveAnchor,
} from './runtime.js';

export function curveModel(
  operation: Extract<ModelOperationKind, 'line' | 'arc' | 'bezier' | 'spline'>,
  name: string,
  arguments_: readonly KernelKeyPart[],
  build: () => ReplicadEdge,
): EdgeModel {
  const geometry = evaluateModelGeometry(operation, arguments_, [], () => ({
    shape: build(),
  }));
  const elements = curveElements(geometry.value.shape as ReplicadEdge);
  return ModelObject.create<CurveElements, 'edge'>({
    kind: 'edge',
    name,
    geometry,
    geometryAnchor: {...elements.start, kind: 'line'},
    elements,
    operation: storedOperation(operation),
  }) as unknown as EdgeModel;
}

function curveElements(curve: ReplicadEdge) {
  return {
    start: curveAnchor(curve, 0),
    midpoint: curveAnchor(curve, 0.5),
    end: curveAnchor(curve, 1),
  };
}

export function assertCurvePoints(
  label: string,
  points: readonly Vec3[],
  minimum: number,
): void {
  if (points.length < minimum) {
    throw new Error(`${label} requires at least ${minimum} points.`);
  }
  points.forEach((point, index) =>
    assertFiniteVector(`${label} point ${index + 1}`, point),
  );
  const [first, ...rest] = points;
  if (
    rest.every(point =>
      point.every((component, index) => component === first[index]),
    )
  ) {
    throw new Error(`${label} requires at least two distinct points.`);
  }
}
