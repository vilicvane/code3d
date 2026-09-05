import {setOC} from 'replicad';
import type {OpenCascadeInstance} from 'replicad-opencascadejs';
import {clearKernelOperationCache} from '../library/kernel-cache.js';

export {
  isSketch,
  sketchDefinition,
  snapshotSketch,
  solveSketchSnapshot,
} from '../library/sketch.js';
export {
  installSketchSolver,
  SketchConstraintError,
} from '../library/sketch-solver.js';
export type {
  Sketch,
  SketchEntry,
  SketchConstraint,
  SketchOptions,
  SketchPosition,
  SketchPointAddress,
  SketchPointSnapshot,
  SketchLineSnapshot,
  SketchSnapshot,
} from '../library/sketch.js';

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
  modelTopologyIds,
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

export {installConstraintSolver} from '../library/constraint-solver.js';

export function installOpenCascade(openCascade: OpenCascadeInstance): void {
  clearKernelOperationCache();
  setOC(openCascade);
}
