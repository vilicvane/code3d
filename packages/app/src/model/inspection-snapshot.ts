import type {
  AnchorAnnotation,
  BoundsAnnotation,
  Dimension,
  PreviewValue,
  SketchPoint,
} from '@code3d/core';
import type * as CoreTooling from '@code3d/core/tooling';
import type {
  ElementSnapshot,
  ModelSnapshotObject,
  RelationObject,
} from '@code3d/core/tooling';
import type {InspectedValues} from './inspection';
import type {CompiledSketch, SketchTraceRegistry} from './sketch-trace';

type AnnotationSnapshot<Value> = Value extends unknown
  ? Omit<Value, 'owner'> & Readonly<{model: ModelSnapshotObject}>
  : never;

/** Serializable values; callbacks and native geometry remain in the executor. */
export type InspectionItem = Readonly<{focused: boolean}> &
  (
    | Readonly<{kind: 'model'; model: ModelSnapshotObject}>
    | Readonly<{
        kind: 'anchor';
        model: ModelSnapshotObject;
        elements: readonly ElementSnapshot[];
        direction?: AnchorAnnotation['direction'];
      }>
    | Readonly<{
        kind: 'sketch';
        sketchId: string;
        sourceSketchId: string;
        model: ModelSnapshotObject;
        pointId?: number;
      }>
    | AnnotationSnapshot<Dimension>
    | AnnotationSnapshot<BoundsAnnotation>
  );

export type InspectionSnapshot = Readonly<{
  /** Ordinary values retain authored materials; inspectors apply scene emphasis. */
  kind: 'preview' | 'inspect';
  /** Only ordinary containers use the members' shared composition frame. */
  collection?: boolean;
  target: readonly InspectionItem[];
  ambient: readonly InspectionItem[];
  objects: ReadonlyMap<string, ModelSnapshotObject>;
  sketches: ReadonlyMap<string, CompiledSketch>;
}>;

export function isPreviewAnnotation(
  value: unknown,
): value is Dimension | BoundsAnnotation | AnchorAnnotation {
  if (!value || typeof value !== 'object') return false;
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  return (
    kind === 'dimension' || kind === 'bounds' || kind === 'anchor-annotation'
  );
}

export async function snapshotInspection(
  values: InspectedValues,
  runtime: typeof CoreTooling,
  sketches: SketchTraceRegistry,
  prepare: (objects: readonly RelationObject[]) => Promise<void>,
  checkCancelled: () => void,
  retainGeometry?: (objects: readonly RelationObject[]) => void,
): Promise<InspectionSnapshot> {
  const objects = new Set<RelationObject>();
  const add = (object: RelationObject): void => {
    if (objects.has(object)) return;
    objects.add(object);
    runtime.relatedModelObjects(object).forEach(add);
  };
  const target = values.target ?? [];
  const targets = new Set(target);
  const ambient = (values.ambient ?? []).filter(value => !targets.has(value));
  const focused = new Set(values.focused.map(runtime.inspectionIdentity));
  type PendingItem = (
    snapshot: (object: RelationObject) => ModelSnapshotObject,
  ) => InspectionItem;
  const item = (value: PreviewValue, foreground: boolean): PendingItem => {
    const emphasis = {
      focused: foreground && focused.has(runtime.inspectionIdentity(value)),
    };
    if (runtime.isModelObject(value)) {
      add(value);
      return snapshot => ({kind: 'model', model: snapshot(value), ...emphasis});
    }
    const annotation = isPreviewAnnotation(value) ? value : undefined;
    if (annotation) validateAnnotation(annotation);
    if (annotation && annotation.kind !== 'anchor-annotation') {
      const {owner, ...value} = annotation;
      if (!runtime.isModelObject(owner))
        throw new Error('A preview annotation requires a model owner.');
      const model = owner;
      add(model);
      return snapshot => ({...value, model: snapshot(model), ...emphasis});
    }
    const anchor =
      annotation?.kind === 'anchor-annotation' ? annotation : undefined;
    const reference = runtime.previewAnchorReference(
      anchor?.anchor ?? value,
      anchor?.direction,
    );
    if (reference) {
      add(reference.model);
      reference.geometries.forEach(add);
      return snapshot => ({
        kind: 'anchor',
        model: snapshot(reference.model),
        elements: reference.elements,
        direction: anchor?.direction,
        ...emphasis,
      });
    }
    const sketch = runtime.isSketch(value)
      ? value
      : (value as SketchPoint).sketch;
    if (runtime.isSketch(sketch)) {
      const sketchId = sketches.identity(sketch);
      const original = runtime.inspectionIdentity(sketch);
      const sourceSketchId = runtime.isSketch(original)
        ? sketches.identity(original)
        : sketchId;
      const frame = runtime.sketchFrame(sketch);
      add(frame);
      return snapshot => ({
        kind: 'sketch',
        sketchId,
        sourceSketchId,
        model: snapshot(frame),
        pointId: sketch === value ? undefined : (value as SketchPoint).id,
        ...emphasis,
      });
    }
    throw new Error('An inspector returned a value that cannot be previewed.');
  };
  const targetItems = target.map(value => item(value, true));
  const ambientItems = ambient.map(value => item(value, false));
  checkCancelled();
  await prepare([...objects]);
  checkCancelled();
  const snapshot = runtime.createModelSnapshotter();
  const snapshots = new Map(
    [...objects].map(object => {
      checkCancelled();
      return [object, snapshot(object)] as const;
    }),
  );
  const get = (object: RelationObject) => snapshots.get(object)!;
  const result = {
    kind: values.kind,
    collection: values.collection,
    target: targetItems.map(item => item(get)),
    ambient: ambientItems.map(item => item(get)),
    objects: new Map(
      [...snapshots.values()].map(object => [object.nodeId, object]),
    ),
    sketches: sketches.snapshots(),
  };
  checkCancelled();
  retainGeometry?.([...objects]);
  return result;
}

/** Author-returned annotations must fail before a complete scene can be published. */
function validateAnnotation(
  value: Dimension | BoundsAnnotation | AnchorAnnotation,
): void {
  const vector = (value: readonly number[], size: number) =>
    Array.isArray(value) &&
    value.length === size &&
    value.every(Number.isFinite);
  if (value.kind === 'dimension') {
    if ('at' in value) {
      if (!Number.isFinite(value.value) || !vector(value.at, 3))
        throw new Error('A dimension requires a finite value and position.');
      return;
    }
    const segments = 'candidates' in value ? value.candidates : [value];
    if (
      !Number.isFinite(value.value) ||
      !Array.isArray(segments) ||
      !segments.length ||
      segments.some(
        segment => !vector(segment.start, 3) || !vector(segment.end, 3),
      )
    )
      throw new Error(
        'A dimension requires a finite value and at least one finite segment.',
      );
  } else if (value.kind === 'bounds') {
    if (
      !vector(value.size, 3) ||
      value.size.some(size => size < 0) ||
      !vector(value.frame?.position, 3) ||
      !vector(value.frame?.quaternion, 4) ||
      !Math.hypot(...value.frame.quaternion)
    )
      throw new Error(
        'A bounds annotation requires finite nonnegative extents and a valid local frame.',
      );
  } else if (!['none', 'forward', 'both'].includes(value.direction)) {
    throw new Error(
      'An anchor annotation direction must be none, forward or both.',
    );
  }
}
