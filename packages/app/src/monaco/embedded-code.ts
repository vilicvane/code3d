import type {TextSpan} from '@typescript/typescript6';
import type {TypeScriptSelectionRange} from './typescript-protocol';

export type EmbeddedCode = Readonly<{start: number; text: string}>;

/**
 * A contiguous source fragment inside generated TypeScript. Masked trivia
 * (such as JSDoc prefixes) must preserve UTF-16 length and line endings.
 * Generated wrappers are deliberately outside the source mapping.
 */
export class EmbeddedCodeProjection {
  readonly source: string;
  readonly sourceSpan: TextSpan;
  private readonly generatedStart: number;

  constructor(code: EmbeddedCode, prefix: string, suffix: string) {
    this.source = prefix + code.text + suffix;
    this.sourceSpan = {start: code.start, length: code.text.length};
    this.generatedStart = prefix.length;
  }

  toGeneratedOffset(sourceOffset: number): number {
    return this.generatedStart + sourceOffset - this.sourceSpan.start;
  }

  toSourceSpan(span: TextSpan): TextSpan | undefined {
    if (
      span.start < this.generatedStart ||
      span.start + span.length > this.generatedStart + this.sourceSpan.length
    )
      return undefined;
    return {
      start: this.sourceSpan.start + span.start - this.generatedStart,
      length: span.length,
    };
  }

  selectionRange(
    generated: TypeScriptSelectionRange,
    containers: readonly TextSpan[],
    outer: TypeScriptSelectionRange,
  ): TypeScriptSelectionRange {
    const spans: TextSpan[] = [];
    const append = (span: TextSpan): void => {
      const inner = spans.at(-1);
      if (
        inner &&
        (span.start > inner.start ||
          span.start + span.length < inner.start + inner.length ||
          (span.start === inner.start && span.length === inner.length))
      )
        return;
      spans.push(span);
    };
    for (
      let current: TypeScriptSelectionRange | undefined = generated;
      current;
      current = current.parent
    ) {
      const span = this.toSourceSpan(current.textSpan);
      if (span) append(span);
    }
    append(this.sourceSpan);
    for (const span of containers) append(span);
    for (
      let current: TypeScriptSelectionRange | undefined = outer;
      current;
      current = current.parent
    ) {
      append(current.textSpan);
    }
    // The source fragment always contributes a range, even in incomplete code.
    return spans.reduceRight<TypeScriptSelectionRange | undefined>(
      (parent, textSpan) => ({textSpan, parent}),
      undefined,
    )!;
  }
}
