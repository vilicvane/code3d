import {
  sketchCurveGeometry,
  sketchPointResolver,
  sketchEntityParameters,
  type SketchConstraint,
  type SketchPointAddress,
  type SketchSnapshot,
} from '@code3d/core/tooling';
import type {DrawingDimension} from './drawing-dimensions';
import type {
  SketchEditableParameters,
  SketchGeometryData,
} from '../model/sketch-drag';
import type {SketchChange} from './sketch-source';
import type {SketchSegment} from './sketch-segments';
import type {SketchPick} from './sketch-selection';
import {sameSketchPoint} from './sketch-snap';
import {
  sketchConstraintDimensions,
  sketchConstraintNames,
  sketchConstraintTargets,
  sketchConstraintTool,
  type SketchConstraintTool,
} from './sketch-constraints';

type Constraint = SketchConstraint<SketchPointAddress>;
export type SketchConstraintAction = Readonly<{
  kind: SketchConstraintTool;
  name: string;
  title: string;
  disabled: boolean;
  active: boolean | 'mixed';
  dimension?: DrawingDimension;
  value?: number;
  related: readonly SketchPointAddress[];
  create(value?: number): Extract<SketchChange, {kind: 'constrain'}>;
}>;

/** Applicability follows authored entities; a picked trim interval is not a new line ID. */
export function sketchConstraintActions(
  layers: readonly SketchSnapshot[],
  selection: readonly SketchPick[],
  editable: SketchEditableParameters,
  referenceable: ReadonlySet<string>,
  data: readonly SketchGeometryData[],
): SketchConstraintAction[] {
  if (!selection.length) return [];
  const local = layers.at(-1)!;
  const resolve = sketchPointResolver(layers);
  const entity = (p: SketchPointAddress) =>
    layers.find(l => l.id === p.layer)!.entities.find(e => e.id === p.id)!;
  const position = (p: SketchPointAddress) => {
    const e = entity(p);
    if (e.kind !== 'point') throw new Error('Expected a selected point.');
    return e.position;
  };
  const points = selection
    .filter(p => !('start' in p))
    .map(resolve)
    .filter((p, i, all) => all.findIndex(q => sameSketchPoint(p, q)) === i);
  const curves = selection
    .filter((p): p is SketchSegment => 'start' in p)
    .filter((p, i, all) => all.findIndex(q => sameSketchPoint(p, q)) === i);
  const actions: SketchConstraintAction[] = [];
  const selected = [...points, ...curves];
  const canonical = (p: SketchPointAddress) =>
    entity(p).kind === 'point' ? resolve(p) : p;
  const targets = (c: Constraint) =>
    sketchConstraintTargets(local.id, c).map(canonical);
  const removals = local.constraints.flatMap((c, index) =>
    targets(c).some(p => selected.some(q => sameSketchPoint(p, q)))
      ? [{c, index}]
      : [],
  );
  const identity = ([kind, data]: Constraint): string => {
    const key = (p: SketchPointAddress) => JSON.stringify(resolve(p));
    if (kind === 'fixed') return `${kind}:${key(data)}`;
    if (kind === 'coincident')
      return `${kind}:${data.map(key).sort().join(':')}`;
    if (kind === 'midpoint')
      return `${kind}:${key(data[0])}:${data.slice(1).map(key).sort().join(':')}`;
    if (kind === 'x' || kind === 'y') return `${kind}:${key(data)}`;
    if (kind === 'parallel' || kind === 'perpendicular')
      return `${kind}:${[...data].sort((a, b) => a - b).join(':')}`;
    return `${kind}:${data}`;
  };
  const existing = new Set(local.constraints.map(identity));
  const add = (
    kind: SketchConstraintTool,
    constraints: (value: number) => Constraint[],
    value = 0,
  ) => {
    const name = sketchConstraintNames[kind];
    const dimension = constraints(value).length
      ? sketchConstraintDimensions[kind]
      : undefined;
    const pending = (value: number) =>
      constraints(value).filter(c => !existing.has(identity(c)));
    const additions = pending(value);
    const removed = removals.filter(({c}) => sketchConstraintTool(c) === kind);
    const affected = removed.length
      ? removed.map(({c}) => c)
      : constraints(value);
    const affectedTargets = affected.flatMap(targets);
    const active = removed.length
      ? selected.every(p => affectedTargets.some(q => sameSketchPoint(p, q)))
        ? true
        : 'mixed'
      : false;
    const mismatch =
      !active &&
      kind === 'fixed' &&
      additions.some(
        ([kind, ref]) =>
          kind === 'fixed' &&
          data
            .find(p => p.id === ref.id)!
            .parameters.some(
              (value, axis) =>
                !editable.get(ref.id)?.[axis] && value !== position(ref)[axis],
            ),
      );
    const disabled = mismatch;
    actions.push({
      kind,
      name,
      dimension,
      value,
      disabled,
      active,
      related: affectedTargets.flatMap(p => {
        const e = entity(p);
        return [
          p,
          ...(e.kind === 'line'
            ? e.points
            : e.kind === 'arc'
              ? [e.center, ...e.points]
              : e.kind === 'circle'
                ? [e.center]
                : []),
        ];
      }),
      title: `${active ? 'Remove' : 'Add'} ${name}${kind === 'x' || kind === 'y' ? ' · Fix the coordinate value, not the movement direction' : kind === 'midpoint' && points.length === 3 ? ' · First selected point is the center of the other two' : ''}${curves.length ? ' · Applies to whole source entities' : ''}${mismatch ? ' · The displayed expression coordinate differs from its source value; use X/Y coordinate constraints' : active === 'mixed' ? ' · Remove existing constraints touching the selection' : ''}`,
      create: (entered = value) => {
        if (active) {
          return {
            kind: 'constrain',
            constraints: [],
            removedConstraints: removed.map(({index}) => index),
            // Removing a relation releases the displayed geometry; it must not
            // restore an old unsolved seed. Expressions remain source-owned.
            data: data
              .filter(p => editable.get(p.id)?.some(Boolean))
              .map(p => ({
                id: p.id,
                parameters: p.parameters.map((value, axis) =>
                  editable.get(p.id)?.[axis]
                    ? sketchEntityParameters(
                        entity({layer: local.id, id: p.id}),
                      )[axis]
                    : value,
                ),
              })),
          };
        }
        const additions = pending(entered);
        // Fixed captures the displayed position, not an unsolved source seed.
        // Write only literal axes; expressions and point aliases remain authored.
        const fixedData = additions.flatMap(([kind, ref]) =>
          kind === 'fixed' &&
          ref.layer === local.id &&
          editable.get(ref.id)?.some(Boolean)
            ? [{id: ref.id, parameters: position(ref)}]
            : [],
        );
        return {kind: 'constrain', constraints: additions, data: fixedData};
      },
    });
  };
  const finish = () => {
    for (const {c} of removals)
      if (!actions.some(a => a.kind === sketchConstraintTool(c)))
        add(sketchConstraintTool(c), () => [], c[2] ?? 0);
    return actions;
  };
  if (
    points.some(p => p.layer !== local.id && !referenceable.has(p.layer)) ||
    curves.some(p => p.layer !== local.id)
  )
    return finish();
  if (points.length && !curves.length) {
    const owned = points.filter(p => p.layer === local.id);
    if (owned.length === points.length) {
      add('fixed', () => owned.map(p => ['fixed', p]));
      for (const [axis, index] of [
        ['x', 0],
        ['y', 1],
      ] as const)
        add(
          axis,
          value => owned.map(p => [axis, p, value]),
          position(owned[0])[index],
        );
    }
    if (points.length === 2 && owned.length)
      add('coincident', () => [['coincident', [points[0], points[1]]]]);
    if (points.length === 3 && owned.length)
      add('midpoint', () => [['midpoint', [points[0], points[1], points[2]]]]);
  }
  const lines = curves.filter(p => entity(p).kind === 'line');
  if (points.length === 1 && lines.length === 1 && curves.length === 1) {
    const line = entity(lines[0]);
    if (
      line.kind === 'line' &&
      !line.points.some(p => sameSketchPoint(resolve(p), points[0]))
    )
      add('midpoint', () => [['midpoint', [points[0], ...line.points]]]);
  }
  if (points.length || !curves.length) return finish();
  if (lines.length === curves.length) {
    for (const kind of ['horizontal', 'vertical'] as const)
      add(kind, () => lines.map(p => [kind, p.id]));
    const line = entity(lines[0]);
    if (line.kind === 'line') {
      const [a, b] = line.points.map(position);
      add(
        'length',
        value => lines.map(p => ['length', p.id, value]),
        Math.hypot(b[0] - a[0], b[1] - a[1]),
      );
      add(
        'orientation',
        value => lines.map(p => ['angle', p.id, value]),
        (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
      );
    }
    const sorted = [...lines].sort((a, b) => a.id - b.id);
    if (sorted.length >= 2) {
      add('parallel', () =>
        sorted.slice(1).map(line => ['parallel', [sorted[0].id, line.id]]),
      );
    }
    if (sorted.length === 2) {
      const targets = [sorted[0].id, sorted[1].id] as const;
      add('perpendicular', () => [['perpendicular', targets]]);
      const directions = sorted.map(line => {
        const e = entity(line);
        if (e.kind !== 'line') throw new Error('Expected selected lines.');
        const [a, b] = e.points.map(position);
        return Math.atan2(b[1] - a[1], b[0] - a[0]);
      });
      const delta = directions[1] - directions[0];
      add(
        'angle',
        value => [['angle', targets, value]],
        (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI,
      );
    }
  } else if (!lines.length) {
    const first = entity(curves[0]);
    if (first.kind === 'circle' || first.kind === 'arc')
      add(
        'radius',
        value => curves.map(p => ['radius', p.id, value]),
        first.radius,
      );
    if (curves.every(p => entity(p).kind === 'arc')) {
      const geometry = sketchCurveGeometry(first, position)!;
      if (geometry.kind === 'arc')
        add(
          'sweep',
          value => curves.map(p => ['sweep', p.id, value]),
          (Math.abs(geometry.sweep) * 180) / Math.PI,
        );
    }
  }
  return finish();
}
