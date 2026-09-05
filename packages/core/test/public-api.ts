import {
  arc,
  bezier,
  box,
  circle,
  coil,
  cut,
  cylinder,
  ellipse,
  frustum,
  group,
  intersect,
  line,
  loft,
  point,
  rectangle,
  regularPolygon,
  regularPrism,
  sketch,
  spline,
  sphere,
  tube,
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
import {
  definePrimitive,
  replicad,
  type Shape3D,
} from '../bld/library/replicad.js';

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
// @ts-expect-error Replicad builders are available only through the explicit subpath.
import {definePrimitive as rootDefinePrimitive} from '../bld/library/index.js';
// @ts-expect-error Replicad values are available only through the explicit subpath.
import type {Shape3D as RootShape3D} from '../bld/library/index.js';

const solid = box(10, 5, 8);
const sketchValue = sketch([
  ['point', 1, [0, 0]],
  ['point', 2, [10, 0]],
  ['line', 3, [1, 2]],
]);
sketch(
  [
    ['point', 1, [0, 0]],
    ['point', 2, [40, 0]],
    ['line', 3, [1, 2]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['horizontal', 3],
      ['length', [3, 40]],
      ['angle', [3, 0]],
      ['x', [1, 0]],
      ['coincident', [1, 2]],
    ],
  },
);
// @ts-expect-error Constraints do not carry persistent IDs.
sketch([], {constraints: [['horizontal', 10, 3]]});
// @ts-expect-error Single-target constraints take a scalar reference, not an array.
sketch([], {constraints: [['fixed', [1]]]});
sketchValue.derive([
  ['point', 1, [0, 5]],
  ['line', 2, [sketchValue.point(2), 1]],
]);
// @ts-expect-error Point coordinates are a nested two-number tuple.
sketch([['point', 1, 0, 0]]);
// @ts-expect-error There is no persistent nextId item.
sketch([['point', 1, [0, 0]], 2]);
// @ts-expect-error A line has exactly two point references.
sketch([['line', 3, [1, 2, 4]]]);
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
const tubeModel: SolidModel<CanonicalElements> = tube(6, 4, 12);
const coilModel: SolidModel<CanonicalElements> = coil(5, 0.75, 4, 2.5);
// @ts-expect-error Coil dimensions are required numeric parameters.
coil(5, 0.75, 4, '2.5');
// @ts-expect-error No implicit default turn count.
coil(5, 0.75, 4);
// @ts-expect-error Tube dimensions are required, with no option bag or overload.
tube(6, {wall: 2}, 12);
// @ts-expect-error Tube dimensions are required.
tube(6, 4);
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
const customPrimitive = definePrimitive((radius: number, height = 4) =>
  replicad.makeCylinder(radius, height),
);
const customSolid: SolidModel = customPrimitive(2);
const primitiveShape: Shape3D = replicad.makeCylinder(1, 1);
// @ts-expect-error The builder's argument types are preserved.
customPrimitive('2');
// @ts-expect-error Defaulted parameters retain their inferred type.
customPrimitive(2, '4');
// @ts-expect-error The builder's required arguments are preserved.
customPrimitive();
// @ts-expect-error Builders must return a Replicad solid synchronously.
definePrimitive(async () => replicad.makeCylinder(1, 1));
// @ts-expect-error Kernel access remains owned by code3d.
replicad.getOC();
// @ts-expect-error Kernel replacement remains owned by code3d.
replicad.setOC(undefined);

solid
  .paint('#fff')
  .origin(1, 2, 3)
  .originOffset(0, 1, 0)
  .originVertex(1)
  .originCenter()
  .rotate(15, 30, 45)
  .scaled(2)
  .fillet(1)
  .chamfer(0.5);
solid.vertices();
solid.edges();
solid.surfaces();
solid
  .expose({mount: solid.bottom})
  .relate(self => self.mount.on(solid.top))
  .fillet(1, [edgeId]);
faceModel
  .originCenter()
  .originVertex(1)
  .originOffset(0, 2, 0)
  .rotate(90, 0, 0)
  .scaled(2)
  .relate(self => self.plane.on(solid.top))
  .expose({mount: solid.bottom})
  .surface(1);
faceModel.vertex(1);
faceModel.edge(1);
faceModel.surfaces();
edgeModel
  .originCenter()
  .origin(0, 0, 0)
  .rotate(0, 0, 90)
  .scaled(2)
  .relate(self => self.start.on(solid.center))
  .expose({mount: solid.axis})
  .edge(1);
edgeModel.vertex(1);
edgeModel.edges();
vertexModel
  .originCenter()
  .origin(0, 0, 0)
  .rotate(0, 90, 0)
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
  customSolid,
  definePrimitive,
  ellipse,
  faceModel,
  frustum,
  group,
  groupModel,
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
  tubeModel,
  coilModel,
  union,
  vertexModel,
  lineAnchor,
  faceAnchor,
  vertexId,
  edgeId,
  surfaceId,
  anchor,
  rootDefinePrimitive,
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

// @ts-expect-error Groups do not contain geometry to rotate.
groupModel.rotate(0, 90, 0);
// @ts-expect-error Groups do not expose geometric origin editing.
groupModel.origin(0, 0, 0);
// @ts-expect-error Groups do not have a geometric center.
groupModel.originCenter();
// @ts-expect-error Center setters do not take coordinates.
solid.originCenter(1, 2, 3);
const curveCenter: PointAnchor = edgeModel.center;
const pointCenter: PointAnchor = vertexModel.center;
void [curveCenter, pointCenter];
