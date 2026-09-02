import type { ParameterTarget, ParameterUsage } from "../model/runtime";

export type NumericValuePolicy = Readonly<{
  value: number;
  kind?: ParameterTarget["kind"];
  min?: number;
  max?: number;
  step?: number;
}>;

export type ParameterBounds = Readonly<{
  min: number;
  max: number;
  step: number;
}>;

export function parameterBounds(parameter: ParameterUsage): ParameterBounds {
  const { target } = parameter;
  const span = Math.max(Math.abs(target.value), 10);
  const positive = [
    "box",
    "cylinder",
    "sphere",
    "fillet",
    "chamfer",
    "scaled",
  ].includes(parameter.operation);
  return {
    min:
      target.min ??
      (positive ? Math.max(span / 100, 0.01) : target.value - span),
    max: target.max ?? target.value + span,
    step: target.step ?? inferredParameterStep(target),
  };
}

export function inferredParameterStep(
  target: Pick<ParameterTarget, "kind" | "value">,
): number {
  if (target.kind === "count") return 1;
  if (target.kind === "angle") return 1;
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
