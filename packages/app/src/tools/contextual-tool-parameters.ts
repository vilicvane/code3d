import type {SourceTargetEvaluation} from '../model/compiler';
import type {ParameterUsage, SourceRef} from '@code3d/core/tooling';
import {editableParameterUsages} from '../model/parameter-provenance';
import {
  isToolSelectionParameter,
  type ToolArgumentSource,
  type ToolSignatureSchema,
  type ToolValueParameterSchema,
} from '../model/tool-schema';
import type {ContextualToolParameterView} from '../ui/contextual-tool-panel';
import type {ToolIntent} from './tool-system';
import {formatDisplayNumber} from './parameter-policy';

export type ContextualToolParameterState = {
  schema: ToolValueParameterSchema;
  binding?:
    | Readonly<{kind: 'parameter'; usage: ParameterUsage}>
    | Readonly<{kind: 'argument'; target: ToolArgumentSource['target']}>;
  value?: number;
  expressionValue?: number;
};

export function contextualToolParameters(
  signature: ToolSignatureSchema,
  arguments_: readonly ToolArgumentSource[],
  operationRef: SourceRef,
  usages: readonly ParameterUsage[],
  toolArguments: SourceTargetEvaluation['toolArguments'],
): Map<string, ContextualToolParameterState> {
  return new Map(
    signature.parameters
      .filter(
        (parameter): parameter is ToolValueParameterSchema =>
          !isToolSelectionParameter(parameter),
      )
      .map(schema => {
        const argument = arguments_.find(
          candidate => candidate.index === schema.index,
        )?.target;
        const matches = editableParameterUsages(
          usages.filter(
            usage =>
              usage.operation === signature.name &&
              usage.argument === schema.name &&
              usage.operationRef.file === operationRef.file &&
              usage.operationRef.start <= operationRef.start &&
              usage.operationRef.end === operationRef.end &&
              Math.abs(usage.sensitivity) > 1e-9,
          ),
        );
        const usage = matches.length === 1 ? matches[0] : undefined;
        return [
          schema.name,
          {
            schema,
            binding: usage
              ? {kind: 'parameter', usage}
              : argument
                ? {kind: 'argument', target: argument}
                : undefined,
            value: usage?.value,
            expressionValue:
              argument?.kind === 'present'
                ? toolArguments?.[schema.index]
                : undefined,
          },
        ];
      }),
  );
}

export function contextualParameterIntent(
  parameter: ContextualToolParameterState,
): ToolIntent | undefined {
  if (!validContextualParameter(parameter) || !parameter.binding)
    return undefined;
  const value = parameter.value!;
  const binding = parameter.binding;
  if (binding.kind === 'parameter') {
    const {usage} = binding;
    const sourceValue =
      usage.target.value + (value - usage.value) / usage.sensitivity;
    return Number.isFinite(sourceValue)
      ? {kind: 'parameter.set', target: usage.target, value: sourceValue}
      : undefined;
  }
  return {
    kind: 'argument.set',
    parameter: parameter.schema.name,
    target: binding.target,
    expression: {kind: 'number', value},
  };
}

export function contextualParameterView(
  parameter: ContextualToolParameterState,
): ContextualToolParameterView {
  return {
    name: parameter.schema.name,
    label: parameter.schema.label,
    value: parameter.value,
    placeholder:
      parameter.value === undefined && parameter.expressionValue !== undefined
        ? formatDisplayNumber(parameter.expressionValue)
        : undefined,
    step: contextualParameterStep(parameter),
    min: parameter.schema.constraints?.min,
    max: parameter.schema.constraints?.max,
    invalid:
      parameter.value !== undefined && !validContextualParameter(parameter),
    disabled: !parameter.binding,
  };
}

export function validContextualParameter(
  parameter: ContextualToolParameterState,
): boolean {
  const value = parameter.value;
  if (value === undefined || !Number.isFinite(value)) return false;
  if (parameter.schema.kind === 'count' && !Number.isInteger(value))
    return false;
  const constraints = parameter.schema.constraints;
  return !(
    (constraints?.min !== undefined && value < constraints.min) ||
    (constraints?.exclusiveMin !== undefined &&
      value <= constraints.exclusiveMin) ||
    (constraints?.max !== undefined && value > constraints.max) ||
    (constraints?.exclusiveMax !== undefined &&
      value >= constraints.exclusiveMax)
  );
}

function contextualParameterStep(
  parameter: ContextualToolParameterState,
): number {
  if (parameter.schema.kind === 'count' || parameter.schema.kind === 'angle')
    return 1;
  if (parameter.schema.kind === 'length')
    return Math.abs(parameter.value ?? parameter.expressionValue ?? 0) < 10
      ? 0.1
      : 0.5;
  return 0.1;
}
