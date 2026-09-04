import {
  arc,
  bezier,
  box,
  circle,
  cut,
  cylinder,
  ellipse,
  frustum,
  group,
  helicalThread,
  intersect,
  line,
  loft,
  point,
  rectangle,
  regularPolygon,
  regularPrism,
  spline,
  sphere,
  union,
  type Anchor,
  type CanonicalElements,
  type Constraint,
  type CurveElements,
  type Edge,
  type EdgeId,
  type EdgeModel,
  type FaceAnchor,
  type FaceModel,
  type GroupModel,
  type HelicalThreadOptions,
  type LineAnchor,
  type LoftOptions,
  type Model,
  type PlanarElements,
  type PointAnchor,
  type SolidModel,
  type Surface,
  type SurfaceId,
  type Vec3,
  type Vertex,
  type VertexId,
  type VertexModel,
} from '../bld/library/index.js';

// @ts-expect-error The concrete runtime class is not part of the authoring API.
import type {ModelObject} from '../bld/library/index.js';
// @ts-expect-error Runtime element discriminators belong to tooling.
import type {ElementKind} from '../bld/library/index.js';
// @ts-expect-error Runtime geometry discriminators belong to tooling.
import type {ModelGeometryKind} from '../bld/library/index.js';
// @ts-expect-error Runtime model discriminators belong to tooling.
import type {ModelKind} from '../bld/library/index.js';
// @ts-expect-error Runtime topology discriminators belong to tooling.
import type {TopologyKind} from '../bld/library/index.js';
// @ts-expect-error Quaternions are a tooling transform detail for now.
import type {Quaternion} from '../bld/library/index.js';

const solid = box(10, 5, 8);
const related = solid.relate(self => self.center.on(solid.top).flip());
const exposed = related.expose({mount: related.bottom});
const constraint: Constraint = exposed.mount.on(solid.center).offset(1, 2, 3);
const anchor: Anchor = exposed.mount;
const vertex: Vertex = solid.vertex(1);
const edge: Edge = solid.edge(1);
const surface: Surface = solid.surface(1);
const vertexId: VertexId = vertex.id;
const edgeId: EdgeId = edge.id;
const surfaceId: SurfaceId = surface.id;
const vector: Vec3 = [1, 2, 3];
const model: Model = solid;
const solidModel: SolidModel<CanonicalElements> = solid;
const faceModel: FaceModel<PlanarElements> = circle(4);
const edgeModel: EdgeModel<CurveElements> = line([0, 0, 0], vector);
const vertexModel: VertexModel = point(vector);
const groupModel: GroupModel = group([
  solid,
  faceModel,
  edgeModel,
  vertexModel,
]);
const pointAnchor: PointAnchor = solid.center;
const lineAnchor: LineAnchor = solid.axis;
const faceAnchor: FaceAnchor = solid.top;
const loftOptions: LoftOptions = {spine: edgeModel, ruled: true};
const threadOptions: HelicalThreadOptions = {
  pitch: 1,
  y: 10,
  majorDiameter: 6,
  minorDiameter: 5,
  rootWidth: 0.75,
  crestWidth: 0.125,
};

solid.paint('#fff').scaled(2).fillet(1).chamfer(0.5);
solid.vertices();
solid.edges();
solid.surfaces();
solid
  .expose({mount: solid.bottom})
  .relate(self => self.mount.on(solid.top))
  .fillet(1, [edgeId]);
faceModel
  .scaled(2)
  .relate(self => self.plane.on(solid.top))
  .expose({mount: solid.bottom})
  .surface(1);
faceModel.vertex(1);
faceModel.edge(1);
faceModel.surfaces();
edgeModel
  .scaled(2)
  .relate(self => self.start.on(solid.center))
  .expose({mount: solid.axis})
  .edge(1);
edgeModel.vertex(1);
edgeModel.edges();
vertexModel
  .scaled(2)
  .relate(self => self.on(solid.center))
  .expose({mount: solid.center})
  .vertex(1);
vertexModel.vertices();
groupModel
  .paint('#fff')
  .relate(self => self.on(solid.center))
  .expose({mount: solid.top})
  .relate(self => self.mount.on(solid.bottom));
union([solid, exposed]);
cut(solid, [exposed]);
intersect([solid, exposed]);
loft([faceModel, faceModel.relate(self => self.plane.on(solid.bottom))], {
  spine: edgeModel,
});
constraint.flip();

void [
  arc,
  bezier,
  circle,
  cut,
  cylinder,
  ellipse,
  faceModel,
  frustum,
  group,
  groupModel,
  helicalThread,
  intersect,
  line,
  loft,
  loftOptions,
  model,
  point,
  pointAnchor,
  rectangle,
  regularPolygon,
  regularPrism,
  solidModel,
  sphere,
  spline,
  threadOptions,
  union,
  vertexModel,
  lineAnchor,
  faceAnchor,
  vertexId,
  edgeId,
  surfaceId,
  anchor,
];

// @ts-expect-error Runtime identity is available only through tooling.
solid.nodeId;
// @ts-expect-error Runtime kind is not in the authoring whitelist.
solid.kind;
// @ts-expect-error Runtime labels are not in the authoring whitelist.
solid.name;
// @ts-expect-error Render appearance state is not directly observable by authors.
solid.color;
// @ts-expect-error Composition internals are available only through tooling.
solid.children;
// @ts-expect-error Anchor discriminators are not in the authoring whitelist.
solid.elementKind;
// @ts-expect-error Source traces are available only through tooling.
solid.sourceRefs;
// @ts-expect-error Parameter traces are available only through tooling.
solid.parameters;
// @ts-expect-error Runtime relation references are available only through tooling.
solid.relationAnchorReference();
// @ts-expect-error Group child replacement is not an approved author operation.
group([]).withChildren([]);
// @ts-expect-error Runtime instrumentation is available only through tooling.
solid.attachSource({file: 'model.ts', start: 0, end: 1});
// @ts-expect-error Runtime instrumentation is available only through tooling.
solid.attachParameters([]);
// @ts-expect-error Runtime instrumentation is available only through tooling.
solid.attachOperationTrace('site', 0, 0, {
  file: 'model.ts',
  start: 0,
  end: 1,
});
// @ts-expect-error Runtime graph traversal is available only through tooling.
solid.relatedObjects();
// @ts-expect-error Runtime snapshots are available only through tooling.
solid.toSnapshot();
// @ts-expect-error Kernel resource disposal is available only through tooling.
solid.disposeShape(new Set());
// @ts-expect-error Runtime instrumentation is available only through tooling.
constraint.attachSource({file: 'model.ts', start: 0, end: 1});
// @ts-expect-error Runtime instrumentation is available only through tooling.
constraint.attachParameters([]);
// @ts-expect-error Runtime trace references are available only through tooling.
constraint.traceReference();
// @ts-expect-error Constraint storage is a runtime implementation detail.
constraint.storeFor(solid);

// @ts-expect-error Groups do not expose geometric topology.
groupModel.vertex(1);
// @ts-expect-error Groups do not have geometric scaling.
groupModel.scaled(2);
// @ts-expect-error Groups do not support solid modifiers.
groupModel.fillet(1);
// @ts-expect-error Vertex models expose only vertex topology.
vertexModel.edge(1);
// @ts-expect-error Vertex models do not expose surface topology.
vertexModel.surface(1);
// @ts-expect-error Edge models do not expose surface topology.
edgeModel.surface(1);
// @ts-expect-error Face models do not support solid fillets.
faceModel.fillet(1);
// @ts-expect-error Face models do not support solid chamfers.
faceModel.chamfer(1);
// @ts-expect-error The general Model type contains only common capabilities.
model.scaled(2);
