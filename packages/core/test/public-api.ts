import {
  arc,
  bezier,
  box,
  circle,
  coil,
  cut,
  cylinder,
  ellipse,
  extrude,
  font,
  googleFont,
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
  text,
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
  type Font,
  type GroupModel,
  type LineAnchor,
  type LoftOptions,
  type Model,
  type PlanarElements,
  type PointAnchor,
  type SolidModel,
  type Surface,
  type SurfaceId,
  type TextOptions,
  type TopologyId,
  type Vec3,
  type Vertex,
  type VertexId,
  type VertexModel,
} from '@code3d/core';
import {definePrimitive, replicad, type Shape3D} from '@code3d/core/replicad';
import {MeshPhysicalMaterial, type Material} from '@code3d/core/three';
import * as THREE from '@code3d/core/three';

// @ts-expect-error The concrete runtime class is not part of the authoring API.
import type {ModelObject} from '@code3d/core';
// @ts-expect-error Quaternions are a tooling transform detail for now.
import type {Quaternion} from '@code3d/core';
// @ts-expect-error Replicad builders are available only through the explicit subpath.
import {definePrimitive as rootDefinePrimitive} from '@code3d/core';
// @ts-expect-error Replicad values are available only through the explicit subpath.
import type {Shape3D as RootShape3D} from '@code3d/core';
// @ts-expect-error Package consumers cannot bypass the whitelist through private paths.
import type {ModelObject as InternalModelObject} from '@code3d/core/bld/library/runtime.js';

const solid = box(10, 5, 8);
// Runtime defaults do not make authored dimensions optional in TypeScript.
// @ts-expect-error Box dimensions remain required.
box();
// @ts-expect-error Partial box dimensions remain incomplete.
box(10);
// @ts-expect-error Explicit undefined remains a type error.
box(undefined, 10, 10);
// @ts-expect-error Circle radius remains required.
circle();
// @ts-expect-error Ellipse radii remain required.
ellipse();
// @ts-expect-error Rectangle dimensions remain required.
rectangle();
// @ts-expect-error Polygon radius and sides remain required.
regularPolygon();
// @ts-expect-error Cylinder dimensions remain required.
cylinder();
// @ts-expect-error Tube dimensions remain required.
tube();
// @ts-expect-error Coil dimensions remain required.
coil();
// @ts-expect-error Sphere radius remains required.
sphere();
// @ts-expect-error Frustum dimensions remain required.
frustum();
// @ts-expect-error Prism dimensions remain required.
regularPrism();
const sans: Font = font(new URL('./font.ttf', import.meta.url));
const play: Font = googleFont('Play');
const playBold: Font = googleFont('Play', {weight: 700, italic: false});
// @ts-expect-error Google Fonts weights are numeric.
googleFont('Play', {weight: 'bold'});
const textFaces: readonly FaceModel[] = text('B8i', sans, 10);
const textOptions: TextOptions = {letterSpacing: 0.5, kerning: false};
text('AV', sans, 10, textOptions);
text('AV', sans, 10, {});
// @ts-expect-error Kerning is a boolean switch.
text('AV', sans, 10, {kerning: 1});
// @ts-expect-error Letter spacing uses numeric model units.
text('AV', sans, 10, {letterSpacing: '1px'});
const textSolids: readonly SolidModel[] = extrude(textFaces, 2);
group(textSolids);
// @ts-expect-error Text requires an explicit font and size.
text('B8i');
// @ts-expect-error Text size remains required.
text('B8i', sans);
// @ts-expect-error The font is a required value, not an optional setting.
text('B8i', undefined, 10);
// @ts-expect-error Text accepts content, font, size in that order.
text('B8i', 10, sans);
const material: Material = new MeshPhysicalMaterial({
  roughness: 0.3,
  clearcoat: 1,
});
solid.material(material);
solid.material(new THREE.MeshStandardMaterial({color: '#f80'}));
// @ts-expect-error Material classes belong to the explicit Three.js entry.
import {MeshPhysicalMaterial as RootMeshPhysicalMaterial} from '@code3d/core';
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
      ['length', 3, 40],
      ['angle', 3, 0],
      ['x', 1, 0],
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
const related = solid.relate(self => self.center.on(solid.up.flip()));
const exposed = related.expose({mount: related.down});
const constraint: Constraint = exposed.mount.on(solid.up).offset(1, 2, 3);
const anchor: Anchor = exposed.mount;
const vertex: Vertex = solid.vertex(1);
const edge: Edge = solid.edge(1);
const surface: Surface = solid.surface(1);
const vertexId: VertexId = vertex.id;
const edgeId: EdgeId = edge.id;
const surfaceId: SurfaceId = surface.id;
const topologyKinds: readonly ['vertex', 'edge', 'surface'] = [
  vertex.kind,
  edge.kind,
  surface.kind,
];
solid.fillet(
  1,
  solid.edges().map(edge => edge.id),
);
solid.shell(1);
solid.shell(-1, [surfaceId]);
solid.shell(1, []);
// @ts-expect-error Topology IDs are readonly author properties.
vertex.id = 2;
// @ts-expect-error Topology discriminators are readonly author properties.
edge.kind = 'edge';
// @ts-expect-error Topology references do not expose their owning runtime model.
surface.model;
// @ts-expect-error Topology frames belong to tooling.
edge.transform;
// @ts-expect-error Anchor implementation discriminators belong to tooling.
vertex.elementKind;
const vector: Vec3 = [1, 2, 3];
const model: Model = solid;
const solidModel: SolidModel<CanonicalElements> = solid;
const tubeModel: SolidModel<CanonicalElements> = tube(6, 4, 12);
const coilModel: SolidModel<CanonicalElements> = coil(5, 0.75, 4, 2.5);
// @ts-expect-error Coil dimensions are required numeric parameters.
coil(5, 0.75, 4, '2.5');
// @ts-expect-error The turn count remains required in the public signature.
coil(5, 0.75, 4);
// @ts-expect-error Tube dimensions are required, with no option bag or overload.
tube(6, {wall: 2}, 12);
// @ts-expect-error Tube dimensions are required.
tube(6, 4);
const faceModel: FaceModel<PlanarElements> = circle(4);
const extrudedFace: SolidModel = faceModel.extrude(3);
const extrudedProfile: SolidModel = extrude(faceModel.rotate(0, 0, 90), -3);
const extrudedFaces: readonly SolidModel[] = extrude([faceModel], 3);
// @ts-expect-error A solid is not an extrusion profile.
extrude(solid, 3);
// @ts-expect-error Only face models expose extrusion.
solid.extrude(3);
// @ts-expect-error Extrusion distance is required.
faceModel.extrude();
// @ts-expect-error Extrusion distance is numeric.
faceModel.extrude('3');
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
const faceAnchor: FaceAnchor = solid.up;
// @ts-expect-error Plain anchors do not have topology IDs.
faceAnchor.id;
// @ts-expect-error Plain anchors do not expose a public discriminator.
pointAnchor.kind;
// @ts-expect-error Named anchor storage belongs to tooling.
lineAnchor.reference;
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
  .material('#fff')
  .originOffset(1, 2, 3)
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
  .expose({mount: solid.down})
  .relate(self => self.mount.on(solid.up))
  .fillet(1, [edgeId]);
faceModel
  .originCenter()
  .originVertex(1)
  .originOffset(0, 2, 0)
  .rotate(90, 0, 0)
  .scaled(2)
  .relate(self => self.on(solid.up))
  .expose({mount: solid.down})
  .surface(1);
faceModel.vertex(1);
faceModel.edge(1);
faceModel.surfaces();
edgeModel
  .originCenter()
  .originOffset(0, 0, 0)
  .rotate(0, 0, 90)
  .scaled(2)
  .relate(self => self.start.on(solid.up))
  .expose({mount: solid.axis})
  .edge(1);
edgeModel.vertex(1);
edgeModel.edges();
vertexModel
  .originCenter()
  .originOffset(0, 0, 0)
  .rotate(0, 90, 0)
  .scaled(2)
  .relate(self => self.on(solid.up))
  .expose({mount: solid.center})
  .vertex(1);
vertexModel.vertices();
groupModel
  .material('#fff')
  .relate(self => self.on(solid.up))
  .expose({mount: solid.up})
  .relate(self => self.mount.on(solid.down));
union([solid, exposed]);
cut(solid, [exposed]);
intersect([solid, exposed]);
loft([faceModel, faceModel.relate(self => self.on(solid.down))], {
  spine: edgeModel,
});
constraint.pivot([1, 2, 3]).rotate(0, 45, 0);
constraint.pivotVertex(1).rotate(0, 0, 90);
constraint.pivotVertex([1, 3]).rotate(0, 0, 90);
constraint.around(solid.axis).rotate(45);
constraint.rotate(0, 45, 90);
// @ts-expect-error on only accepts directional bounds.
solid.on(solid.center);
// @ts-expect-error on does not accept a whole target model.
solid.on(solid);
// @ts-expect-error unfinished pivot selection is not a Constraint.
solid.relate(self => self.on(solid.up).pivot([1, 2, 3]));
// @ts-expect-error Constraint no longer has flip.
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
  extrudedFace,
  extrudedProfile,
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
  topologyKinds,
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
solid.materialSnapshot;
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
// @ts-expect-error Group child replacement is not part of the authoring API.
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
// @ts-expect-error Face models do not support solid shelling.
faceModel.shell(1);
// @ts-expect-error Groups do not support solid shelling.
groupModel.shell(1);
// @ts-expect-error The general Model type contains only common capabilities.
model.scaled(2);

groupModel.rotate(0, 90, 0);
groupModel.originOffset(0, 0, 0).originPoint(solid.center);
model.originPoint(pointAnchor).originOffset(1, 2, 3).rotate(10, 20, 30);
solid.originPoint(solid.vertex(1)).fillet(1);
faceModel.originPoint(faceModel.center).surface(1);
edgeModel.originPoint(edgeModel.start).edge(1);
vertexModel.originPoint(vertexModel).vertex(1);
// @ts-expect-error Choose a point on an edge rather than the edge itself.
solid.originPoint(edgeModel);
// @ts-expect-error A plane has no unique point.
solid.originPoint(solid.up);
// @ts-expect-error Coordinates are offsets, not point references.
solid.originPoint([1, 2, 3]);
// @ts-expect-error Groups have no aggregated topology vertex namespace.
groupModel.originVertex(1);
// @ts-expect-error Groups do not have a geometric center.
groupModel.originCenter();
// @ts-expect-error Center setters do not take coordinates.
solid.originCenter(1, 2, 3);
const curveCenter: PointAnchor = edgeModel.center;
const pointCenter: PointAnchor = vertexModel.center;
void [curveCenter, pointCenter];

const geometricMembers = group([
  solid,
  faceModel,
  edgeModel,
  vertexModel,
]).expose({
  body: solid,
  profile: faceModel,
  path: edgeModel,
  location: vertexModel,
  mount: surface,
  rim: edge,
});
const exposedSolid: import('@code3d/core').Solid = geometricMembers.body;
const exposedSurface: Surface = geometricMembers.profile;
const exposedEdge: Edge = geometricMembers.path;
const exposedVertex: Vertex = geometricMembers.location;
const nested = group([geometricMembers]).expose({component: geometricMembers});
const rebound = group([nested]).expose({component: nested.component});
rebound.component.body.surface(1).center;
geometricMembers.body.surface(1).edge(1).vertex(1).center;
geometricMembers.mount.edges();
geometricMembers.rim.midpoint;
geometricMembers.body.on(solid.down);
geometricMembers.relate(self => self.mount.center.on(solid.up));
// @ts-expect-error Exposed geometry is a topology reference, not a mutable member model.
geometricMembers.body.fillet(1);
// @ts-expect-error Topology references do not expose model transforms.
geometricMembers.path.rotate(0, 90, 0);
// @ts-expect-error Vertices do not contain edges.
geometricMembers.location.edge(1);
// @ts-expect-error An ordinary plane anchor has no topological boundary.
solid.up.edges();
void [exposedSolid, exposedSurface, exposedEdge, exposedVertex];

const inheritedId: TopologyId = [1, 2, 3];
solid.surface([1, 1]);
solid.edge(inheritedId);
solid.vertices([1, [2, 3], inheritedId]);
solid.fillet(1, [[1, 2], inheritedId]);
solid.originVertex([1, 2]);
// @ts-expect-error Paths include at least one input index and a local ID.
solid.surface([1]);
// @ts-expect-error Paths are flat numeric tuples.
solid.surface([1, [2, 3]]);

const alignPoint: Constraint = point().align(line([0, 0, 0], [1, 0, 0]));
const alignCurve: Constraint = line([0, 0, 0], [0, 1, 0])
  .reverse()
  .align(box(1, 1, 1).axis.reverse());
const alignSurface: Constraint = rectangle(2, 3)
  .flip()
  .align(circle(2).plane.flip());
box(2, 2, 2).relate(self =>
  self.center.align(point()).offset(1, 2, 3).pivotVertex(1).rotate(20, 30, 40),
);
// @ts-expect-error Solids do not describe one point, curve, or surface.
box(1, 1, 1).align(point());
// @ts-expect-error Select a solid's geometry before using it as an align target.
point().align(box(1, 1, 1));
// @ts-expect-error Points have no curve direction.
point().center.reverse();
void [alignPoint, alignCurve, alignSurface];

// @ts-expect-error Positions use an array, not scalar coordinates.
point(1, 2, 3);
// @ts-expect-error A line endpoint is a position array.
line(10, 0, 0);
// @ts-expect-error Model origin is always local zero and has no setter.
box(1, 2, 3).origin(1, 2, 3);
box(1, 2, 3).relate(self =>
  self
    .on(box(4, 5, 6).up)
    // @ts-expect-error A pivot is a position array.
    .pivot(1, 2, 3)
    .rotate(0, 0, 90),
);
