import {
  box,
  circle,
  group,
  line,
  point,
  type GroupModel,
  type Model,
  type ModelCapabilities,
  type ModelForKind,
  type ModelKind,
  type NamedElements,
  type SolidModel,
} from '@code3d/core';

// Also checked by the actual Monaco language service in the App browser tests.
const solid = box(10, 12, 14);
const inner = group([solid]);
const empty = group([]);
const outer: GroupModel = group([inner, solid, empty]);
const nested: GroupModel = group([group([outer, inner]), empty]);
const erased: Model = inner;
const members: readonly Model[] = [
  inner,
  empty,
  solid,
  circle(2),
  line([0, 0, 0], [1, 0, 0]),
  point([1, 2, 3]),
];
group(members);

function identity<Value extends Model>(value: Value): Value {
  return value;
}
const retained: GroupModel = identity(inner);

function rotate<Elements extends NamedElements, Kind extends ModelKind>(
  model: ModelCapabilities<Elements, Kind>,
): ModelForKind<Elements, Kind> {
  return model.rotate(0, 45, 0);
}
const rotated: GroupModel = rotate(inner);
const rounded: SolidModel = rotate(solid).fillet(1);
const moved: GroupModel = inner
  .originOffset(1, 2, 3)
  .originPoint(solid.center)
  .rotate(0, 90, 0)
  .material('#abcdef')
  .relate(self => self.on(solid.up));
const general: Model = erased
  .rotate(0, 90, 0)
  .material('#abcdef')
  .relate(self => self.on(solid.up));

const exposed = inner.expose({body: solid, mount: solid.up});
const exposedGeneral: Model<{mount: typeof solid.up}> = exposed;
exposedGeneral.rotate(0, 90, 0).mount.on(solid.up);
erased.expose({mount: solid.up}).material('#abcdef').mount.on(solid.up);
group([exposed, exposedGeneral, exposed.rotate(0, 90, 0)]);

// @ts-expect-error A group remains distinct from a solid.
const wrongKind: SolidModel<{}> = inner;
// @ts-expect-error Groups have no geometry operations.
inner.fillet(1);
// @ts-expect-error General models do not promise solid operations.
general.cut([solid]);
// @ts-expect-error Topology references are not model values.
group([solid.up]);
// @ts-expect-error Exposure returns an immutable reference, not a child model.
group([exposed.body]);

void [nested, retained, rotated, rounded, moved, wrongKind];
