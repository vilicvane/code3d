import type {ParameterTarget} from '../model/runtime';

export type NumericValuePolicy = Readonly<{
  value: number;
  kind?: ParameterTarget['kind'];
  min?: number;
  max?: number;
  step?: number;
}>;

export type ParameterRange = Readonly<{
  min: number;
  max: number;
  step: number;
}>;

export function parameterRange(
  target: ParameterTarget,
): ParameterRange | undefined {
  if (
    target.min === undefined ||
    target.max === undefined ||
    !Number.isFinite(target.min) ||
    !Number.isFinite(target.max) ||
    target.min >= target.max
  ) {
    return undefined;
  }

  return {
    min: target.min,
    max: target.max,
    step:
      target.step !== undefined &&
      Number.isFinite(target.step) &&
      target.step > 0
        ? target.step
        : inferredParameterStep(target),
  };
}

export function inferredParameterStep(
  target: Pick<ParameterTarget, 'kind' | 'value'>,
): number {
  if (target.kind === 'count') return 1;
  if (target.kind === 'angle') return 1;
  return Math.abs(target.value) < 10 ? 0.1 : 0.5;
}

export function snapParameterValue(
  target: ParameterTarget,
  value: number,
): number {
  return snapNumericValue(target, value);
}

export function snapNumericValue(
  policy: NumericValuePolicy,
  value: number,
): number {
  const step = policy.step ?? inferredParameterStep(policy);
  const origin = policy.min ?? 0;
  const snapped =
    Number.isFinite(step) && step > 0
      ? origin + Math.round((value - origin) / step) * step
      : value;
  return clamp(Number(snapped.toPrecision(12)), policy.min, policy.max);
}

function clamp(value: number, min?: number, max?: number): number {
  return Math.min(
    max ?? Number.POSITIVE_INFINITY,
    Math.max(min ?? Number.NEGATIVE_INFINITY, value),
  );
}
