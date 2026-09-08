import {AgentError, type TopologyOutputOptions} from '@code3d/agent';
import {
  sketchCurveBounds,
  sketchCurveGeometry,
  sketchPointResolver,
  sketchRegions,
  type SketchPosition,
  type SketchPointAddress,
  type SketchSnapshot,
} from '@code3d/core/tooling';
import type {CompiledSketch} from '../model/sketch-trace';

export type ObservedSketch = {
  kind: 'sketch';
  key: string;
  role: 'result' | 'upstream';
  layer: CompiledSketch;
  layers: readonly CompiledSketch[];
};

/** Match the editor: the selected layer and its ancestors, never sibling layers. */
export function observeSketch(
  id: string,
  sketches: ReadonlyMap<string, CompiledSketch>,
): ObservedSketch[] {
  const layers: CompiledSketch[] = [];
  let layer: CompiledSketch | undefined = sketches.get(id)!;
  while (layer) {
    layers.unshift(layer);
    layer = layer.base ? sketches.get(layer.base)! : undefined;
  }
  return [...layers].reverse().map((layer, index) => ({
    kind: 'sketch',
    key: `s${index}`,
    role: index === 0 ? 'result' : 'upstream',
    layer,
    layers: layers.slice(0, layers.length - index),
  }));
}

const coordinates = {
  space: 'sketch-local',
  axes: ['x', 'y'],
  toModel: '[x, 0, -y]',
  units: 'model',
  curveAngles: 'radians',
  constraintAngles: 'degrees',
} as const;

export function describeSketch(model: ObservedSketch) {
  const {layer, layers} = model;
  const resolve = positionsIn(layers);
  const positions = layer.entities.flatMap(entity =>
    entity.kind === 'point'
      ? [resolve({layer: layer.id, id: entity.id})]
      : sketchCurveBounds(sketchCurveGeometry(entity, resolve)),
  );
  return {
    key: model.key,
    kind: model.kind,
    role: model.role,
    layerId: layer.id,
    base: layer.base ?? null,
    sourceRef: layer.definitionRef,
    references: layer.references,
    coordinates,
    counts: {
      point: layer.entities.filter(e => e.kind === 'point').length,
      line: layer.entities.filter(e => e.kind === 'line').length,
      circle: layer.entities.filter(e => e.kind === 'circle').length,
      arc: layer.entities.filter(e => e.kind === 'arc').length,
      constraint: layer.constraints.length,
    },
    bounds: bounds(positions),
    degreesOfFreedom: layer.degreesOfFreedom,
    redundantConstraints: layer.redundant,
  };
}

export function inspectSketch(
  model: ObservedSketch,
  options: TopologyOutputOptions,
) {
  if (options.kind || options.ids)
    throw new AgentError(
      'sketch_filter_unsupported',
      'Sketch topology uses layer-local entity IDs, not B-rep vertex/edge/surface filters. Page with model, offset and limit, or select a face/solid for B-rep inspection.',
    );
  const {layer, layers} = model;
  const resolve = positionsIn(layers);
  const authored = new Map(layer.data.map(data => [data.id, data.parameters]));
  const entities = layer.entities.map(entity => {
    const source = {
      address: {layer: layer.id, id: entity.id},
      ...(authored.has(entity.id)
        ? {authoredParameters: authored.get(entity.id)}
        : {}),
    };
    return entity.kind === 'point'
      ? {...entity, ...source, position: resolve(source.address)}
      : {...entity, ...source, geometry: sketchCurveGeometry(entity, resolve)};
  });
  const constraints = layer.constraints.map((value, index) => ({
    kind: 'constraint' as const,
    index,
    value,
    redundant: layer.redundant.includes(index),
  }));
  // Open contours are valid sketches. Region construction has stricter requirements.
  let regions;
  try {
    regions = {
      available: true as const,
      items: sketchRegions(layers).map((region, index) => ({
        kind: 'region' as const,
        index,
        outerCurves: region.outer.length,
        holes: region.holes.map(hole => ({curves: hole.length})),
        bounds: bounds(region.outer.flatMap(sketchCurveBounds)),
      })),
    };
  } catch (error) {
    regions = {
      available: false as const,
      reason: error instanceof Error ? error.message : String(error),
      items: [],
    };
  }
  const items = [...entities, ...constraints, ...regions.items];
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 48;
  const description = describeSketch(model);
  return {
    kind: 'sketch' as const,
    layerId: layer.id,
    coordinates,
    counts: {
      ...description.counts,
      region: regions.available ? regions.items.length : null,
    },
    bounds: description.bounds,
    degreesOfFreedom: layer.degreesOfFreedom,
    redundantConstraints: layer.redundant,
    regions: regions.available
      ? {available: true, scope: 'layer-and-upstream'}
      : {available: false, reason: regions.reason},
    total: items.length,
    offset,
    items: items.slice(offset, offset + limit),
    ...(offset + limit < items.length ? {nextOffset: offset + limit} : {}),
  };
}

function bounds(positions: readonly SketchPosition[]) {
  if (!positions.length) return null;
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  for (const position of positions)
    for (const axis of [0, 1] as const) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  return {min, max, size: [max[0] - min[0], max[1] - min[1]]};
}

function positionsIn(layers: readonly SketchSnapshot[]) {
  const resolve = sketchPointResolver(layers);
  const points = new Map(
    layers.map(layer => [
      layer.id,
      new Map(
        layer.entities.flatMap(entity =>
          entity.kind === 'point'
            ? [[entity.id, entity.position] as const]
            : [],
        ),
      ),
    ]),
  );
  return (address: SketchPointAddress) => {
    const canonical = resolve(address);
    return points.get(canonical.layer)!.get(canonical.id)!;
  };
}
