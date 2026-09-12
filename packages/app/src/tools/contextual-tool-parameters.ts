import type {ParameterUsage, SourceRef} from '@code3d/core/tooling';
import type {SourceTargetEvaluation} from '../model/compiler';
import {editableParameterUsages} from '../model/parameter-provenance';
import {
  isToolSelectionParameter,
  validToolParameterValue,
} from '../model/tool-parameter-config';
import {
  type ToolArgumentEditTarget,
  type ToolArgumentSource,
  type ToolSignatureSchema,
  type ToolValueParameterSchema,
} from '../model/tool-schema';
import type {ContextualToolParameterView} from '../ui/contextual-tool-panel';
import {formatDisplayNumber} from './parameter-policy';
import type {ToolIntent} from './tool-system';

export type ContextualToolParameterState = {
  schema: ToolValueParameterSchema;
  binding?:
    | Readonly<{kind: 'parameter'; usage: ParameterUsage}>
    | Readonly<{kind: 'argument'; target: ToolArgumentEditTarget}>
    | Readonly<{
        kind: 'rotation';
        target: {sourceRef: SourceRef};
        axisOnly: boolean;
        index: number;
      }>;
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
        const candidate = source?.target;
        // The panel fills sequentially; a gizmo may explicitly choose a later axis.
        const argument =
          candidate?.kind === 'omitted' &&
          candidate.prefixes?.some(values => values.length > 0)
            ? undefined
            : candidate;
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

/** Missing rotate fields use the same parameter state and source transaction as authored fields. */
export function draftRotationParameters(
  sourceRef: SourceRef,
  axisOnly: boolean,
): Map<string, ContextualToolParameterState> {
  return new Map(
    (axisOnly ? ['angle'] : ['x', 'y', 'z']).map((name, index) => [
      name,
      {
        schema: {
          index,
          name,
          optional: false,
          kind: 'angle',
          default: 0,
          label: axisOnly ? 'Rotate' : `Rotate ${name.toUpperCase()}`,
          actions: [],
        },
        binding: {kind: 'rotation', target: {sourceRef}, axisOnly, index},
        placeholderValue: 0,
      },
    ]),
  );
}

export function contextualParameterIntent(
  parameter: ContextualToolParameterState,
): ToolIntent | undefined {
  if (!validContextualParameter(parameter) || !parameter.binding)
    return undefined;
  const value = parameter.value!;
  const binding = parameter.binding;
  if (binding.kind === 'rotation')
    return {
      kind: 'model.spatial',
      operation: 'rotate',
      change: {
        kind: 'rotation-complete',
        sourceRef: binding.target.sourceRef,
        axisOnly: binding.axisOnly,
        index: binding.index,
        value,
      },
      preview: {kind: 'model-spatial', objects: []},
    };
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
    gridStep:
      parameter.schema.kind === 'length' &&
      /(^|\.)d?[xyz]$/.test(parameter.schema.name),
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
