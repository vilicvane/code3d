import type {ModelInputValues, SourceRef} from '@code3d/core/tooling';
import type {ModelModule} from './compiler';
import {
  action,
  computedStruct,
  makeObservable,
  observableRef,
  reaction,
  runInAction,
} from 'mobx';

/** Session-local overrides; declarations are derived from the current execution. */
export class ModelInputs {
  values: ModelInputValues = {};
  private queued = false;
  private pending = false;
  private stopExecution?: () => void;
  private readonly definitions: () => ModelModule['inputs'];

  constructor(definitions: () => ModelModule['inputs']) {
    this.definitions = definitions;
    makeObservable<this, 'queued' | 'pending'>(this, {
      values: observableRef,
      queued: observableRef,
      pending: observableRef,
      fields: computedStruct,
      set: action,
      reset: action,
      clear: action,
    });
  }

  get fields() {
    return this.definitions().map(definition => ({
      ...definition,
      value: Object.hasOwn(this.values, definition.name)
        ? this.values[definition.name]
        : definition.defaultValue,
    }));
  }

  atSource(
    cursor: {file: string; offset: number} | undefined,
    resolve: (ref: SourceRef) => SourceRef | undefined,
  ): string | undefined {
    if (!cursor) return;
    let match: {name?: string; size: number} | undefined;
    for (const {name, sourceRefs} of this.definitions()) {
      for (const ref of sourceRefs) {
        const current = resolve(ref);
        if (
          !current ||
          current.file !== cursor.file ||
          cursor.offset < current.start ||
          cursor.offset > current.end
        )
          continue;
        const size = current.end - current.start;
        if (!match || size < match.size) match = {name, size};
        else if (size === match.size && match.name !== name) match = {size};
      }
    }
    return match?.name;
  }

  /** Accept one valid field without disturbing unfinished text in other fields. */
  set(name: string, value: number): void {
    const field = this.fields.find(field => field.name === name)!;
    if (field.value === value) return;
    const overrides = new Map(Object.entries(this.values));
    if (value === field.defaultValue) overrides.delete(name);
    else overrides.set(name, value);
    this.values = Object.fromEntries(overrides);
    this.queued = true;
  }

  reset(): void {
    this.values = {};
    this.queued = true;
  }

  /** A new file discards both overrides and work waiting behind the old execution. */
  clear(): void {
    this.values = {};
    this.queued = false;
  }

  /** Render during a drag, with one in-flight evaluation and only the latest next value. */
  observeExecution(
    ready: () => boolean,
    evaluate: (values: ModelInputValues) => Promise<unknown>,
  ): void {
    this.stopExecution?.();
    this.stopExecution = reaction(
      () => this.queued && !this.pending && ready(),
      available => {
        if (available) void this.evaluate(evaluate);
      },
      {fireImmediately: true},
    );
  }

  private async evaluate(
    execute: (values: ModelInputValues) => Promise<unknown>,
  ): Promise<void> {
    const values = this.values;
    runInAction(() => {
      this.queued = false;
      this.pending = true;
    });
    try {
      await execute(values);
    } finally {
      runInAction(() => {
        this.pending = false;
      });
    }
  }

  dispose(): void {
    this.stopExecution?.();
    this.stopExecution = undefined;
    this.clear();
  }
}
