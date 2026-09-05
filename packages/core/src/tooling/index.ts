import {setOC} from 'replicad';
import type {OpenCascadeInstance} from 'replicad-opencascadejs';
import {clearKernelOperationCache} from '../library/kernel-cache.js';

export {
  authoringApi,
  beginModelEvaluation,
  constraintTraceReference,
  createModelSnapshotter,
  disposeModelObjects,
  instrumentConstraint,
  instrumentModelOperation,
  isConstraint,
  isModelObject,
  modelElementReference,
  modelObjectRuntimeInfo,
  modelTopologyReference,
  relatedModelObjects,
  retainModelGeometry,
} from '../library/runtime.js';
export type {
  Constraint,
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

export {installConstraintSolver} from '../library/constraint-solver.js';

export const toolingProtocolVersion = 3;

export function installOpenCascade(openCascade: OpenCascadeInstance): void {
  clearKernelOperationCache();
  setOC(openCascade);
}
