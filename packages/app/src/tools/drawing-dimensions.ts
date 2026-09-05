export type DrawingDimension = Readonly<{
  id: string;
  label: string;
  unit?: string;
  positive?: boolean;
}>;

/** Text in progress and accepted preview values have separate lifetimes. */
export class DrawingDimensions {
  private readonly drafts = new Map<string, {text: string; value?: number}>();

  constructor(
    readonly definitions: readonly DrawingDimension[],
    private readonly changed?: (id: string) => void,
  ) {
    this.clear();
  }

  clear(): void {
    for (const field of this.definitions) this.drafts.set(field.id, {text: ''});
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
    draft.text = text;
    // Keep the last valid preview while the user enters a sign or exponent.
    if (!this.error(id)) draft.value = text.trim() ? Number(text) : undefined;
    this.changed?.(id);
  }

  error(id: string): string | undefined {
    const field = this.definitions.find(field => field.id === id)!;
    const text = this.text(id).trim();
    if (!text) return undefined;
    if (
      !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ||
      !Number.isFinite(Number(text))
    )
      return `${field.label}: enter a finite number`;
    if (field.positive && Number(text) <= 0)
      return `${field.label} must be greater than zero`;
    return undefined;
  }
}
