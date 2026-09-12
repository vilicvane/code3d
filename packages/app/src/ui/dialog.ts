import {action, autorun, makeObservable, observableRef, reaction} from 'mobx';

/** Shared modal lifetime; callers own their form and domain state. */
export class AppDialog {
  readonly element = document.createElement('dialog');
  private visible = false;
  private disposed = false;
  private focus?: HTMLElement;
  private previousFocus?: HTMLElement;
  private readonly listeners = new AbortController();
  private readonly stopVisibility: () => void;

  constructor(
    private readonly options: {
      title: string;
      className?: string;
      canDismiss?(): boolean;
      onClose?(): void;
    },
    host = document.body,
  ) {
    makeObservable<this, 'visible'>(this, {
      visible: observableRef,
      open: action,
      close: action,
    });
    this.element.className = `app-dialog ${options.className ?? ''}`.trim();
    this.element.setAttribute('aria-label', options.title);
    host.append(this.element);
    const {signal} = this.listeners;
    this.element.addEventListener('keydown', event => event.stopPropagation(), {
      signal,
    });
    this.element.addEventListener(
      'cancel',
      event => {
        event.preventDefault();
        this.dismiss();
      },
      {signal},
    );
    this.element.addEventListener(
      'click',
      event => {
        if (event.target !== this.element) return;
        const bounds = this.element.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          this.dismiss();
      },
      {signal},
    );
    this.element.addEventListener(
      'close',
      () => {
        // An old close event may arrive after the same window was reopened.
        if (this.element.open) return;
        this.close();
        options.onClose?.();
      },
      {signal},
    );
    this.stopVisibility = reaction(
      () => this.visible,
      visible => {
        if (visible) {
          this.previousFocus =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : undefined;
          this.element.showModal();
          this.focus?.focus();
          if (this.focus instanceof HTMLInputElement) this.focus.select();
        } else {
          this.element.close();
          if (this.previousFocus?.isConnected) this.previousFocus.focus();
        }
      },
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(focus?: HTMLElement): void {
    if (this.disposed || this.visible) return;
    this.focus = focus;
    this.visible = true;
  }

  close(): void {
    this.visible = false;
  }

  dismiss(): void {
    if (this.options.canDismiss?.() !== false) this.close();
  }

  dispose(): void {
    this.close();
    this.disposed = true;
    this.stopVisibility();
    this.listeners.abort();
    this.element.close();
    this.element.remove();
  }
}

export type DialogOptions = Readonly<{
  title: string;
  message?: string;
  submit?: string;
  cancel?: string;
  danger?: boolean;
}>;

export type PromptOptions = DialogOptions &
  Readonly<{
    label: string;
    value?: string;
    placeholder?: string;
    required?: boolean;
    trim?: boolean;
    validate?(value: string): void;
  }>;

type DialogRequest = {
  start(): void;
  cancel(): void;
};

/** A page-owned queue of individual requests, never a latest-event store. */
export class AppDialogs {
  private readonly requests: DialogRequest[] = [];
  private disposed = false;

  alert(options: DialogOptions): Promise<void> {
    return this.request('alert', options).then(() => {});
  }

  confirm(options: DialogOptions): Promise<boolean> {
    return this.request('confirm', options).then(result => result === true);
  }

  prompt(options: PromptOptions): Promise<string | undefined> {
    return this.request('prompt', options).then(result =>
      typeof result === 'string' ? result : undefined,
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const request of [...this.requests]) request.cancel();
  }

  private request(
    kind: 'alert' | 'confirm' | 'prompt',
    options: DialogOptions | PromptOptions,
  ): Promise<boolean | string | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    return new Promise(resolve => {
      let dialog: AppDialog | undefined;
      let stopFeedback: (() => void) | undefined;
      let result: boolean | string | undefined;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        stopFeedback?.();
        dialog?.dispose();
        const index = this.requests.indexOf(request);
        this.requests.splice(index, 1);
        resolve(result);
        if (!this.disposed && index === 0) this.requests[0]?.start();
      };
      const request: DialogRequest = {
        cancel: finish,
        start: () => {
          dialog = new AppDialog({
            title: options.title,
            className: 'message-dialog',
            onClose: finish,
          });
          const form = document.createElement('form');
          form.className = 'app-dialog-content';
          form.noValidate = true;
          const header = document.createElement('header');
          const title = document.createElement('h2');
          title.textContent = options.title;
          header.append(title);
          if (options.message) {
            const description = document.createElement('p');
            description.id = `dialog-description-${nextDialogId++}`;
            description.textContent = options.message;
            header.append(description);
            dialog.element.setAttribute('aria-describedby', description.id);
          }
          form.append(header);
          const input =
            kind === 'prompt' ? document.createElement('input') : undefined;
          const prompt = options as PromptOptions;
          if (input) {
            input.setAttribute('aria-label', prompt.label);
            input.value = prompt.value ?? '';
            input.placeholder = prompt.placeholder ?? '';
            input.required = prompt.required ?? true;
            const field = document.createElement('label');
            const label = document.createElement('span');
            label.textContent = prompt.label;
            field.append(label, input);
            form.append(field);
          }
          const feedback = {
            error: '',
            setError(error: string) {
              this.error = error;
            },
          };
          makeObservable(feedback, {error: observableRef, setError: action});
          const error = document.createElement('p');
          error.className = 'dialog-error';
          error.id = `dialog-error-${nextDialogId++}`;
          error.setAttribute('role', 'alert');
          input?.setAttribute('aria-describedby', error.id);
          stopFeedback = autorun(() => {
            error.textContent = feedback.error;
            error.hidden = !feedback.error;
            input?.setAttribute('aria-invalid', String(!!feedback.error));
            input?.setCustomValidity(feedback.error);
          });
          input?.addEventListener('input', () => feedback.setError(''));
          const footer = document.createElement('footer');
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'dialog-button';
          cancel.textContent = options.cancel ?? 'Cancel';
          cancel.addEventListener('click', () => dialog!.dismiss());
          if (kind !== 'alert') footer.append(cancel);
          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.className = `dialog-button ${options.danger ? 'button-danger' : 'button-primary'}`;
          submit.textContent =
            options.submit ?? (kind === 'confirm' ? 'Confirm' : 'OK');
          footer.append(submit);
          form.append(error, footer);
          form.addEventListener('submit', event => {
            event.preventDefault();
            if (input) {
              const value = prompt.trim ? input.value.trim() : input.value;
              try {
                if (input.required && !value.trim())
                  throw new Error(`Enter ${prompt.label.toLowerCase()}.`);
                prompt.validate?.(value);
              } catch (error) {
                feedback.setError(
                  error instanceof Error ? error.message : String(error),
                );
                input.focus();
                return;
              }
              result = value;
            } else result = true;
            dialog!.close();
          });
          dialog.element.append(form);
          dialog.open(input ?? (kind === 'confirm' ? cancel : submit));
        },
      };
      this.requests.push(request);
      if (this.requests.length === 1) request.start();
    });
  }
}

let nextDialogId = 1;
export const dialogs = new AppDialogs();
