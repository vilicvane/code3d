export class ExportDialog {
  private readonly dialog = document.createElement('dialog');
  private readonly form = document.createElement('form');
  private readonly fields = document.createElement('fieldset');
  private readonly submit = document.createElement('button');
  private readonly cancel = document.createElement('button');
  private readonly status = document.createElement('div');
  readonly description = document.createElement('p');

  constructor(
    host: HTMLElement,
    private readonly options: {
      title: string;
      description: string;
      busyLabel: string;
      export(): Promise<{blob: Blob; fileName: string}>;
    },
  ) {
    this.dialog.className = 'viewport-export-dialog';
    this.dialog.setAttribute('aria-label', options.title);
    const heading = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = options.title;
    this.description.textContent = options.description;
    heading.append(title, this.description);
    this.status.className = 'viewport-export-status';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');
    this.submit.type = 'submit';
    this.submit.className = 'viewport-export-submit';
    this.submit.textContent = 'Export';
    this.cancel.type = 'button';
    this.cancel.className = 'viewport-export-cancel';
    this.cancel.textContent = 'Cancel';
    const actions = document.createElement('footer');
    actions.append(this.cancel, this.submit);
    this.form.append(heading, this.fields, this.status, actions);
    this.dialog.append(this.form);
    host.append(this.dialog);
    this.cancel.addEventListener('click', () => this.dialog.close());
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      void this.export();
    });
    this.dialog.addEventListener('cancel', event => {
      if (this.submit.disabled) event.preventDefault();
    });
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
  }

  append(...fields: HTMLElement[]): void {
    this.fields.append(...fields);
  }
  setSubmitLabel(label: string): void {
    this.submit.textContent = label;
  }

  open(focus: HTMLElement): void {
    this.status.hidden = true;
    this.dialog.showModal();
    focus.focus();
    if (focus instanceof HTMLInputElement) focus.select();
  }

  private async export(): Promise<void> {
    if (this.submit.disabled || !this.form.reportValidity()) return;
    const label = this.submit.textContent;
    this.submit.disabled = this.cancel.disabled = this.fields.disabled = true;
    this.form.setAttribute('aria-busy', 'true');
    this.submit.textContent = this.options.busyLabel;
    this.status.hidden = true;
    try {
      const {blob, fileName} = await this.options.export();
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
      this.status.textContent =
        error instanceof Error ? error.message : String(error);
      this.status.hidden = false;
    } finally {
      this.submit.disabled =
        this.cancel.disabled =
        this.fields.disabled =
          false;
      this.form.removeAttribute('aria-busy');
      this.submit.textContent = label;
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
  if (input instanceof HTMLSelectElement) {
    const select = document.createElement('div');
    select.className = 'viewport-export-select';
    select.append(input);
    field.append(caption, select);
  } else {
    field.append(caption, input);
  }
  return field;
}
