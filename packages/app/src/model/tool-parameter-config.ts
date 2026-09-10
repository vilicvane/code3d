import type {ParameterKind, TopologyKind} from '@code3d/core/tooling';
import type {
  ToolParameterSchema,
  ToolSelectionParameterSchema,
} from './tool-schema';

export type ToolParameterKind = ParameterKind | TopologyKind;

export type ToolParameterAction = Readonly<{
  action: 'remove-argument';
  label: string;
}>;

export type ToolParameterConstraints = Readonly<{
  min?: number;
  exclusiveMin?: number;
  max?: number;
  exclusiveMax?: number;
}>;

type ToolParameterConfigBase = Readonly<{
  label?: string;
  actions?: readonly ToolParameterAction[];
}>;

/** Static metadata on a callable parameter, not runtime arguments. */
export type ToolParameterConfig = ToolParameterConfigBase &
  (
    | Readonly<{
        kind: ParameterKind;
        constraints?: ToolParameterConstraints;
        /** Displayed for an omitted argument; never applied at runtime. */
        default?: number;
      }>
    | Readonly<{kind: TopologyKind}>
  );

/** Shared by static defaults and numeric panel edits. */
export function validToolParameterValue(
  parameter: Readonly<{
    kind: ParameterKind;
    constraints?: ToolParameterConstraints;
  }>,
  value: number,
): boolean {
  if (!Number.isFinite(value)) return false;
  if (parameter.kind === 'count' && !Number.isInteger(value)) return false;
  const constraints = parameter.constraints;
  return !(
    (constraints?.min !== undefined && value < constraints.min) ||
    (constraints?.exclusiveMin !== undefined &&
      value <= constraints.exclusiveMin) ||
    (constraints?.max !== undefined && value > constraints.max) ||
    (constraints?.exclusiveMax !== undefined &&
      value >= constraints.exclusiveMax)
  );
}

export function isToolSelectionKind(kind: unknown): kind is TopologyKind {
  return kind === 'vertex' || kind === 'edge' || kind === 'surface';
}

export function isToolSelectionParameter(
  parameter: ToolParameterSchema,
): parameter is ToolSelectionParameterSchema {
  return isToolSelectionKind(parameter.kind);
}
