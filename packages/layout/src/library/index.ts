import type {Model, ModelBounds, Vec3} from '@code3d/core';

export type Axis = 'x' | 'y' | 'z';
export type Alignment = 'start' | 'center' | 'end';
export type ContentAlignment =
  Alignment | 'space-between' | 'space-around' | 'space-evenly';
export type Padding = number | Readonly<{start?: number; end?: number}>;
export type Arranged<Models extends readonly Model[]> = {
  readonly [Index in keyof Models]: Models[Index];
};
export type LinearLayoutConfig = Readonly<{
  axis: Axis;
  /** Signed displacement between successive input models. */
  step: number;
}>;
export type RadialLayoutConfig = Readonly<{
  radius: number;
  axis: Axis;
  startAngle?: number;
  /** Signed sweep in degrees, at most one full turn. */
  sweepAngle?: number;
  /** Rotate each input by its sample angle; default: false. */
  rotate?: boolean;
}>;
type FlexSpacingConfig = Readonly<{
  axis: Axis;
  gap?: number;
  padding?: Padding;
  crossPadding?: Padding;
  justifyContent?: ContentAlignment;
}>;
type FlexItemAlignment =
  | Readonly<{
      /** Required for cross alignment and wrapping. */
      crossAxis: Axis;
      /** Omit to preserve cross coordinates in a single line. */
      alignItems?: Alignment;
    }>
  | Readonly<{crossAxis?: never; alignItems?: never}>;
export type FlexLayoutConfig = FlexSpacingConfig &
  FlexItemAlignment &
  Readonly<{
    /** Clearance between wrapped lines; default: gap. */
    rowGap?: number;
    /** Align wrapped lines in the cross interval; default: start. */
    alignContent?: ContentAlignment;
  }> &
  (
    | Readonly<{wrap?: false}>
    /** Wrapping requires an explicit cross axis and target space. */
    | Readonly<{wrap: true; crossAxis: Axis}>
  );
export type FillFlexLayoutConfig = FlexSpacingConfig &
  FlexItemAlignment &
  Readonly<{
    /** Required minimum clearance; use zero for touching copies. */
    gap: number;
  }>;
/** A fixed size, the largest item size, or a share of the available track space. */
export type GridTrack = number | 'auto' | Readonly<{fr: number}>;
/** A positive number of auto tracks, or an explicit track list. */
export type GridTracks = number | readonly GridTrack[];
export type GridPadding =
  number | Readonly<{columns?: Padding; rows?: Padding}>;
export type GridLayoutConfig = Readonly<{
  /** Required column axis followed by row axis. */
  axes: readonly [Axis, Axis];
  columns: GridTracks;
  /** Missing rows are added as auto tracks to accommodate all inputs. */
  rows?: GridTracks;
  gap?: number;
  columnGap?: number;
  rowGap?: number;
  padding?: GridPadding;
  justifyContent?: ContentAlignment;
  alignContent?: ContentAlignment;
  justifyItems?: Alignment;
  alignItems?: Alignment;
}>;
/** Specify a shared gap or both directional gaps, including explicit zeros. */
export type FillGridLayoutConfig = Omit<GridLayoutConfig, 'columns' | 'rows'> &
  (Readonly<{gap: number}> | Readonly<{columnGap: number; rowGap: number}>);

const components = {x: 0, y: 1, z: 2} as const;
function axisIndex(axis: Axis): number {
  const index = components[axis];
  if (typeof index !== 'number')
    throw new Error('Layout axis must be x, y or z.');
  return index;
}
function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}
function nonnegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new Error(`${name} must be nonnegative.`);
}
function validateCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Count must be a nonnegative safe integer.');
}
function translated<T extends Model>(model: T, delta: Vec3): T {
  // originOffset(d) expresses the same geometry at p - d.
  return model.originOffset(-delta[0], -delta[1], -delta[2]) as T;
}
function axisDelta(axis: Axis, distance: number): Vec3 {
  const delta: [number, number, number] = [0, 0, 0];
  delta[axisIndex(axis)] = distance;
  return delta;
}
function plane(first: Axis, second: Axis): readonly [number, number] {
  if (first === second) throw new Error('Layout axes must be different.');
  return [axisIndex(first), axisIndex(second)];
}
function measurements(models: readonly Model[]): readonly ModelBounds[] {
  const measured = new Map<Model, ModelBounds>();
  return models.map(model => {
    let bounds = measured.get(model);
    if (!bounds) measured.set(model, (bounds = model.bounds()));
    return bounds;
  });
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
function maximum(values: readonly number[]): number {
  return values.reduce((largest, value) => Math.max(largest, value), 0);
}
function extent(sizes: readonly number[], gap: number): number {
  return sum(sizes) + Math.max(0, sizes.length - 1) * gap;
}
function inset(padding: Padding = 0): readonly [number, number] {
  const {start = 0, end = 0} =
    typeof padding === 'number' ? {start: padding, end: padding} : padding;
  nonnegative('Start padding', start);
  nonnegative('End padding', end);
  return [start, end];
}
type Interval = Readonly<{minimum: number; span: number; tolerance: number}>;
function interval(
  bounds: ModelBounds | undefined,
  axis: number,
  padding: Padding | undefined,
  natural: number,
): Interval {
  const [start, end] = inset(padding);
  const minimum = bounds?.minimum[axis] ?? 0;
  const maximum = bounds?.maximum[axis] ?? natural + start + end;
  const span = maximum - minimum - start - end;
  const tolerance =
    32 *
    Number.EPSILON *
    Math.max(Math.abs(minimum), Math.abs(maximum), start, end);
  if (span < -tolerance)
    throw new Error('Padding must fit within the target bounds.');
  return {minimum: minimum + start, span: Math.max(0, span), tolerance};
}
function alignmentOffset(free: number, alignment: Alignment): number {
  return alignment === 'end' ? free : alignment === 'center' ? free / 2 : 0;
}
function spacing(
  target: Interval,
  sizes: readonly number[],
  gap: number,
  alignment: ContentAlignment = 'start',
): Readonly<{start: number; gap: number}> {
  const remaining = target.span - extent(sizes, gap);
  if (remaining < -target.tolerance)
    throw new Error('Layout sizes and gaps must fit within the target bounds.');
  const free = Math.max(0, remaining);
  let leading = 0,
    extra = 0;
  if (alignment === 'end' || alignment === 'center')
    leading = alignmentOffset(free, alignment);
  else if (alignment === 'space-between' && sizes.length > 1)
    extra = free / (sizes.length - 1);
  else if (alignment === 'space-around' && sizes.length) {
    extra = free / sizes.length;
    leading = extra / 2;
  } else if (alignment === 'space-evenly' && sizes.length) {
    extra = free / (sizes.length + 1);
    leading = extra;
  }
  return {start: target.minimum + leading, gap: gap + extra};
}
function fitsCount(width: number, target: Interval, gap: number): number {
  const pitch = width + gap;
  if (pitch === 0)
    throw new Error(
      'Filling requires a positive model width or gap on each fill axis.',
    );
  let length = Math.floor((target.span + gap) / pitch);
  // Absorb arithmetic roundoff only, without quantizing author dimensions.
  if ((length + 1) * width + length * gap <= target.span + target.tolerance)
    length++;
  validateCount(length);
  return length;
}
function layoutArguments<Config extends object>(
  spaceOrConfig: Model | Config,
  config: Config | undefined,
): readonly [Model | undefined, Config] {
  if (!spaceOrConfig) throw new Error('Layout configuration is required.');
  if ('bounds' in spaceOrConfig) {
    if (!config) throw new Error('Layout configuration is required.');
    return [spaceOrConfig, config];
  }
  return [undefined, spaceOrConfig];
}

/** Repeat an immutable model value; layout functions create the positioned results. */
export function repeat<T extends Model>(model: T, count: number): readonly T[] {
  validateCount(count);
  return Array.from({length: count}, () => model);
}

/** Displace input i by i * step in local coordinates, independently of its size. */
export function linear<const Models extends readonly Model[]>(
  models: Models,
  config: LinearLayoutConfig,
): Arranged<Models> {
  axisIndex(config.axis);
  finite('Step', config.step);
  return models.map((model, index) =>
    translated(model, axisDelta(config.axis, index * config.step)),
  ) as unknown as Arranged<Models>;
}

/**
 * Arrange inputs about local zero. Full circles omit the duplicate endpoint;
 * partial arcs include both endpoints. Positive angles follow Core rotations.
 */
export function radial<const Models extends readonly Model[]>(
  models: Models,
  config: RadialLayoutConfig,
): Arranged<Models> {
  nonnegative('Radius', config.radius);
  const {axis, startAngle = 0, sweepAngle = 360, rotate = false} = config;
  axisIndex(axis);
  finite('Start angle', startAngle);
  finite('Sweep angle', sweepAngle);
  if (Math.abs(sweepAngle) > 360)
    throw new Error('Sweep angle must be within one turn.');
  const closed = Math.abs(sweepAngle) === 360;
  const increment =
    models.length <= 1
      ? 0
      : sweepAngle / (closed ? models.length : models.length - 1);
  return models.map((model, index) => {
    const angle = startAngle + index * increment;
    const radians = (angle * Math.PI) / 180;
    const u = config.radius * Math.cos(radians),
      v = config.radius * Math.sin(radians);
    const delta: Vec3 =
      axis === 'x' ? [0, u, v] : axis === 'y' ? [u, 0, -v] : [u, v, 0];
    return translated(
      rotate ? model.rotate(...axisDelta(axis, angle)) : model,
      delta,
    );
  }) as unknown as Arranged<Models>;
}

/** Arrange fixed-size inputs in content-sized local space. */
export function flex<const Models extends readonly Model[]>(
  models: Models,
  config: FlexLayoutConfig,
): Arranged<Models>;
/** Arrange fixed-size inputs within a model's local bounds. */
export function flex<const Models extends readonly Model[]>(
  models: Models,
  space: Model,
  config: FlexLayoutConfig,
): Arranged<Models>;
export function flex<const Models extends readonly Model[]>(
  models: Models,
  spaceOrConfig: Model | FlexLayoutConfig,
  explicitConfig?: FlexLayoutConfig,
): Arranged<Models> {
  const [space, config] = layoutArguments(spaceOrConfig, explicitConfig);
  const {
    axis,
    crossAxis,
    gap = 0,
    rowGap = gap,
    padding,
    crossPadding,
    justifyContent = 'start',
    wrap = false,
    alignItems = wrap ? 'start' : undefined,
    alignContent = 'start',
  } = config;
  const main = axisIndex(axis);
  const cross = crossAxis === undefined ? undefined : plane(axis, crossAxis)[1];
  if ((wrap || alignItems) && cross === undefined)
    throw new Error('Flex cross alignment and wrapping require crossAxis.');
  nonnegative('Gap', gap);
  nonnegative('Row gap', rowGap);
  inset(padding);
  inset(crossPadding);
  if (wrap && !space)
    throw new Error('Wrapped flex layout requires a target space.');
  if (!models.length) return [] as unknown as Arranged<Models>;
  const boxes = measurements(models),
    target = space?.bounds();
  const widths = boxes.map(box => box.size[main]);
  const mainInterval = interval(target, main, padding, extent(widths, gap));
  const lines: number[][] = [[]];
  let occupied = 0;
  boxes.forEach((box, index) => {
    let line = lines.at(-1)!;
    const width = box.size[main];
    if (
      wrap &&
      line.length &&
      occupied + gap + width > mainInterval.span + mainInterval.tolerance
    ) {
      lines.push((line = []));
      occupied = 0;
    }
    occupied += (line.length ? gap : 0) + width;
    line.push(index);
  });
  const heights = lines.map(line =>
    cross === undefined
      ? 0
      : maximum(line.map(index => boxes[index].size[cross])),
  );
  const crossInterval =
    wrap || alignItems
      ? interval(target, cross!, crossPadding, extent(heights, rowGap))
      : undefined;
  const lineSpacing = wrap
    ? spacing(crossInterval!, heights, rowGap, alignContent)
    : undefined;
  let crossStart = lineSpacing?.start ?? crossInterval?.minimum ?? 0;
  const deltas: [number, number, number][] = new Array(models.length);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const placed = spacing(
      mainInterval,
      line.map(index => widths[index]),
      gap,
      justifyContent,
    );
    let mainStart = placed.start;
    const crossSize = wrap ? heights[lineIndex] : (crossInterval?.span ?? 0);
    for (const index of line) {
      const box = boxes[index];
      const delta: [number, number, number] = [0, 0, 0];
      delta[main] = mainStart - box.minimum[main];
      if (alignItems) {
        const remaining = crossSize - box.size[cross!];
        if (remaining < -crossInterval!.tolerance)
          throw new Error('Flex items must fit within the cross-axis bounds.');
        delta[cross!] =
          crossStart +
          alignmentOffset(Math.max(0, remaining), alignItems) -
          box.minimum[cross!];
      }
      deltas[index] = delta;
      mainStart += widths[index] + placed.gap;
    }
    crossStart += heights[lineIndex] + (lineSpacing?.gap ?? 0);
  }
  return models.map((model, index) =>
    translated(model, deltas[index]),
  ) as unknown as Arranged<Models>;
}

/** Fill one axis with complete copies, then use the same single-line flex layout. */
export function fillFlex<T extends Model>(
  model: T,
  space: Model,
  config: FillFlexLayoutConfig,
): readonly T[] {
  const {axis, gap, padding} = config;
  nonnegative('Gap', gap);
  const component = axisIndex(axis);
  const target = interval(space.bounds(), component, padding, 0);
  const length = fitsCount(model.bounds().size[component], target, gap);
  return flex(repeat(model, length), space, {...config, wrap: false});
}

function trackDefinitions(value: GridTracks, name: string): GridTrack[] {
  let tracks: GridTrack[];
  if (value === undefined) throw new Error(`${name} are required.`);
  if (typeof value === 'number') {
    validateCount(value);
    if (value === 0)
      throw new Error(`${name} must contain at least one track.`);
    tracks = Array.from({length: value}, () => 'auto' as const);
  } else {
    if (!value.length)
      throw new Error(`${name} must contain at least one track.`);
    tracks = [...value];
  }
  for (const track of tracks) {
    if (typeof track === 'number') nonnegative('Track size', track);
    else if (track !== 'auto') {
      finite('Track fr', track.fr);
      if (track.fr <= 0) throw new Error('Track fr must be positive.');
    }
  }
  return tracks;
}
function trackSizes(
  tracks: readonly GridTrack[],
  minimums: readonly number[],
  target: Interval | undefined,
  gap: number,
): number[] {
  const sizes = tracks.map((track, index) =>
    typeof track === 'number' ? track : minimums[index],
  );
  const tolerance = target?.tolerance ?? 32 * Number.EPSILON * maximum(sizes);
  sizes.forEach((size, index) => {
    if (size < minimums[index] - tolerance)
      throw new Error('Grid tracks must fit their model bounds.');
  });
  let flexible = tracks.flatMap((track, index) =>
    typeof track === 'object' ? [{index, weight: track.fr}] : [],
  );
  if (!flexible.length) return sizes;
  if (!target) {
    const unit = maximum(
      flexible.map(({index, weight}) => minimums[index] / weight),
    );
    for (const {index, weight} of flexible) sizes[index] = unit * weight;
    return sizes;
  }
  const flexibleIndices = new Set(flexible.map(({index}) => index));
  let remaining =
    target.span -
    gap * (tracks.length - 1) -
    sum(sizes.filter((_, index) => !flexibleIndices.has(index)));
  if (remaining < sum(flexible.map(({index}) => minimums[index])) - tolerance)
    throw new Error('Grid tracks and gaps must fit within the target bounds.');
  while (flexible.length) {
    const unit =
      Math.max(0, remaining) / sum(flexible.map(({weight}) => weight));
    const frozen = flexible.filter(
      ({index, weight}) => minimums[index] > unit * weight,
    );
    if (!frozen.length) {
      for (const {index, weight} of flexible) sizes[index] = unit * weight;
      break;
    }
    const indices = new Set(frozen.map(({index}) => index));
    remaining -= sum(frozen.map(({index}) => minimums[index]));
    flexible = flexible.filter(({index}) => !indices.has(index));
  }
  return sizes;
}
function gridSettings(config: Omit<GridLayoutConfig, 'columns' | 'rows'>) {
  const {axes, gap = 0, columnGap = gap, rowGap = gap, padding = 0} = config;
  if (!axes) throw new Error('Grid axes are required.');
  const [columnAxis, rowAxis] = plane(...axes);
  nonnegative('Gap', gap);
  nonnegative('Column gap', columnGap);
  nonnegative('Row gap', rowGap);
  const columnPadding = typeof padding === 'number' ? padding : padding.columns;
  const rowPadding = typeof padding === 'number' ? padding : padding.rows;
  inset(columnPadding);
  inset(rowPadding);
  return {columnAxis, rowAxis, columnGap, rowGap, columnPadding, rowPadding};
}
function trackPositions(
  sizes: readonly number[],
  target: Interval,
  gap: number,
  alignment: ContentAlignment | undefined,
): number[] {
  const placed = spacing(target, sizes, gap, alignment);
  let cursor = placed.start;
  return sizes.map(size => {
    const start = cursor;
    cursor += size + placed.gap;
    return start;
  });
}

/** Arrange inputs row by row in content-sized grid tracks. */
export function grid<const Models extends readonly Model[]>(
  models: Models,
  config: GridLayoutConfig,
): Arranged<Models>;
/** Arrange grid tracks and their inputs within a model's local bounds. */
export function grid<const Models extends readonly Model[]>(
  models: Models,
  space: Model,
  config: GridLayoutConfig,
): Arranged<Models>;
export function grid<const Models extends readonly Model[]>(
  models: Models,
  spaceOrConfig: Model | GridLayoutConfig,
  explicitConfig?: GridLayoutConfig,
): Arranged<Models> {
  const [space, config] = layoutArguments(spaceOrConfig, explicitConfig);
  const {columnAxis, rowAxis, columnGap, rowGap, columnPadding, rowPadding} =
    gridSettings(config);
  const columns = trackDefinitions(config.columns, 'Columns');
  const rows =
    config.rows === undefined ? [] : trackDefinitions(config.rows, 'Rows');
  while (rows.length < Math.ceil(models.length / columns.length))
    rows.push('auto');
  if (!models.length) return [] as unknown as Arranged<Models>;
  const boxes = measurements(models),
    target = space?.bounds();
  const columnMinimums = columns.map(() => 0),
    rowMinimums = rows.map(() => 0);
  boxes.forEach((box, index) => {
    const column = index % columns.length,
      row = Math.floor(index / columns.length);
    columnMinimums[column] = Math.max(
      columnMinimums[column],
      box.size[columnAxis],
    );
    rowMinimums[row] = Math.max(rowMinimums[row], box.size[rowAxis]);
  });
  const columnTarget = target
    ? interval(target, columnAxis, columnPadding, 0)
    : undefined;
  const rowTarget = target
    ? interval(target, rowAxis, rowPadding, 0)
    : undefined;
  const widths = trackSizes(columns, columnMinimums, columnTarget, columnGap);
  const heights = trackSizes(rows, rowMinimums, rowTarget, rowGap);
  const columnStarts = trackPositions(
    widths,
    columnTarget ??
      interval(undefined, columnAxis, columnPadding, extent(widths, columnGap)),
    columnGap,
    config.justifyContent,
  );
  const rowStarts = trackPositions(
    heights,
    rowTarget ??
      interval(undefined, rowAxis, rowPadding, extent(heights, rowGap)),
    rowGap,
    config.alignContent,
  );
  return models.map((model, index) => {
    const column = index % columns.length,
      row = Math.floor(index / columns.length),
      box = boxes[index];
    const delta: [number, number, number] = [0, 0, 0];
    delta[columnAxis] =
      columnStarts[column] +
      alignmentOffset(
        Math.max(0, widths[column] - box.size[columnAxis]),
        config.justifyItems ?? 'start',
      ) -
      box.minimum[columnAxis];
    delta[rowAxis] =
      rowStarts[row] +
      alignmentOffset(
        Math.max(0, heights[row] - box.size[rowAxis]),
        config.alignItems ?? 'start',
      ) -
      box.minimum[rowAxis];
    return translated(model, delta);
  }) as unknown as Arranged<Models>;
}

/** Fill both grid axes with complete copies, then use the same grid layout. */
export function fillGrid<T extends Model>(
  model: T,
  space: Model,
  config: FillGridLayoutConfig,
): readonly T[] {
  if (
    config.gap === undefined &&
    (config.columnGap === undefined || config.rowGap === undefined)
  )
    throw new Error('Grid filling requires gap or both columnGap and rowGap.');
  const {columnAxis, rowAxis, columnGap, rowGap, columnPadding, rowPadding} =
    gridSettings(config);
  const target = space.bounds(),
    bounds = model.bounds();
  const columns = fitsCount(
    bounds.size[columnAxis],
    interval(target, columnAxis, columnPadding, 0),
    columnGap,
  );
  const rows = fitsCount(
    bounds.size[rowAxis],
    interval(target, rowAxis, rowPadding, 0),
    rowGap,
  );
  const length = columns * rows;
  validateCount(length);
  if (!length) return [];
  return grid(repeat(model, length), space, {...config, columns, rows});
}
