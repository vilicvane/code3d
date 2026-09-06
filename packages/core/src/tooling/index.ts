import {setOC} from 'replicad';
import type {OpenCascadeInstance} from 'replicad-opencascadejs';
import {clearKernelOperationCache} from '../library/kernel-cache.js';

export {
  authoringApi,
  beginModelEvaluation,
  constraintTraceReference,
  constraintSpatialReference,
  createModelSnapshotter,
  disposeModelObjects,
  instrumentConstraint,
  instrumentModelOperation,
  isConstraint,
  isConstraintExpression,
  isModelObject,
  modelElementReference,
  modelObjectRuntimeInfo,
  modelTopologyReference,
  modelTopologyIds,
  relatedModelObjects,
  retainModelGeometry,
} from '../library/runtime.js';
export type {
  Constraint,
  ConstraintExpression,
  ConstraintSpatialReference,
  ConstraintAnchorSnapshot,
  ConstraintSnapshot,
  ConstraintTraceReference,
  ElementKind,
  ElementSnapshot,
  ModelElementReference,
  ModelGeometryKind,
  ModelGeometrySnapshot,
  ModelKind,
  ModelOperationInputRole,
  ModelOperationInstrumentation,
  ModelOperationKind,
  ModelOperationRegionSnapshot,
  ModelOperationSelectionSnapshot,
  ModelOperationSnapshot,
  ModelObject,
  ModelObjectRuntimeInfo,
  ModelSnapshotObject,
  ModelSpatialOperation,
  ModelTopologyReference,
  ParameterKind,
  ParameterTarget,
  ParameterUsage,
  RenderMesh,
  SourceRef,
  Transform,
} from '../library/runtime.js';
export {
  composeTransforms,
  identityRigidTransform,
  invertTransform,
  quaternionAxisAngle,
  relativeTransform,
  rotateVector,
  rotationAround,
  xyzRotation,
  transformsAreEquivalent,
} from '../library/spatial.js';
export type {Quaternion, RigidTransform, Vec3} from '../library/spatial.js';
export type {
  EdgeId,
  SurfaceId,
  TopologyKind,
  VertexId,
} from '../library/topology.js';
export {describeOpenCascadeException} from '../library/open-cascade-error.js';

export function installOpenCascade(openCascade: OpenCascadeInstance): void {
  clearKernelOperationCache();
  setOC(openCascade);
}
