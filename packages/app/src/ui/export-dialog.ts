import {
  action,
  autorun,
  makeObservable,
  observableRef,
  runInAction,
} from 'mobx';
import {AppDialog} from './dialog';

export class ExportDialog {
  private readonly dialog: AppDialog;
  private readonly form = document.createElement('form');
  private readonly fields = document.createElement('fieldset');
  private readonly submit = document.createElement('button');
  private readonly cancel = document.createElement('button');
  private readonly status = document.createElement('div');
  readonly description = document.createElement('p');
  private busy = false;
  private error = '';
  private label = 'Export';
  private disposed = false;
  private readonly stopRendering: () => void;

  constructor(
    host: HTMLElement,
    private readonly options: {
      title: string;
      description: string;
      busyLabel: string;
      export(): Promise<{blob: Blob; fileName: string}>;
    },
  ) {
    makeObservable<this, 'busy' | 'error' | 'label' | 'export'>(this, {
      busy: observableRef,
      error: observableRef,
      label: observableRef,
      open: action,
      setSubmitLabel: action,
      export: action,
    });
    this.dialog = new AppDialog(
      {
        title: options.title,
        className: 'viewport-export-dialog',
        canDismiss: () => !this.busy,
      },
      host,
    );
    this.form.className = 'app-dialog-content';
    const heading = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = options.title;
    this.description.textContent = options.description;
    heading.append(title, this.description);
    this.status.className = 'viewport-export-status';
    this.status.setAttribute('role', 'status');
    this.submit.type = 'submit';
    this.submit.className = 'dialog-button button-primary';
    this.cancel.type = 'button';
    this.cancel.className = 'dialog-button';
    this.cancel.textContent = 'Cancel';
    const actions = document.createElement('footer');
    actions.append(this.cancel, this.submit);
    this.form.append(heading, this.fields, this.status, actions);
    this.dialog.element.append(this.form);
    this.cancel.addEventListener('click', () => this.dialog.dismiss());
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      void this.export();
    });
    this.stopRendering = autorun(() => {
      this.submit.disabled =
        this.cancel.disabled =
        this.fields.disabled =
          this.busy;
      this.form.setAttribute('aria-busy', String(this.busy));
      this.submit.textContent = this.busy ? this.options.busyLabel : this.label;
      this.status.textContent = this.error;
      this.status.hidden = !this.error;
    });
  }

  append(...fields: HTMLElement[]): void {
    this.fields.append(...fields);
  }
  setSubmitLabel(label: string): void {
    this.label = label;
  }

  open(focus: HTMLElement): void {
    if (this.disposed || this.busy) return;
    this.error = '';
    this.dialog.open(focus);
  }

  dispose(): void {
    this.disposed = true;
    this.stopRendering();
    this.dialog.dispose();
  }

  private async export(): Promise<void> {
    if (this.disposed || this.busy || !this.form.reportValidity()) return;
    this.busy = true;
    this.error = '';
    try {
      const {blob, fileName} = await this.options.export();
      if (this.disposed) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url));
      this.dialog.close();
    } catch (error) {
      if (!this.disposed)
        runInAction(() => {
          this.error = error instanceof Error ? error.message : String(error);
        });
    } finally {
      if (!this.disposed)
        runInAction(() => {
          this.busy = false;
        });
    }
  }
}

export function exportFileName(value: string, extension: string): string {
  const stem = value
    .trim()
    .replace(/\.(?:[cm]?[jt]sx?|png|step|stp|stl|3mf)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  return `${stem || 'code3d-model'}.${extension}`;
}

export function exportField(
  label: string,
  input: HTMLElement,
): HTMLLabelElement {
  const field = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = label;
  field.append(caption, input);
  return field;
}
