import {
  ModelObject,
  anchorReference,
  requireModelObject,
  storedOperation,
  type Model,
  type GroupOptions,
  type GroupModel,
} from './runtime.js';
import {
  retainInspectionIdentity,
  type InspectContext,
  type InspectResult,
} from './inspect.js';
/** Compose members in an explicit frame, or the first member's frame by default. */
/**
 * @code3d.inspect children group.inspectChildren
 * @code3d.inspect options group.inspectOptions
 */
export function group(
  children: readonly Model[],
  options: GroupOptions = {},
): GroupModel {
  const runtimeChildren = children.map(child =>
    requireModelObject(child, 'Every group child must be a model.'),
  );
  return ModelObject.create<{}, 'group'>({
    kind: 'group',
    name: options.name ?? 'Group',
    children: runtimeChildren,
    assemblyFrame: options.frame,
    operation: storedOperation('group', [
      ...runtimeChildren.map((model, index) => ({
        model,
        role: 'child' as const,
        index,
      })),
      ...(options.frame
        ? [
            {
              model: anchorReference(options.frame).model,
              role: 'reference' as const,
              index: 0,
            },
          ]
        : []),
    ]),
  }) as unknown as GroupModel;
}

/** @internal */
export namespace group {
  export function inspectOptions(
    [, options]: [readonly Model[], GroupOptions?],
    context: InspectContext<GroupModel>,
  ): InspectResult | undefined {
    return context.return &&
      options?.frame &&
      context.focused.values.includes(options.frame)
      ? ModelObject.inspectGroup(context.return, options.frame)
      : undefined;
  }

  export function inspectChildren(
    _args: [readonly Model[], GroupOptions?],
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
