import {
  box,
  group,
  rectangle,
  type SolidModel,
  type FaceModel,
  type GroupModel,
} from '@code3d/core';
import {
  repeat,
  linear,
  radial,
  flex,
  grid,
  fillFlex,
  fillGrid,
  type Arranged,
  type Axis,
  type Alignment,
  type ContentAlignment,
  type Padding,
  type GridPadding,
  type GridTrack,
  type GridTracks,
  type LinearLayoutConfig,
  type RadialLayoutConfig,
  type FlexLayoutConfig,
  type GridLayoutConfig,
  type FillFlexLayoutConfig,
  type FillGridLayoutConfig,
} from '@code3d/layout';
import * as layout from '@code3d/layout';

const source = box(2, 4, 6);
const named = source.expose({mount: source.up});
const space = box(100, 100, 100);
const items = [named, rectangle(3, 4), group([source])] as const;
const copies: readonly (typeof named)[] = repeat(named, 3);
const axis: Axis = 'x';
const alignment: Alignment = 'center';
const content: ContentAlignment = 'space-evenly';
const padding: Padding = {start: 2, end: 3};
const gridPadding: GridPadding = {columns: padding, rows: 2};
const track: GridTrack = {fr: 2};
const tracks: GridTracks = [10, 'auto', track];
const linearConfig: LinearLayoutConfig = {axis, step: 8};
const radialConfig: RadialLayoutConfig = {axis: 'y', radius: 20, rotate: true};
const flexConfig: FlexLayoutConfig = {
  axis,
  crossAxis: 'z',
  gap: 2,
  padding,
  alignItems: alignment,
  justifyContent: content,
};
const gridConfig: GridLayoutConfig = {
  columns: tracks,
  rows: ['auto'],
  padding: gridPadding,
  axes: ['x', 'z'],
};
const fillFlexConfig: FillFlexLayoutConfig = {axis, gap: 2, padding};
const fillGridConfig: FillGridLayoutConfig = {
  axes: ['x', 'z'],
  columnGap: 3,
  rowGap: 4,
  padding: gridPadding,
};

for (const result of [
  linear(items, linearConfig),
  radial(items, radialConfig),
  flex(items, {axis}),
  flex(items, flexConfig),
  flex(items, space, flexConfig),
  grid(items, gridConfig),
  grid(items, space, gridConfig),
]) {
  const tuple: Arranged<typeof items> = result;
  const solid: SolidModel = tuple[0];
  const face: FaceModel = tuple[1];
  const assembled: GroupModel = tuple[2];
  tuple[0].mount;
  void [solid, face, assembled];
  // @ts-expect-error Returned tuples are readonly.
  tuple[0] = named;
}
const filledLine: readonly (typeof named)[] = fillFlex(
  named,
  space,
  fillFlexConfig,
);
const filledGrid: readonly (typeof named)[] = fillGrid(
  named,
  space,
  fillGridConfig,
);
fillFlex(named, space, {axis, gap: 0});
fillGrid(named, space, {axes: ['x', 'z'], gap: 0});
flex(copies, space, {
  axis,
  crossAxis: 'z',
  wrap: true,
  rowGap: 3,
  alignContent: 'space-around',
});
void [filledLine, filledGrid];

// @ts-expect-error Quantity belongs to repeat, not linear configuration.
linear(copies, {axis, count: 3, step: 10});
// @ts-expect-error Layout consumes a collection, not a prototype.
linear(named, {axis, step: 10});
// @ts-expect-error Quantity belongs to the input collection.
radial(copies, {axis: 'y', radius: 20, count: 3});
// @ts-expect-error Radial rotation is a boolean.
radial(copies, {axis: 'y', radius: 20, rotate: 'tangent'});
// @ts-expect-error The field is rotate, not rotateItems.
radial(copies, {axis: 'y', radius: 20, rotateItems: true});
// @ts-expect-error Old orientation modes are removed.
radial(copies, {axis: 'y', radius: 20, orientation: 'radial'});
// @ts-expect-error Target space is a separate argument.
flex(copies, {axis, space, gap: 2});
// @ts-expect-error Automatic flex filling is single-line only.
fillFlex(named, space, {axis, gap: 0, crossAxis: 'z', wrap: true});
// @ts-expect-error Grid filling determines its column count.
fillGrid(named, space, {axes: ['x', 'z'], gap: 0, columns: 3});
// @ts-expect-error Grid tracks replace the old per-axis count and step arrays.
grid(copies, {axes: ['x', 'z'], x: {count: 3, step: 10}});
// @ts-expect-error A grid needs its columns.
grid(copies, {axes: ['x', 'z'], gap: 2});
// @ts-expect-error Stack is replaced by flex.
layout.stack(items);
// @ts-expect-error Distribute is replaced by flex with a target space.
layout.distribute(items, space);
// @ts-expect-error Pack is replaced by fillFlex.
layout.pack(named, space, {gap: 2});

// Required geometry choices remain required when configuration is stored in a variable.
// @ts-expect-error Linear direction is explicit.
const missingLinearAxis: LinearLayoutConfig = {step: 2};
// @ts-expect-error Radial direction is explicit.
const missingRadialAxis: RadialLayoutConfig = {radius: 20};
// @ts-expect-error Flex direction is explicit.
const missingFlexAxis: FlexLayoutConfig = {gap: 2};
// @ts-expect-error Grid plane is explicit.
const missingGridAxes: GridLayoutConfig = {columns: 2};
// @ts-expect-error Flex filling needs an explicit direction.
const missingFillAxis: FillFlexLayoutConfig = {gap: 0};
// @ts-expect-error Grid filling needs an explicit plane.
const missingFillAxes: FillGridLayoutConfig = {gap: 0};
// @ts-expect-error Flex filling needs an explicit gap, including zero.
const missingFillGap: FillFlexLayoutConfig = {axis};
// @ts-expect-error Grid filling needs a shared gap or both directional gaps.
const missingGridGap: FillGridLayoutConfig = {axes: ['x', 'z']};
// @ts-expect-error One directional gap does not specify the other.
const missingRowGap: FillGridLayoutConfig = {axes: ['x', 'z'], columnGap: 2};
// @ts-expect-error One directional gap does not specify the other.
const missingColumnGap: FillGridLayoutConfig = {axes: ['x', 'z'], rowGap: 2};
// @ts-expect-error Cross alignment cannot infer a cross axis.
const missingAlignAxis: FlexLayoutConfig = {axis, alignItems: 'center'};
// @ts-expect-error Wrapping cannot infer a cross axis.
const missingWrapAxis: FlexLayoutConfig = {axis, wrap: true};
// @ts-expect-error Filling uses the same cross alignment requirement.
const missingFillCrossAxis: FillFlexLayoutConfig = {
  axis,
  gap: 0,
  alignItems: 'end',
};

// @ts-expect-error Content-sized flex still requires configuration.
flex(items);
// @ts-expect-error Bounded flex still requires configuration.
flex(items, space);
// @ts-expect-error Content-sized grid requires configuration.
grid(items);
// @ts-expect-error Bounded grid cannot fall back to one column.
grid(items, space);
// @ts-expect-error Flex filling requires configuration.
fillFlex(named, space);
// @ts-expect-error Grid filling requires configuration.
fillGrid(named, space);

// Runtime choices are supported when their required cross axis is provided.
declare const wrap: boolean;
flex(copies, space, {axis, crossAxis: 'z', wrap});
flex(copies, {axis, wrap: false});
fillGrid(named, space, {axes: ['x', 'z'], columnGap: 0, rowGap: 0});
fillGrid(named, space, {axes: ['x', 'z'], gap: 0, rowGap: 2});
