export type ModelInputValues = Readonly<Record<string, number>>;
export type InputOptions = Readonly<{
  min?: number;
  max?: number;
  /** Increment used by numeric controls and sliders. */
  step?: number;
}>;
export type ModelInputDefinition = InputOptions &
  Readonly<{
    name: string;
    defaultValue: number;
  }>;

type InputContext = Readonly<{
  values: ModelInputValues;
  definitions: Map<string, ModelInputDefinition>;
  onRead?: (name: string) => void;
}>;

let context: InputContext | undefined;

/** Read a named numeric parameter, fixed for this evaluation. */
export function input(
  name: string,
  defaultValue: number,
  options: InputOptions = {},
): number {
  if (!name.trim()) throw new Error('An input needs a non-empty name.');
  if (!Number.isFinite(defaultValue))
    throw new Error(`Input "${name}" needs a finite numeric default.`);
  const {min, max, step} = options;
  for (const [key, value] of Object.entries(options))
    if (value !== undefined && !Number.isFinite(value))
      throw new Error(`Input "${name}" needs a finite ${key}.`);
  if (min !== undefined && max !== undefined && min >= max)
    throw new Error(`Input "${name}" needs min less than max.`);
  if (step !== undefined && step <= 0)
    throw new Error(`Input "${name}" needs a positive step.`);
  const inRange = (value: number) =>
    (min === undefined || value >= min) && (max === undefined || value <= max);
  if (!inRange(defaultValue))
    throw new Error(`Input "${name}" default is outside its range.`);
  const previous = context?.definitions.get(name);
  if (
    previous &&
    (previous.defaultValue !== defaultValue ||
      previous.min !== min ||
      previous.max !== max ||
      previous.step !== step)
  )
    throw new Error(`Input "${name}" has conflicting declarations.`);
  context?.definitions.set(name, {...options, name, defaultValue});
  context?.onRead?.(name);
  const value =
    context && Object.hasOwn(context.values, name)
      ? context.values[name]
      : defaultValue;
  if (!Number.isFinite(value))
    throw new Error(`Input "${name}" must be a finite number.`);
  if (!inRange(value)) throw new Error(`Input "${name}" is outside its range.`);
  return value;
}

/** The host serializes evaluations and restores the input scope in finally. */
export function beginModelInputs(
  values: ModelInputValues,
  onRead?: (name: string) => void,
): {
  definitions: ReadonlyMap<string, ModelInputDefinition>;
  finish(): void;
} {
  const previous = context;
  const current: InputContext = {values, definitions: new Map(), onRead};
  context = current;
  return {
    definitions: current.definitions,
    finish: () => {
      context = previous;
    },
  };
}
