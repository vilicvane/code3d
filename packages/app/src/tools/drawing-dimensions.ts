import {sourceExpressionError} from './source-expression';
import {action, computed, makeObservable, observableRef} from 'mobx';

export type DrawingDimension = Readonly<{
  id: string;
  label: string;
  unit?: string;
  positive?: boolean;
  exclusiveMaximum?: number;
}>;

/** Text in progress and accepted preview values have separate lifetimes. */
export class DrawingDimensions {
  private drafts: ReadonlyMap<string, {text: string; value?: number}> =
    new Map();

  constructor(
    readonly definitions: readonly DrawingDimension[],
    private readonly changed?: (id: string) => void,
    readonly expressions = false,
  ) {
    makeObservable<this, 'drafts'>(this, {
      drafts: observableRef,
      edited: computed,
      clear: action,
      set: action,
    });
    this.clear();
  }

  clear(): void {
    this.drafts = new Map(
      this.definitions.map(field => [field.id, {text: ''}]),
    );
  }

  checkpoint(): () => void {
    const drafts = this.drafts;
    return action(() => {
      this.drafts = drafts;
    });
  }

  get edited(): boolean {
    return [...this.drafts.values()].some(draft => draft.text !== '');
  }

  text(id: string): string {
    return this.drafts.get(id)!.text;
  }

  value(id: string): number | undefined {
    return this.drafts.get(id)!.value;
  }

  set(id: string, text: string): void {
    const draft = this.drafts.get(id)!;
    const next = new Map(this.drafts);
    next.set(id, {...draft, text});
    this.drafts = next;
    // Keep the last valid preview while the user enters a sign or exponent.
    if (!this.error(id))
      next.set(id, {
        text,
        value:
          text.trim() && Number.isFinite(Number(text))
            ? Number(text)
            : undefined,
      });
    this.changed?.(id);
  }

  error(id: string): string | undefined {
    const field = this.definitions.find(field => field.id === id)!;
    const text = this.text(id).trim();
    if (!text) return undefined;
    if (this.expressions) {
      const syntaxError = sourceExpressionError(text);
      if (syntaxError) return `${field.label}: ${syntaxError}`;
      // Variables and compound expressions are evaluated by normal compilation
      // after commit, in the sketch's lexical scope, never by the form.
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
        return undefined;
    }
    if (
      !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ||
      !Number.isFinite(Number(text))
    )
      return `${field.label}: enter a finite number`;
    if (field.positive && Number(text) <= 0)
      return `${field.label} must be greater than zero`;
    if (
      field.exclusiveMaximum !== undefined &&
      Number(text) >= field.exclusiveMaximum
    )
      return `${field.label} must be less than ${field.exclusiveMaximum}`;
    return undefined;
  }
}
