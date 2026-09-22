import {
  ModelObject,
  requireModelObject,
  storedOperation,
  type Model,
  type GroupModel,
} from './runtime.js';
import {
  retainInspectionIdentity,
  type InspectContext,
  type InspectResult,
} from './inspect.js';
/** Compose members in the first member's local frame; empty groups use the default frame. */
/** @code3d.inspect children group.inspectChildren */
export function group(children: readonly Model[], name = 'Group'): GroupModel {
  const runtimeChildren = children.map(child =>
    requireModelObject(child, 'Every group child must be a model.'),
  );
  return ModelObject.create<{}, 'group'>({
    kind: 'group',
    name,
    children: runtimeChildren,
    operation: storedOperation(
      'group',
      runtimeChildren.map((model, index) => ({
        model,
        role: 'child',
        index,
      })),
    ),
  }) as unknown as GroupModel;
}
/** @internal */
export namespace group {
  export function inspectChildren(
    _args: [readonly Model[], string?],
    context: InspectContext<GroupModel>,
  ): InspectResult | undefined {
    return context.return && ModelObject.inspectGroup(context.return);
  }
}
/** Inspect derived group members at solved poses while preserving input focus. */
export function inspectGroupMembers(
  children: readonly Model[],
  inputs: readonly Model[],
): InspectResult {
  const result = ModelObject.inspectGroup(group(children));
  result.target?.forEach((member, index) => {
    retainInspectionIdentity(member, inputs[index]);
  });
  return result;
}
