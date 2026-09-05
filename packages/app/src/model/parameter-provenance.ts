import type {ParameterUsage} from '@code3d/core/tooling';

/** Prefer upstream definitions; never treat an inline coefficient as the argument. */
export function editableParameterUsages(
  parameters: readonly ParameterUsage[],
): ParameterUsage[] {
  const groups = new Map<string, ParameterUsage[]>();
  for (const parameter of parameters) {
    const {file, start, end} = parameter.expressionRef;
    const key = `${parameter.operation}:${parameter.argument}:${file}:${start}:${end}`;
    const group = groups.get(key) ?? [];
    group.push(parameter);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap(group => {
    const upstream = group.filter(
      ({expressionRef, target}) =>
        expressionRef.file !== target.sourceRef.file ||
        target.sourceRef.start < expressionRef.start ||
        expressionRef.end < target.sourceRef.end,
    );
    return upstream.length > 0
      ? upstream
      : group.filter(
          ({expressionRef, target}) =>
            expressionRef.file === target.sourceRef.file &&
            expressionRef.start === target.sourceRef.start &&
            expressionRef.end === target.sourceRef.end,
        );
  });
}
