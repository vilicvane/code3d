import type {SourceTargetEvaluation} from '../model/compiler';
import type {ParameterUsage, SourceRef} from '@code3d/core/tooling';
import {editableParameterUsages} from '../model/parameter-provenance';
import {validToolParameterValue} from '../model/tool-parameter-config';
import {
  isToolSelectionParameter,
  type ToolArgumentEditTarget,
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
    | Readonly<{kind: 'argument'; target: ToolArgumentEditTarget}>;
  value?: number;
  placeholderValue?: number;
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
        const source = arguments_.find(
          candidate => candidate.index === schema.index,
        );
        const argument = source?.target;
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
        const usage = argument && matches.length === 1 ? matches[0] : undefined;
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
            placeholderValue:
              argument?.kind === 'present'
                ? toolArguments?.[schema.index]
                : source?.presence === 'omitted'
                  ? schema.default
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
      parameter.value === undefined && parameter.placeholderValue !== undefined
        ? formatDisplayNumber(parameter.placeholderValue)
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
  return (
    value !== undefined && validToolParameterValue(parameter.schema, value)
  );
}

function contextualParameterStep(
  parameter: ContextualToolParameterState,
): number {
  if (parameter.schema.kind === 'count' || parameter.schema.kind === 'angle')
    return 1;
  if (parameter.schema.kind === 'length')
    return Math.abs(parameter.value ?? parameter.placeholderValue ?? 0) < 10
      ? 0.1
      : 0.5;
  return 0.1;
}
