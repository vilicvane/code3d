import {setOC} from 'replicad';
import type {OpenCascadeInstance} from 'replicad-opencascadejs';
import {clearKernelOperationCache} from '../library/kernel-cache.js';

export {
  isSketch,
  sketchDefinition,
  snapshotSketch,
  solveSketchSnapshot,
  sketchDragRequiresSolver,
  assertSketchDragConnections,
  sketchPointResolver,
  sketchEntityParameters,
  withSketchEntityParameters,
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
  SketchCircleSnapshot,
  SketchArcSnapshot,
  SketchArcDirection,
  SketchEntitySnapshot,
  SketchSnapshot,
} from '../library/sketch.js';

export {
  sketchArcGeometry,
  sketchCurveGeometry,
  sketchCurvePosition,
  sketchCurveClosestParameter,
  sketchCurveBounds,
  sketchCurveTolerance,
  sketchPositiveAngle,
} from '../library/sketch-curves.js';
export type {SketchCurve} from '../library/sketch-curves.js';
export {sketchRegions} from '../library/sketch-regions.js';
export type {SketchRegion} from '../library/sketch-regions.js';
export {sketchCurveIntersections} from '../library/sketch-curve-intersections.js';
export type {SketchCurveIntersection} from '../library/sketch-curve-intersections.js';

export {
  authoringApi,
  beginModelEvaluation,
  constraintTraceReference,
  constraintPreview,
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
  ConstraintPreview,
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
  TopologyId,
  TopologyKind,
  VertexId,
} from '../library/topology.js';
export {describeOpenCascadeException} from '../library/open-cascade-error.js';

export function installOpenCascade(openCascade: OpenCascadeInstance): void {
  clearKernelOperationCache();
  setOC(openCascade);
}

export {
  compareTopologyIds,
  formatTopologyId,
  isTopologyId,
  sameTopologyId,
  topologyIdKey,
  TopologyIdSet,
} from '../library/topology-id.js';
