import type {
  InspectCall,
  InspectClosure,
  InspectContext,
  InspectContextFactory,
  Inspector,
  InspectResult,
  PreviewValue,
  SolidModel,
} from '@code3d/core';
import type {SourceRef} from '@code3d/core/tooling';
import {ModelDiagnosticError, locateModelError} from './diagnostic';
import type {
  InspectAnnotation,
  InspectCallSite,
  InspectParameter,
} from './inspect-schema';
import type {ModuleExports} from './module-evaluator';

export type InspectSelection = Readonly<{
  file: string;
  offset: number;
  contextId?: string;
  order?: number;
  callId?: string;
  /** The caret resolved to a relate array insertion gap. */
  relationArray?: Readonly<{
    array: SourceRef;
    gap: SourceRef;
    /** Loop instances share a contextId; the owner retains the instance. */
    ownerNodeId?: string;
  }>;
}>;

type CallbackGetters = readonly ((() => unknown) | undefined)[];

export type InspectedValues = InspectResult &
  Readonly<{
    kind: 'preview' | 'inspect';
    focused: readonly PreviewValue[];
    /** Ordinary containers share their members' solved frame. */
    collection?: boolean;
  }>;

export type InspectExecution = {
  id: string;
  siteId: string;
  contextId: string;
  parent?: InspectExecution;
  closure?: ClosureRecord;
  callee?: Function;
  invoked: boolean;
  bindings?: CallbackGetters;
  receiver: unknown;
  arguments: readonly unknown[];
  argumentRanges: Array<{start: number; count: number}>;
  argumentCount: number;
  return: unknown;
  data: unknown;
  completed: boolean;
};

type ClosureRecord = {
  call: InspectExecution;
  parameter: InspectParameter;
  parent?: ClosureRecord;
  arguments: readonly unknown[];
  return: unknown;
  context?: Promise<InspectClosure>;
};

type RecordedValue = Readonly<{
  id: string;
  sourceRef: SourceRef;
  contextId: string;
  order: number;
  value: unknown;
  call?: InspectExecution;
  closure?: ClosureRecord;
  /** Absolute placement prefix when this record stands for an array insertion gap. */
  insertion?: number;
}>;

/** Raw model values and callable closures never leave their execution Worker. */
export class InspectionSession {
  private readonly definitions = new WeakMap<
    Function,
    Map<string, CallbackGetters>
  >();
  private readonly frames: InspectExecution[] = [];
  private readonly executions = new Map<string, InspectExecution[]>();
  private readonly invokedCalls = new Set<string>();
  private readonly completedCalls = new Map<string, InspectExecution>();
  private readonly values: RecordedValue[] = [];
  private activeClosure?: ClosureRecord;
  private inspecting = false;
  private disposed = false;
  get isInspecting(): boolean {
    return this.inspecting;
  }

  constructor(
    private readonly sites: ReadonlyMap<string, InspectCallSite>,
    private readonly importModule: (path: string) => Promise<ModuleExports>,
    private readonly previewValues: (value: unknown) => readonly PreviewValue[],
    private readonly isSolid: (value: PreviewValue) => value is SolidModel<{}>,
    private readonly relationArraySites: readonly Readonly<{
      sourceRef: SourceRef;
      gaps: readonly SourceRef[];
    }>[] = [],
    private readonly relationArrayOwner?: (
      callReturn: unknown,
    ) => string | undefined,
  ) {}

  enter(
    siteId: string,
    contextId: string,
    executionIndex: number,
  ): InspectExecution | undefined {
    if (this.inspecting || this.disposed) return undefined;
    const execution: InspectExecution = {
      id: `${siteId}:execution:${executionIndex}`,
      siteId,
      contextId,
      parent: this.frames.at(-1),
      closure: this.activeClosure,
      invoked: false,
      receiver: undefined,
      arguments: [],
      argumentRanges: [],
      argumentCount: 0,
      return: undefined,
      data: undefined,
      completed: false,
    };
    this.frames.push(execution);
    const entries = this.executions.get(siteId) ?? [];
    entries.push(execution);
    this.executions.set(siteId, entries);
    return execution;
  }

  leave(execution: InspectExecution | undefined): void {
    if (execution) this.frames.pop();
  }

  hasInvocation(id: string): boolean {
    return this.invokedCalls.has(id);
  }

  fail(execution: InspectExecution | undefined, order: number): void {
    if (execution?.invoked) this.recordCall(execution, order);
  }

  complete(
    execution: InspectExecution | undefined,
    value: unknown,
    order: number,
  ): void {
    if (!execution) return;
    execution.return = value;
    execution.completed = true;
    this.recordCall(execution, order);
  }

  private recordCall(execution: InspectExecution, order: number): void {
    const site = this.sites.get(execution.siteId);
    if (site) {
      if (execution.completed)
        this.completedCalls.set(locationKey(site.callRef), execution);
      this.values.push({
        id: execution.id,
        sourceRef: site.callRef,
        value: execution.return,
        contextId: execution.contextId,
        order,
        call: execution,
        closure: execution.closure,
      });
    }
  }

  value(
    id: string,
    sourceRef: SourceRef,
    value: unknown,
    contextId: string,
    order: number,
  ): void {
    if (this.inspecting || this.disposed) return;
    const completed =
      this.executions.get(id)?.at(-1) ??
      this.completedCalls.get(locationKey(sourceRef));
    const call =
      completed?.completed && completed.return === value
        ? completed
        : this.frames.at(-1);
    this.values.push({
      id,
      sourceRef,
      value,
      contextId,
      order,
      call,
      closure:
        completed?.completed && call === completed
          ? completed.closure
          : this.activeClosure,
    });
  }

  definition<T>(id: string, getters: CallbackGetters, value: T): T {
    if (typeof value === 'function' && !this.inspecting) {
      const entries = this.definitions.get(value) ?? new Map();
      entries.set(id, getters);
      this.definitions.set(value, entries);
    }
    return value;
  }

  method(id: string, getters: CallbackGetters): void {
    const frame = this.frames.at(-1);
    if (frame?.invoked && this.sites.get(frame.siteId)?.signature.id === id) {
      frame.bindings = getters;
      if (frame.callee) this.definition(id, getters, frame.callee);
    }
  }

  capture(data: unknown): void {
    if (this.inspecting || this.disposed) return;
    for (let index = this.frames.length - 1; index >= 0; index--) {
      const call = this.frames[index];
      if (call.invoked && this.sites.has(call.siteId)) {
        call.data = data;
        return;
      }
    }
  }

  argument<T>(siteId: string, index: number, value: T, order: number): T {
    const call = this.current(siteId);
    if (call) {
      call.argumentRanges[index] = {start: call.argumentCount++, count: 1};
      this.values.push({
        id: `${call.id}:argument:${index}`,
        sourceRef: this.sites.get(siteId)!.arguments[index].sourceRef,
        value,
        contextId: call.contextId,
        order,
        call,
        closure: call.closure,
      });
    }
    return value;
  }

  *spread<T>(siteId: string, index: number, values: Iterable<T>): Iterable<T> {
    const call = this.current(siteId);
    const range = {start: call?.argumentCount ?? 0, count: 0};
    if (call) call.argumentRanges[index] = range;
    for (const value of values) {
      range.count++;
      if (call) call.argumentCount++;
      yield value;
    }
  }

  invoke(
    siteId: string,
    callee: Function,
    receiver: unknown,
    args: unknown[],
  ): unknown {
    const call = this.current(siteId);
    if (!call) return Reflect.apply(callee, receiver, args);
    call.callee = typeof callee === 'function' ? callee : undefined;
    call.invoked = !!call.callee;
    if (call.invoked) this.invokedCalls.add(call.id);
    call.receiver = receiver;
    call.arguments = args;
    const site = this.sites.get(siteId)!;
    const closures = new Map<string, InspectParameter>();
    for (const annotation of site.signature.annotations) {
      if (annotation.kind === 'closure' || annotation.kind === 'context')
        closures.set(annotation.parameter!.name, annotation.parameter!);
    }
    let supplied = args;
    for (const parameter of closures.values()) {
      const callback = valueAt(args, parameter.path);
      if (typeof callback !== 'function') continue;
      const session = this;
      const wrapped = function (this: unknown, ...values: unknown[]) {
        const closure: ClosureRecord = {
          call,
          parameter,
          parent: session.activeClosure,
          arguments: values,
          return: undefined,
        };
        const previous = session.activeClosure;
        session.activeClosure = closure;
        try {
          const result = Reflect.apply(callback, this, values);
          closure.return = result;
          return result;
        } finally {
          session.activeClosure = previous;
        }
      };
      supplied = replaceAt(supplied, parameter.path, wrapped) as unknown[];
    }
    return Reflect.apply(callee, receiver, supplied);
  }

  read<T>(siteId: string, receiver: unknown, get: () => T): T {
    const call = this.current(siteId);
    if (call && receiver != null) {
      call.receiver = receiver;
      call.invoked = true;
      this.invokedCalls.add(call.id);
    }
    return get();
  }

  async inspect(
    selection: InspectSelection,
  ): Promise<InspectedValues | undefined> {
    if (this.disposed) return;
    const focus = this.gapFocus(selection) ?? this.focus(selection);
    if (!focus) return;
    const selected = (result: InspectResult): InspectedValues => ({
      ...result,
      kind: 'inspect',
      focused: result.focused ?? this.previewValues(focus.value),
    });
    const preview = (value: unknown): InspectedValues | undefined => {
      const values = this.previewValues(value);
      return values.length
        ? {
            kind: 'preview',
            target: values,
            focused: this.previewValues(focus.value),
            collection: value !== values[0],
          }
        : undefined;
    };
    this.inspecting = true;
    try {
      let closure = focus.closure;
      let fallback: InspectedValues | undefined;
      for (let call = focus.call; call; call = call.parent) {
        let insideClosure = false;
        while (closure && closure.call === call) {
          insideClosure = true;
          const result = await this.inspectClosure(closure, focus);
          if (result !== undefined) return selected(result);
          closure = closure.parent;
        }
        // Declining a callback body is not selecting the callback argument.
        // Continue to outer scopes without re-entering its owning call inspector.
        if (insideClosure) continue;
        const site = this.sites.get(call.siteId);
        if (
          !site ||
          (!call.invoked &&
            (!call.completed || site.signature.annotations.length > 0)) ||
          !within(site.callRef, selection)
        )
          continue;
        if (site.signature.diagnostic)
          throw new ModelDiagnosticError({
            kind: 'inspect',
            ...site.signature.diagnostic,
          });
        // Parameter declarations win regardless of their order in JSDoc.
        for (const annotation of site.signature.annotations) {
          if (annotation.kind !== 'parameter') continue;
          const scope = this.focusedParameter(
            site,
            call,
            annotation.parameter!,
            selection,
          );
          if (!scope) continue;
          const result = await this.render(
            call,
            annotation,
            focus,
            scope.parameter,
            scope.path,
          );
          if (result !== undefined) return selected(result);
        }
        const inArguments = site.arguments.some(argument =>
          within(argument.sourceRef, selection),
        );
        const inReceiver =
          site.receiverRef && within(site.receiverRef, selection);
        const parameter = site.signature.parameters
          .map(parameter =>
            this.focusedParameter(site, call, parameter, selection),
          )
          .find(scope => scope !== undefined);
        if (!inReceiver) {
          const annotation = site.signature.annotations.find(
            annotation => annotation.kind === 'call',
          );
          if (annotation) {
            const result = await this.render(
              call,
              annotation,
              focus,
              parameter?.parameter,
              parameter?.path ?? [],
            );
            if (result !== undefined) return selected(result);
          }
          // Enclosing inspectors can still describe an inner call's value, but
          // declining it must not replace that value with the outer call's result.
          fallback ??= preview(call.return);
          // Arguments default to their owning call; non-renderable results still
          // reach the enclosing scope (e.g. a relation's closure inspector).
          if (inArguments && fallback) return fallback;
        }
      }
      while (closure) {
        const result = await this.inspectClosure(closure, focus);
        if (result !== undefined) return selected(result);
        closure = closure.parent;
      }
      return fallback ?? preview(focus.value);
    } finally {
      this.inspecting = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.values.length = 0;
    this.frames.length = 0;
    this.executions.clear();
    this.completedCalls.clear();
    this.invokedCalls.clear();
    this.activeClosure = undefined;
  }

  private current(siteId: string): InspectExecution | undefined {
    if (this.inspecting || this.disposed) return;
    const frame = this.frames.at(-1);
    return frame?.siteId === siteId ? frame : undefined;
  }

  private focus(selection: InspectSelection): RecordedValue | undefined {
    return this.values
      .filter(
        value =>
          within(value.sourceRef, selection) &&
          (!selection.callId || belongsToCall(value.call, selection.callId)) &&
          (!selection.contextId || value.contextId === selection.contextId),
      )
      .sort(
        (a, b) =>
          a.sourceRef.end -
            a.sourceRef.start -
            (b.sourceRef.end - b.sourceRef.start) ||
          Number(b.order === selection.order) -
            Number(a.order === selection.order) ||
          b.order - a.order,
      )[0];
  }

  /** An insertion gap focuses its array value with the preceding element count. */
  private gapFocus(selection: InspectSelection): RecordedValue | undefined {
    const relationArray = selection.relationArray;
    if (!relationArray) return undefined;
    const site = this.relationArraySites.find(
      site =>
        site.sourceRef.file === relationArray.array.file &&
        site.sourceRef.start === relationArray.array.start &&
        site.sourceRef.end === relationArray.array.end,
    );
    const index = site?.gaps.findIndex(
      gap =>
        gap.file === relationArray.gap.file &&
        gap.start === relationArray.gap.start &&
        gap.end === relationArray.gap.end,
    );
    if (!site || index === undefined || index < 0) return undefined;
    let records = this.values.filter(
      value =>
        Array.isArray(value.value) &&
        value.sourceRef.file === site.sourceRef.file &&
        value.sourceRef.start === site.sourceRef.start &&
        value.sourceRef.end === site.sourceRef.end &&
        (!selection.callId || belongsToCall(value.call, selection.callId)) &&
        (!selection.contextId || value.contextId === selection.contextId),
    );
    const ownerNodeId = relationArray.ownerNodeId;
    if (ownerNodeId && this.relationArrayOwner) {
      const owned = records.filter(
        record =>
          this.relationArrayOwner!(record.closure?.call.return) === ownerNodeId,
      );
      if (owned.length) records = owned;
    }
    const record = records.sort(
      (a, b) =>
        Number(b.order === selection.order) -
          Number(a.order === selection.order) || b.order - a.order,
    )[0];
    if (!record) return undefined;
    // The recorded array length anchors the site to this evaluation, keeping
    // the prefix right for derived values whose array prepends extra elements.
    const insertion =
      (record.value as readonly unknown[]).length -
      (site.gaps.length - 1 - index);
    return {...record, insertion};
  }

  private focusedParameter(
    site: InspectCallSite,
    call: InspectExecution,
    parameter: InspectParameter,
    selection: InspectSelection,
  ): {parameter?: string; path: readonly (string | number)[]} | undefined {
    if (parameter.name === 'this')
      return site.receiverRef && within(site.receiverRef, selection)
        ? {parameter: 'this', path: []}
        : undefined;
    const sourceIndex = site.arguments.findIndex(argument =>
      within(argument.sourceRef, selection),
    );
    const source = site.arguments[sourceIndex];
    const range = call.argumentRanges[sourceIndex];
    if (!source || !range) return;
    const member = source.members
      .filter(member => within(member.sourceRef, selection))
      .sort((a, b) => b.path.length - a.path.length)[0];
    let path = member?.path ?? [];
    let argumentIndex = range.start;
    if (source.spread) {
      if (typeof path[0] === 'number') {
        argumentIndex += path[0];
        path = path.slice(1);
      } else if (
        range.count !== 1 &&
        !(
          parameter.rest &&
          parameter.path.length === 1 &&
          range.start >= Number(parameter.path[0])
        )
      )
        return;
    }
    const actual = [argumentIndex, ...path];
    const prefix = parameter.rest
      ? parameter.path.slice(0, -1)
      : parameter.path;
    if (!prefix.every((key, index) => key === actual[index])) return;
    if (parameter.rest) {
      const start = parameter.path.at(-1)!;
      const at = actual[prefix.length];
      if (typeof start !== 'number' || typeof at !== 'number' || at < start)
        return;
      return {
        parameter: parameter.name,
        path: [at - start, ...actual.slice(prefix.length + 1)],
      };
    }
    return {
      parameter: parameter.name,
      path: actual.slice(parameter.path.length),
    };
  }

  private async inspectClosure(
    closure: ClosureRecord,
    focus: RecordedValue,
  ): Promise<InspectResult | undefined> {
    const annotation = this.sites
      .get(closure.call.siteId)
      ?.signature.annotations.find(
        annotation =>
          annotation.kind === 'closure' &&
          annotation.parameter?.name === closure.parameter.name,
      );
    return (
      annotation &&
      this.render(closure.call, annotation, focus, undefined, [], closure)
    );
  }

  private async render(
    call: InspectExecution,
    annotation: InspectAnnotation,
    focus: RecordedValue,
    parameter: string | undefined,
    path: readonly (string | number)[],
    closure = focus.closure,
  ): Promise<InspectResult | undefined> {
    try {
      const callback = await this.callback(call, annotation);
      const values = this.previewValues(focus.value);
      const context: InspectContext = {
        receiver: call.receiver,
        return: call.return,
        data: call.data,
        closure: closure && (await this.closureContext(closure)),
        focused: {
          value: focus.value,
          values,
          solids: values.filter(this.isSolid),
          parameter,
          path,
          insertion: focus.insertion,
        },
      };
      if (this.disposed) return;
      const result = (callback as Inspector)(call.arguments, context);
      if (
        result !== undefined &&
        (result === null || typeof result !== 'object' || 'then' in result)
      )
        throw new Error(
          'An inspector must return an InspectResult object or undefined.',
        );
      return result;
    } catch (error) {
      throw locateModelError(error, annotation.binding.sourceRef, 'inspect');
    }
  }

  private closureContext(closure: ClosureRecord): Promise<InspectClosure> {
    return (closure.context ??= (async () => {
      const annotation = this.sites
        .get(closure.call.siteId)
        ?.signature.annotations.find(
          annotation =>
            annotation.kind === 'context' &&
            annotation.parameter?.name === closure.parameter.name,
        );
      const parent =
        closure.parent && (await this.closureContext(closure.parent));
      const call: InspectCall = {
        receiver: closure.call.receiver,
        arguments: closure.call.arguments,
        return: closure.call.return,
        data: closure.call.data,
      };
      const execution = {
        arguments: closure.arguments,
        return: closure.return,
        call,
        parent,
      };
      if (!annotation) return {...execution, data: undefined};
      try {
        const provider = (await this.callback(
          closure.call,
          annotation,
        )) as InspectContextFactory;
        return {...execution, provider, data: provider(execution)};
      } catch (error) {
        throw locateModelError(error, annotation.binding.sourceRef, 'inspect');
      }
    })());
  }

  private async callback(
    call: InspectExecution,
    annotation: InspectAnnotation,
  ): Promise<Function> {
    const binding = annotation.binding;
    let value: unknown;
    if (binding.kind === 'local') {
      const index = this.sites
        .get(call.siteId)!
        .signature.annotations.indexOf(annotation);
      const getters =
        call.bindings ??
        this.definitions.get(call.callee!)?.get(binding.definition);
      value = getters?.[index]?.();
    } else {
      value = valueAt(
        binding.kind === 'callee'
          ? call.callee
          : await this.importModule(binding.module),
        binding.path,
      );
    }
    if (typeof value !== 'function')
      throw new Error(
        `Inspector is not exported or is not callable: ${binding.path.join('.')}.`,
      );
    return value;
  }
}

function within(ref: SourceRef, selection: InspectSelection): boolean {
  return (
    ref.file === selection.file &&
    ref.start <= selection.offset &&
    selection.offset <= ref.end
  );
}

function belongsToCall(
  call: InspectExecution | undefined,
  id: string,
): boolean {
  for (; call; call = call.parent) if (call.id === id) return true;
  return false;
}

function locationKey(ref: SourceRef): string {
  return `${ref.file}:${ref.start}:${ref.end}`;
}

function valueAt(value: unknown, path: readonly (string | number)[]): unknown {
  for (const part of path) {
    if (value === undefined || value === null) return undefined;
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

/** Only callback-containing containers are copied; the original arguments remain in the record. */
function replaceAt(
  value: unknown,
  path: readonly (string | number)[],
  replacement: unknown,
): unknown {
  if (!path.length) return replacement;
  const [key, ...tail] = path;
  const result = Array.isArray(value) ? [...value] : {...(value as object)};
  (result as Record<string | number, unknown>)[key] = replaceAt(
    valueAt(value, [key]),
    tail,
    replacement,
  );
  return result;
}
