import type {
  Constraint,
  FaceAnchor,
  LineAnchor,
  SolidModel,
} from '@code3d/core';

/** Deliberate hint vocabulary; API renames are checked without build-time scanning. */
export const previewOperations = [
  // Transformations: origins, rotation/scale, and spatial relations.
  'originOffset',
  'originPoint',
  'originCenter',
  'originVertex',
  'rotate',
  'scaled',
  'offset',
  'relate',
  'on',
  'align',
  'pivot',
  'pivotVertex',
  'around',
  'reverse',
  'flip',
  // Operations: composition and booleans.
  'group',
  'union',
  'intersect',
  'cut',
] as const satisfies readonly (
  | keyof SolidModel
  | keyof Constraint
  | keyof LineAnchor
  | keyof FaceAnchor
  | keyof typeof import('@code3d/core')
)[];

/** Each round starts with the two targets, then visits every operation once. */
export function* previewWords(
  random: () => number = Math.random,
): Generator<string, never> {
  for (;;) {
    yield 'model';
    yield 'sketch';
    const shuffled = [...previewOperations];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    yield* shuffled;
  }
}

export class ViewportEmptyState {
  private readonly host: HTMLElement;
  private readonly word: HTMLElement;
  private readonly text: HTMLElement;
  private words: Generator<string, never>;

  constructor(host: HTMLElement) {
    this.host = host;
    this.word = host.querySelector<HTMLElement>('.viewport-preview-word')!;
    this.text = host.querySelector<HTMLElement>('.viewport-preview-text')!;
    this.words = previewWords();
    this.text.addEventListener('animationiteration', event => {
      if (event.animationName === 'viewport-preview-type') this.nextWord();
    });
  }

  setVisible(visible: boolean): void {
    if (visible === !this.host.hidden) return;
    if (visible) {
      this.words = previewWords();
      this.nextWord();
    }
    // display:none also stops the CSS clock; no background timers remain.
    this.host.hidden = !visible;
  }

  private nextWord(): void {
    const word = this.words.next().value;
    this.text.textContent = word;
    this.word.style.setProperty('--word-length', String(word.length));
  }
}
