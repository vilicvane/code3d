import type {Anchor, Frame, Model, SolidModel} from './runtime.js';
import type {Sketch, SketchPoint} from './sketch.js';
import type {RigidTransform, Vec3} from './spatial.js';

let recordData: ((data: unknown) => void) | undefined;
const inspectionIdentities = new WeakMap<object, object>();

/** Runtime-only identity of a value retained in a different inspection frame. */
export function inspectionIdentity(value: object): object {
  return inspectionIdentities.get(value) ?? value;
}

/** Frame changes preserve the inspected object, unlike newly generated geometry. */
export function retainInspectionIdentity<T extends object>(
  value: T,
  source: object,
): T {
  inspectionIdentities.set(value, inspectionIdentity(source));
  return value;
}

/** Avoid preparing call data when no execution host is recording it. */
export function isRecordingInspection(): boolean {
  return recordData !== undefined;
}

/**
 * Attach data to the current inspected call without changing its return value.
 * The inspector receives the last recorded value as context.data. Data stays in
 * the execution host by reference; capture immutable values for call-time facts.
 * Without a recording scope this function does nothing.
 */
export function captureInspectData(data: unknown): void {
  recordData?.(data);
}

/** The execution host supplies the current call's recording scope (tooling entry only). */
export function recordInspectionCalls(
  record: (data: unknown) => void,
): () => void {
  const previous = recordData;
  recordData = record;
  return () => {
    recordData = previous;
  };
}

/** A finite segment expressed in an annotation owner's local coordinates. */
export type DimensionSegment = Readonly<{start: Vec3; end: Vec3}>;

type DimensionLines =
  | DimensionSegment
  | Readonly<{candidates: readonly DimensionSegment[]}>
  | Readonly<{at: Vec3}>;
type DimensionOptions = Readonly<{
  owner: Model | Frame;
  value: number;
  axisLabel?: string;
}>;

/** A passive measurement. `at` labels a point without a dimension line. */
export type Dimension = Readonly<{kind: 'dimension'}> &
  DimensionOptions &
  DimensionLines;

/** Create a preview annotation without adding CAD geometry. */
export function dimension(value: DimensionOptions & DimensionLines): Dimension {
  if ('candidates' in value && !value.candidates.length)
    throw new Error(
      'A dimension annotation requires at least one candidate segment.',
    );
  return {kind: 'dimension', ...value};
}

/** Exact finite extent, centered in a frame local to its owner; not CAD geometry. */
export type BoundsAnnotation = Readonly<{
  kind: 'bounds';
  owner: Model;
  size: Vec3;
  frame: RigidTransform;
}>;

/** Draw the existing screen-sized bounds corners without creating a solid. */
export function boundsAnnotation(
  value: Omit<BoundsAnnotation, 'kind'>,
): BoundsAnnotation {
  return {kind: 'bounds', ...value};
}

/** Render the same reference with explicit direction markers. */
export type AnchorAnnotation = Readonly<{
  kind: 'anchor-annotation';
  anchor: Anchor;
  direction: 'none' | 'forward' | 'both';
}>;

export function anchorAnnotation(
  anchor: Anchor,
  options: Pick<AnchorAnnotation, 'direction'>,
): AnchorAnnotation {
  return retainInspectionIdentity(
    {kind: 'anchor-annotation', anchor, ...options},
    anchor,
  );
}

/** Values accepted by the App's ordinary object preview. */
export type PreviewValue =
  | Model
  | Anchor
  | Sketch
  | SketchPoint
  | Dimension
  | BoundsAnnotation
  | AnchorAnnotation;

/** One inspector owns the complete scene; undefined declines its scope. */
export type InspectResult = Readonly<{
  ambient?: readonly PreviewValue[];
  target?: readonly PreviewValue[];
  /** Target identities to emphasize; omitted uses the actual source selection. */
  focused?: readonly PreviewValue[];
}>;

export type InspectCall = Readonly<{
  receiver: unknown;
  arguments: readonly unknown[];
  return: unknown;
  data: unknown;
}>;

/** The actual invocation of a callback declared with @code3d.inspect.closure/context. */
export type InspectClosureExecution = Readonly<{
  arguments: readonly unknown[];
  return: unknown;
  call: InspectCall;
  parent?: InspectClosure;
}>;

export type InspectContextFactory<Data = unknown> = (
  execution: InspectClosureExecution,
) => Data;

export type InspectClosure = InspectClosureExecution &
  Readonly<{
    provider?: InspectContextFactory;
    data: unknown;
  }>;

/** Inspection belongs to an invoked call, independently of tool selection.
 * A thrown call has no return value; recorded data and evaluated arguments remain available.
 * Calls not reached because an argument throws have no inspection invocation.
 */
export type InspectContext<
  Return = unknown,
  Receiver = unknown,
  Data = unknown,
> = Readonly<{
  receiver: Receiver;
  return: Return | undefined;
  data: Data;
  closure?: InspectClosure;
  focused: Readonly<{
    value: unknown;
    parameter: string | undefined;
    path: readonly (string | number)[];
    values: readonly PreviewValue[];
    solids: readonly SolidModel<{}>[];
    /** Absolute placement prefix count when the caret is at a relate array gap. */
    insertion?: number;
  }>;
}>;

export type Inspector<
  Args extends readonly unknown[] = readonly unknown[],
  Return = unknown,
  Receiver = unknown,
  Data = unknown,
> = (
  args: Args,
  context: InspectContext<Return, Receiver, Data>,
) => InspectResult | undefined;
