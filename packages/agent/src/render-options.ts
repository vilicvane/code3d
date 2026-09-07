import {AgentError, object} from './validation.js';

export const renderViewNames = [
  'isometric',
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
] as const;
export type RenderViewName = (typeof renderViewNames)[number];
type Vector = readonly [number, number, number];
export type RenderView =
  RenderViewName | Readonly<{direction: Vector; up?: Vector}>;
export type RenderOutputOptions = Readonly<{view?: RenderView}>;

function unitVector(value: unknown, label: string): Vector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(v => typeof v === 'number' && Number.isFinite(v))
  )
    throw new AgentError(
      'invalid_input',
      `${label} must contain three finite numbers.`,
    );
  const scale = Math.max(...value.map(Math.abs));
  if (!scale) throw new AgentError('invalid_input', `${label} cannot be zero.`);
  const scaled = value.map(v => v / scale);
  const length = Math.hypot(...scaled);
  return scaled.map(v => v / length) as unknown as Vector;
}

export function parseRenderOptions(
  value: unknown,
): boolean | RenderOutputOptions {
  if (typeof value === 'boolean') return value;
  const data = object(value, ['view'], 'Render output');
  if (data.view === undefined) return {};
  if (typeof data.view === 'string') {
    if (!renderViewNames.includes(data.view as RenderViewName))
      throw new AgentError(
        'invalid_input',
        `Render view must be ${renderViewNames.join(', ')} or {direction, up?}.`,
      );
    return {view: data.view as RenderViewName};
  }
  const view = object(data.view, ['direction', 'up'], 'Render view');
  const direction = unitVector(view.direction, 'View direction');
  const up = view.up === undefined ? undefined : unitVector(view.up, 'View up');
  if (
    up &&
    Math.hypot(
      direction[1] * up[2] - direction[2] * up[1],
      direction[2] * up[0] - direction[0] * up[2],
      direction[0] * up[1] - direction[1] * up[0],
    ) < 1e-6
  )
    throw new AgentError(
      'invalid_input',
      'View up must not be parallel to the view direction.',
    );
  // Preserve submitted vectors so parsing a request again cannot change its
  // fingerprint through repeated floating-point normalization.
  return {
    view: {
      direction: view.direction as Vector,
      ...(up ? {up: view.up as Vector} : {}),
    },
  };
}

/** Directions point from the observed scene's center toward the camera; Y is up. */
export function resolveRenderView(view: RenderView = 'isometric'): {
  direction: Vector;
  up: Vector;
} {
  const directions: Record<RenderViewName, Vector> = {
    isometric: [1, 1, 1],
    front: [0, 0, 1],
    back: [0, 0, -1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    top: [0, 1, 0],
    bottom: [0, -1, 0],
  };
  const direction = unitVector(
    typeof view === 'string' ? directions[view] : view.direction,
    'View direction',
  );
  const up =
    typeof view === 'object' && view.up
      ? unitVector(view.up, 'View up')
      : Math.abs(direction[1]) > 0.999
        ? ([0, 0, direction[1] > 0 ? -1 : 1] as const)
        : ([0, 1, 0] as const);
  return {direction, up};
}
