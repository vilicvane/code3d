import {
  box,
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
  type ModelFamily,
  type ModelFamilyElementKind,
  type ModelForFamily,
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

export function recolor<
  Elements extends NamedElements,
  Family extends ModelFamily,
>(
  model: ModelCapabilities<Elements, Family>,
): ModelForFamily<Elements, Family> {
  return model.paint('#345678');
}

export function rotate<
  Elements extends NamedElements,
  Kind extends ModelGeometryKind,
>(
  model: GeometryCapabilities<Elements, Kind> &
    ModelCapabilities<Elements, Kind>,
): ModelForFamily<Elements, Kind> {
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
colored.mount.on(solid.up);
rotated.body.edges();
rounded.mount.on(solid.down);
// @ts-expect-error Exposed geometry is a reference, not a model value.
body.paint('#ffffff');

const elementKinds: Record<ModelKind, ElementKind> = {
  solid: 'frame',
  face: 'face',
  edge: 'line',
  vertex: 'point',
  group: 'frame',
};
const solidKind: ModelElementKind<'solid'> = 'frame';
const groupKind: ModelFamilyElementKind<'group'> = 'frame';

const kernel: Replicad = replicad;
const builder = (size: number): Shape3D =>
  kernel.makeBox([0, 0, 0], [size, size, size]);
const primitive: (size: number) => SolidModel = definePrimitive(builder);

void [topologyKind, elementKinds, solidKind, groupKind, primitive];

const sketchBase = sketch([['point', 1, [0, 0]]]);
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
