import {setOC} from 'replicad';
import type {OpenCascadeInstance} from 'replicad-opencascadejs';
import {clearKernelOperationCache} from '../library/kernel-cache.js';

export {
  Constraint,
  ModelObject,
  authoringApi,
  disposeModelObjects,
  isConstraint,
  isModelObject,
  modelElementReference,
} from '../library/runtime.js';
export type {
  ConstraintAnchorSnapshot,
  ConstraintSnapshot,
  ElementKind,
  ElementSnapshot,
  ModelElementReference,
  ModelOperationInputRole,
  ModelOperationKind,
  ModelOperationRegionSnapshot,
  ModelOperationSelectionSnapshot,
  ModelOperationSnapshot,
  ModelSnapshotObject,
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
export type {EdgeId} from '../library/topology.js';
export {describeOpenCascadeException} from '../library/open-cascade-error.js';

export const toolingProtocolVersion = 1;

export function installOpenCascade(openCascade: OpenCascadeInstance): void {
  clearKernelOperationCache();
  setOC(openCascade);
}
