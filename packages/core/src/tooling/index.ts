export {identifyCachedFunction} from '../library/cached.js';
export {
  installFontEngine,
  installModelResourceReader,
} from '../library/font.js';
export {googleFontSources, googleFontUrl} from '../library/google-font.js';
export {installOpenCascade} from '../library/open-cascade.js';

export {
  clearKernelOperationCache,
  kernelOperationCacheStats,
  setKernelCacheBudget,
  setKernelArtifactStore,
  setKernelExternalBytes,
} from '../library/kernel-cache.js';
export type {KernelArtifactStore} from '../library/kernel-cache.js';

export {
  SketchConstraintError,
  installSketchSolver,
} from '../library/sketch-solver.js';
export {
  assertSketchDragConnections,
  isSketch,
  sketchDefinition,
  sketchDragRequiresSolver,
  sketchEntityParameters,
  sketchFrame,
  sketchPointResolver,
  sketchSource,
  snapshotSketch,
  solveSketchSnapshot,
  withSketchEntityParameters,
} from '../library/sketch.js';
export type {
  Sketch,
  SketchArcDirection,
  SketchArcSnapshot,
  SketchCircleSnapshot,
  SketchConstraint,
  SketchEntitySnapshot,
  SketchEntry,
  SketchLineSnapshot,
  SketchOptions,
  SketchPointAddress,
  SketchPointSnapshot,
  SketchPosition,
  SketchSnapshot,
} from '../library/sketch.js';

export {sketchCurveIntersections} from '../library/sketch-curve-intersections.js';
export type {SketchCurveIntersection} from '../library/sketch-curve-intersections.js';
export {
  sketchArcGeometry,
  sketchCurveBounds,
  sketchCurveClosestParameter,
  sketchCurveGeometry,
  sketchCurvePosition,
  sketchCurveTolerance,
  sketchPositiveAngle,
} from '../library/sketch-curves.js';
export type {SketchCurve} from '../library/sketch-curves.js';
export {sketchRegions} from '../library/sketch-regions.js';
export type {SketchRegion} from '../library/sketch-regions.js';

export {describeOpenCascadeException} from '../library/open-cascade-error.js';
export {
  authoringApi,
  beginModelEvaluation,
  relationPreview,
  currentRelationSelf,
  relationSelectionPreview,
  relationTraceReference,
  createModelSnapshotter,
  disposeModelObjects,
  executeSnapshotQueryBatch,
  instrumentRelation,
  instrumentModelOperation,
  isConstraint,
  isRelationExpression,
  isModelObject,
  modelElementReference,
  modelObjectRuntimeInfo,
  modelTopologyIds,
  modelTopologyReference,
  planModelSnapshotQueries,
  relatedModelObjects,
  retainModelGeometry,
} from '../library/runtime.js';
export type {
  Constraint,
  ConstraintAnchorSnapshot,
  RelationExpression,
  RelationPreview,
  ConstraintSnapshot,
  TransformationSnapshot,
  RelationStageSnapshot,
  RelationSpatialReference,
  ConstraintTraceReference,
  RelationTraceReference,
  ElementKind,
  ElementSnapshot,
  ModelElementReference,
  ModelGeometryKind,
  ModelGeometrySnapshot,
  ModelKind,
  ModelObject,
  ModelObjectRuntimeInfo,
  ModelOperationInputRole,
  ModelOperationInstrumentation,
  ModelOperationKind,
  ModelOperationRegionSnapshot,
  ModelOperationSelectionSnapshot,
  ModelOperationSnapshot,
  ModelParameterDimension,
  ModelSnapshotObject,
  ModelSpatialOperation,
  RotationReferenceSnapshot,
  ModelTopologyReference,
  ParameterKind,
  ParameterTarget,
  ParameterUsage,
  RelationObject,
  RenderMesh,
  SnapshotQuery,
  SnapshotQueryBatch,
  SnapshotQueryResult,
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
  transformsAreEquivalent,
  xyzRotation,
} from '../library/spatial.js';
export type {Quaternion, RigidTransform, Vec3} from '../library/spatial.js';
export type {
  TopologyGeometry,
  TopologyInspection,
  TopologyInspectionItem,
  TopologyInspectionOptions,
} from '../library/topology-inspection.js';
export type {
  EdgeId,
  SurfaceId,
  TopologyId,
  TopologyKind,
  VertexId,
} from '../library/topology.js';

export {
  TopologyIdSet,
  compareTopologyIds,
  formatTopologyId,
  isTopologyId,
  sameTopologyId,
  topologyIdKey,
} from '../library/topology-id.js';

export {captureModelMaterial, modelMaterialColor} from '../library/material.js';
export type {ModelMaterialSnapshot} from '../library/material.js';
export {parseModelColor} from '../library/model-color.js';
export type {ModelColor} from '../library/model-color.js';
