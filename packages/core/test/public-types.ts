import {on, input, timeOffset} from '@code3d/core';
import {
  box,
  anchorAnnotation,
  boundsAnnotation,
  captureInspectData,
  dimension,
  distance,
  group,
  line,
  type Anchor,
  type Inspector,
  type PreviewValue,
  type DistanceAxis,
  extrude,
  sketch,
  type SketchConstraint,
  type EdgeTopologyCapabilities,
  type ElementKind,
  type ElementSources,
  type ExposedElements,
  type ExposedValue,
  type GeometryCapabilities,
  type GeometryQueryCapabilities,
  type MergedElements,
  type ModelCapabilities,
  type ModelElementKind,
  type ModelForKind,
  type ModelGeometryKind,
  type ModelKind,
  type NamedElements,
  type SolidModel,
  type SolidModificationCapabilities,
  type SurfaceTopologyCapabilities,
  type TopologyKind,
  type VertexTopologyCapabilities,
} from '@code3d/core';
import {
  definePrimitive,
  replicad,
  type Replicad,
  type Shape3D,
} from '@code3d/core/replicad';

export function exposeElements<
  Elements extends NamedElements,
  const Sources extends ElementSources,
>(
  model: SolidModel<Elements>,
  sources: Sources,
): SolidModel<MergedElements<Elements, ExposedElements<Sources>>> {
  return model.expose(sources);
}

export function recolor<Elements extends NamedElements, Kind extends ModelKind>(
  model: ModelCapabilities<Elements, Kind>,
): ModelForKind<Elements, Kind> {
  return model.material('#345678');
}

export function rotate<
  Elements extends NamedElements,
  Kind extends ModelGeometryKind,
>(
  model: GeometryCapabilities<Elements, Kind> &
    ModelCapabilities<Elements, Kind>,
): ModelForKind<Elements, Kind> {
  return model.rotate(0, 90, 0);
}

export function round<Elements extends NamedElements>(
  model: SolidModificationCapabilities<Elements>,
): SolidModel<Elements> {
  return model.fillet(1);
}

export function boundaryPoints(model: SurfaceTopologyCapabilities) {
  const face: EdgeTopologyCapabilities = model.surface(1);
  const edge: VertexTopologyCapabilities = face.edge(1);
  return edge.vertices();
}

export function centerOf(model: GeometryQueryCapabilities) {
  return model.center;
}

const solid = box(10, 10, 10);
const exposed = exposeElements(solid, {body: solid, mount: solid.down});
const body: ExposedValue<typeof solid> = exposed.body;
const topologyKind: TopologyKind = body.surface(1).kind;
const colored: typeof exposed = recolor(exposed);
const rotated: typeof exposed = rotate(exposed);
const rounded: typeof exposed = round(exposed);
on(colored.mount, solid.up);
rotated.body.edges();
on(rounded.mount, solid.down);
// @ts-expect-error Exposed geometry is a reference, not a model value.
body.material('#ffffff');

const elementKinds: Record<ModelKind, ElementKind> = {
  solid: 'frame',
  face: 'face',
  edge: 'line',
  vertex: 'point',
  group: 'frame',
};
const solidKind: ModelElementKind<'solid'> = 'frame';
const groupKind: ModelElementKind<'group'> = 'frame';

const kernel: Replicad = replicad;
const builder = (size: number): Shape3D =>
  kernel.makeBox([0, 0, 0], [size, size, size]);
const primitive: (size: number) => SolidModel = definePrimitive(builder);

void [topologyKind, elementKinds, solidKind, groupKind, primitive];

const sketchBase = sketch([['point', 1, [0, 0]]]);
sketch();
sketchBase.derive();
const sketchFaces = sketchBase.faces();
sketchFaces.map(face => extrude(face, 10));
sketchBase.face().extrude(10).cut([solid]);
// @ts-expect-error A face array is ordinary data, not a geometry operation receiver.
sketchFaces.extrude(10);
extrude(sketchFaces, 10);
// @ts-expect-error Extrusion is a face operation, not a solid modification.
solid.extrude(10);
const midpoint: SketchConstraint = ['midpoint', [1, 2, sketchBase.point(1)]];
sketchBase.derive(
  [
    ['point', 1, [10, 0]],
    ['point', 2, [20, 0]],
  ],
  {constraints: [midpoint]},
);
// @ts-expect-error A midpoint constraint requires three point references.
const missingEndpoint: SketchConstraint = ['midpoint', [1, 2]];
// @ts-expect-error Coordinates are not point references.
const coordinateEndpoint: SketchConstraint = ['midpoint', [1, 2, [0, 0]]];
void [missingEndpoint, coordinateEndpoint];
// @ts-expect-error Constraint dimensions use separate target and value fields.
const nestedLength: SketchConstraint = ['length', [3, 20]];
// @ts-expect-error A dimensional constraint requires its third value field.
const missingLength: SketchConstraint = ['length', 3];
// @ts-expect-error Coordinate constraints likewise keep target and value separate.
const nestedX: SketchConstraint = ['x', [1, 10]];
void [nestedLength, missingLength, nestedX];

sketchBase.derive(
  [
    ['point', 1, [10, 0]],
    ['point', 2, [0, 10]],
    ['arc', 3, [sketchBase.point(1), 10, 1, 2, 'cw']],
  ],
  {
    constraints: [
      ['radius', 3, 10],
      ['sweep', 3, 270],
    ],
  },
);
// @ts-expect-error Arc direction is explicit, not an omitted default.
sketch([['arc', 1, [2, 10, 3, 4]]]);
// @ts-expect-error Arc endpoints are point references, not coordinate tuples.
sketch([['arc', 1, [2, 10, [10, 0], 4, 'ccw']]]);
// @ts-expect-error Sweep references a local arc ID, not a point handle.
const invalidSweep: SketchConstraint = ['sweep', sketchBase.point(1), 90];
void invalidSweep;

export function measured(a: Anchor, b: Anchor, axis?: DistanceAxis): number {
  return distance(a, b, axis);
}
const geometry = group([solid]).expose({body: solid});
const axis = line([1, 0, 0]);
distance(geometry, solid);
distance(geometry.body.surface(1), solid.vertex(1), axis);
distance(solid.left, solid.right, 'x');
distance(solid.center, solid.vertex(1), [1, 2, 3]);
// @ts-expect-error A face is not an axis direction.
distance(solid, geometry, solid.up);
// @ts-expect-error Named directions are x, y or z.
distance(solid, geometry, 'horizontal');
// @ts-expect-error Geometry operands must carry model/reference ownership.
distance([0, 0, 0], solid);

captureInspectData({model: solid, length: 10});
const inspectLength: Inspector<
  [SolidModel],
  number,
  undefined,
  {model: SolidModel; length: number} | undefined
> = (_args, context) =>
  context.data
    ? {
        target: [
          context.data.model,
          anchorAnnotation(context.data.model.axis, {direction: 'forward'}),
          dimension({
            owner: context.data.model,
            start: [0, 0, 0],
            end: [context.data.length, 0, 0],
            value: context.data.length,
          }),
          boundsAnnotation({
            owner: context.data.model,
            size: [context.data.length, 2, 3],
            frame: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]},
          }),
        ],
      }
    : undefined;
void inspectLength;

const candidateDimension: PreviewValue = dimension({
  owner: box(12, 14, 16),
  value: 12,
  candidates: [{start: [-6, -7, -8], end: [6, -7, -8]}],
});
void candidateDimension;

export function readonlyMeasurements() {
  const body = box(2, 3, 4);
  const edge = line([3, 4, 0]);
  const values: number[] = [
    edge.length,
    body.edge(1).length,
    body.area,
    body.volume,
    group([body]).expose({body}).body.volume,
    body.surface(1).area,
  ];
  // @ts-expect-error Measurements are read-only.
  edge.length = 7;
  // @ts-expect-error Measurements are read-only.
  body.area = 7;
  // @ts-expect-error Measurements are read-only.
  body.volume = 7;
  // @ts-expect-error Finite faces have no volume.
  body.surface(1).volume;
  // @ts-expect-error Finite edges have no volume.
  edge.volume;
  // @ts-expect-error Groups have no aggregate volume.
  group([body]).volume;
  // @ts-expect-error Infinite reference axes have no length.
  body.axis.length;
  // @ts-expect-error Infinite reference planes have no area.
  body.up.area;
  // @ts-expect-error Groups have no aggregate area.
  group([body]).area;
  return values;
}

const offset: number = timeOffset();
void offset;
// @ts-expect-error A standalone default is a number of seconds.
timeOffset('time');

const width: number = input('Width', 40);
const boundedWidth: number = input('Width', 40, {min: 1, max: 100, step: 0.5});
// @ts-expect-error Input steps must be numeric.
input('Width', 40, {step: '1'});
void width;
// @ts-expect-error Numeric inputs require a numeric default.
input('Name', 'Box');
// @ts-expect-error A default is required outside host evaluations.
input('Width');
