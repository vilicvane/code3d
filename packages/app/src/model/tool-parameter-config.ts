import type {ParameterKind, TopologyKind} from '@code3d/core/tooling';

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
    | Readonly<{kind: ParameterKind; constraints?: ToolParameterConstraints}>
    | Readonly<{kind: TopologyKind}>
  );
