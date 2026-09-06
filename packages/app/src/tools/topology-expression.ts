import type {TopologyId} from '@code3d/core/tooling';
import type {ExpressionDraft} from './tool-system';

export function topologyIdExpression(id: TopologyId): ExpressionDraft {
  return typeof id === 'number'
    ? {kind: 'number', value: id}
    : {kind: 'array', elements: id.map(value => ({kind: 'number', value}))};
}
