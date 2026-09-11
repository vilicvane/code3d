import {action, autorun, makeObservable, observableRef} from 'mobx';
import {X} from 'lucide';
import {createIcon} from './icons';

/** The latest completed tool failure; previews keep their errors in the gesture. */
export class ViewportToolFeedback {
  private failure?: Readonly<{operation: string; message: string}>;
  private readonly root = document.createElement('section');
  private readonly stop: () => void;

  constructor(container: HTMLElement) {
    makeObservable<this, 'failure'>(this, {
      failure: observableRef,
      report: action,
      dismiss: action,
    });
    this.root.className = 'viewport-diagnostic viewport-tool-error';
    this.root.setAttribute('role', 'alert');
    const message = document.createElement('span');
    const close = document.createElement('button');
    close.type = 'button';
    close.title = 'Dismiss tool error';
    close.setAttribute('aria-label', close.title);
    close.append(createIcon(X));
    close.addEventListener('click', () => this.dismiss());
    this.root.append(message, close);
    container.append(this.root);
    this.stop = autorun(() => {
      this.root.hidden = !this.failure;
      message.textContent = this.failure?.message ?? '';
    });
  }

  report(operation: string, message?: string): void {
    if (message) this.failure = {operation, message};
    else if (this.failure?.operation === operation) this.failure = undefined;
  }

  dismiss(): void {
    this.failure = undefined;
  }

  dispose(): void {
    this.stop();
    this.root.remove();
  }
}
