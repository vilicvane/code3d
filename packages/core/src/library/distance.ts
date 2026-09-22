import {
  ModelObject,
  type Anchor,
  type DistanceAxis,
  type DistanceInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';

/**
 * Measure finite models, topology, bounds or point references in their solved placement.
 * Without axis, returns the shortest geometric distance. With axis, returns the
 * gap between projected intervals (zero when they overlap). The result is a
 * non-negative number computed now; later relations do not update it.
 * @code3d.inspect distance.inspect
 * @code3d.inspect a distance.inspect
 * @code3d.inspect b distance.inspect
 * @code3d.inspect axis distance.inspect
 */
export function distance(a: Anchor, b: Anchor, axis?: DistanceAxis): number {
  return ModelObject.distance(a, b, axis);
}

/** @internal */
export namespace distance {
  export function inspect(
    args: [Anchor, Anchor, DistanceAxis?],
    context: InspectContext<number, unknown, DistanceInspectData | undefined>,
  ): InspectResult | undefined {
    return ModelObject.inspectDistance(args, context);
  }
}
