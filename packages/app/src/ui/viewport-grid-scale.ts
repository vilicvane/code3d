import {formatGridStep} from '../grid-scale';
import {reaction, type IReactionDisposer} from 'mobx';

/** A schematic minor/major grid legend, not a screen-distance ruler. */
export class ViewportGridScale {
  private readonly root = document.createElement('div');
  private readonly value = document.createElement('span');
  private readonly stopRendering: IReactionDisposer;

  constructor(container: HTMLElement, readStep: () => number | undefined) {
    this.root.className = 'viewport-grid-scale';
    this.root.setAttribute('role', 'img');
    this.value.className = 'viewport-grid-scale-value';
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    bar.classList.add('viewport-grid-scale-bar');
    bar.setAttribute('width', '60');
    bar.setAttribute('height', '13');
    bar.setAttribute('aria-hidden', 'true');
    // Highlight the labeled cell; the remaining four provide major-grid context.
    for (const [className, d] of [
      ['viewport-grid-scale-remainder', 'M13.5 6.5H57.5M57.5 2.5V10.5'],
      ['viewport-grid-scale-cell', 'M2.5 2.5V10.5M2.5 6.5H13.5M13.5 2.5V10.5'],
    ]) {
      const path = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path',
      );
      path.classList.add(className);
      path.setAttribute('d', d);
      bar.append(path);
    }
    this.root.append(bar, this.value);
    container.append(this.root);
    this.stopRendering = reaction(readStep, step => this.render(step), {
      fireImmediately: true,
    });
  }

  private render(step: number | undefined): void {
    this.root.hidden = step === undefined;
    if (step === undefined) return;
    const text = `${formatGridStep(step)} unit`;
    if (this.value.textContent === text) return;
    this.value.textContent = text;
    const description = `Grid: ${text} per highlighted cell · 5 cells per major interval`;
    this.root.title = description;
    this.root.setAttribute('aria-label', description);
  }

  dispose(): void {
    this.stopRendering();
    this.root.remove();
  }
}
