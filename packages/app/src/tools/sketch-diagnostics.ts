import {
  sketchCurveGeometry,
  sketchCurveTolerance,
  sketchEntityParameters,
  sketchPointResolver,
  type SketchPointAddress,
  type SketchPosition,
} from '@code3d/core/tooling';
import type {CompiledSketch} from '../model/sketch-trace';
import type {ModelDiagnostic} from '../model/diagnostic';
import {analyzeSketchSource, sketchNodeSourceRef} from './sketch-source';

/** Report successful solves whose displayed geometry is not yet authored data. */
export function sketchSourceDiagnostics(
  sketches: ReadonlyMap<string, CompiledSketch>,
  files: ReadonlyMap<string, string>,
): ModelDiagnostic[] {
  const groups = new Map<string, CompiledSketch[]>();
  for (const sketch of sketches.values()) {
    const ref = sketch.definitionRef ?? sketch.callRef;
    if (!ref) continue;
    const key = `${ref.file}:${ref.start}:${ref.end}`;
    const group = groups.get(key) ?? [];
    group.push(sketch);
    groups.set(key, group);
  }
  const diagnostics: ModelDiagnostic[] = [];
  for (const group of groups.values()) {
    const owner = group[0];
    const sourceRef = (owner.definitionRef ?? owner.callRef)!;
    const source = files
      .get(sourceRef.file)!
      .slice(sourceRef.start, sourceRef.end);
    const parsed = analyzeSketchSource(source);
    const differences = group.flatMap(sketch => {
      const layers = [sketch];
      for (let base = sketch.base; base; base = sketches.get(base)!.base)
        layers.unshift(sketches.get(base)!);
      const resolve = sketchPointResolver(layers);
      const key = (p: SketchPointAddress) => {
        const point = resolve(p);
        return `${point.layer}:${point.id}`;
      };
      const point = (p: SketchPointAddress): SketchPosition => {
        const e = sketches.get(p.layer)!.entities.find(e => e.id === p.id)!;
        if (e.kind !== 'point') throw new Error('Expected a sketch point.');
        return e.position;
      };
      const tolerances = new Map<string, number>();
      const retain = (id: string, tolerance: number) =>
        tolerances.set(id, Math.min(tolerances.get(id) ?? Infinity, tolerance));
      for (const layer of layers)
        for (const entity of layer.entities) {
          if (entity.kind === 'point') continue;
          const curve = sketchCurveGeometry(entity, point);
          const tolerance = sketchCurveTolerance(curve);
          if (entity.kind !== 'line')
            retain(`${layer.id}:${entity.id}`, tolerance);
          const points =
            entity.kind === 'line'
              ? entity.points
              : entity.kind === 'arc'
                ? [entity.center, ...entity.points]
                : [entity.center];
          for (const p of points) retain(key(p), tolerance);
        }
      const changed = sketch.data.flatMap(data => {
        const entity = sketch.entities.find(e => e.id === data.id)!;
        const values = sketchEntityParameters(entity);
        const tolerance =
          tolerances.get(`${sketch.id}:${data.id}`) ??
          sketchCurveTolerance({
            kind: 'line',
            points: [
              [0, 0],
              [Math.max(...data.parameters.map(Math.abs)) || 1, 0],
            ],
          });
        const axes = values.flatMap((value, axis) =>
          Math.abs(value - data.parameters[axis]) > tolerance ? [axis] : [],
        );
        return axes.length
          ? [{id: data.id, values, axes, authored: data.parameters}]
          : [];
      });
      return changed.length ? [{sketch, changed}] : [];
    });
    if (!differences.length) continue;
    const changes = differences[0].changed;
    const shared = new Set(group.map(sketch => sketch.geometryId)).size > 1;
    const expressionDriven =
      !parsed.reason &&
      differences.some(d =>
        d.changed.some(change =>
          change.axes.some(axis => !parsed.editable.get(change.id)?.[axis]),
        ),
      );
    const canFix = !shared && !expressionDriven && !parsed.reason;
    diagnostics.push({
      kind: 'evaluation',
      severity: 'warning',
      summary: 'Sketch source data differs from the constraint solution.',
      details: `The solved geometry is displayed, but the source geometry has not been synchronized.${
        shared
          ? ' This source is evaluated more than once; update its data in code to avoid changing another instance.'
          : parsed.reason
            ? ' ' + parsed.reason
            : expressionDriven
              ? ' Some changed coordinates or radii are expressions; update them in code.'
              : ''
      }`,
      sourceRef: parsed.constraints
        ? sketchNodeSourceRef(sourceRef, parsed.constraints)
        : sourceRef,
      relatedSketchIds: differences.map(d => d.sketch.id),
      actions: canFix
        ? [
            {
              label: 'Fix',
              intent: {
                kind: 'sketch.edit',
                sourceRef,
                expectedText: source,
                layer: owner.id,
                references: owner.references,
                change: {
                  kind: 'move',
                  data: changes.map(change => ({
                    id: change.id,
                    parameters: change.values.map((value, axis) =>
                      parsed.editable.get(change.id)?.[axis]
                        ? value
                        : change.authored[axis],
                    ),
                  })),
                },
              },
            },
          ]
        : undefined,
    });
  }
  return diagnostics;
}
