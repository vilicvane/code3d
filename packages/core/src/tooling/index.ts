export {identifyCachedFunction} from '../library/cached.js';
export {
  installModelResourceReader,
  installFontEngine,
} from '../library/font.js';
export {googleFontUrl, googleFontSources} from '../library/google-font.js';
import {setOC} from 'replicad';
import type {OpenCascadeInstance} from '@code3d/opencascade';
import {clearKernelOperationCache} from '../library/kernel-cache.js';

export {
  setKernelArtifactStore,
  setKernelExternalBytes,
  kernelOperationCacheStats,
  clearKernelOperationCache,
} from '../library/kernel-cache.js';
export type {KernelArtifactStore} from '../library/kernel-cache.js';

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
  planModelSnapshotQueries,
  executeSnapshotQueryBatch,
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
  SnapshotQuery,
  SnapshotQueryResult,
  SnapshotQueryBatch,
  ModelSpatialOperation,
  ModelParameterDimension,
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
  TopologyInspectionOptions,
  TopologyInspection,
  TopologyInspectionItem,
  TopologyGeometry,
} from '../library/topology-inspection.js';
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

export {captureModelMaterial, modelMaterialColor} from '../library/material.js';
export type {ModelMaterialSnapshot} from '../library/material.js';
export {parseModelColor} from '../library/model-color.js';
export type {ModelColor} from '../library/model-color.js';
