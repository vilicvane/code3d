type TimeOffsetContext = Readonly<{
  value: number;
  read?: (value: number) => void;
}>;

let context: TimeOffsetContext | undefined;

/** Seconds from the playback origin, fixed for this evaluation; standalone default is zero. */
export function timeOffset(defaultValue = 0): number {
  const value = context?.value ?? defaultValue;
  if (!Number.isFinite(value))
    throw new Error('The time offset must be a finite number of seconds.');
  context?.read?.(value);
  return value;
}

/** The host serializes evaluations and restores the context in finally. */
export function beginTimeOffset(
  value: number,
  read?: TimeOffsetContext['read'],
): () => void {
  const previous = context;
  context = {value, read};
  return () => {
    context = previous;
  };
}
