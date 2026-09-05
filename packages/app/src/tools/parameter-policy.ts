import type {ParameterKind} from '@code3d/core/tooling';

export type NumericValuePolicy = Readonly<{
  value: number;
  kind?: ParameterKind;
  step?: number;
}>;

export function formatDisplayNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function snapNumericValue(
  policy: NumericValuePolicy,
  value: number,
): number {
  const step = policy.step ?? inferredParameterStep(policy);
  const snapped =
    Number.isFinite(step) && step > 0 ? Math.round(value / step) * step : value;
  return Number(snapped.toPrecision(12));
}

function inferredParameterStep(
  target: Pick<NumericValuePolicy, 'kind' | 'value'>,
): number {
  if (target.kind === 'count' || target.kind === 'angle') return 1;
  return Math.abs(target.value) < 10 ? 0.1 : 0.5;
}
