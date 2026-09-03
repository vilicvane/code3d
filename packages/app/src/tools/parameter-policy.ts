import type {ParameterTarget} from '@code3d/core/tooling';

export type NumericValuePolicy = Readonly<{
  value: number;
  kind?: ParameterTarget['kind'];
  min?: number;
  max?: number;
  step?: number;
}>;

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

function inferredParameterStep(
  target: Pick<ParameterTarget, 'kind' | 'value'>,
): number {
  if (target.kind === 'count' || target.kind === 'angle') return 1;
  return Math.abs(target.value) < 10 ? 0.1 : 0.5;
}

function clamp(value: number, min?: number, max?: number): number {
  return Math.min(
    max ?? Number.POSITIVE_INFINITY,
    Math.max(min ?? Number.NEGATIVE_INFINITY, value),
  );
}
