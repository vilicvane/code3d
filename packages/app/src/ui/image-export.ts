export type ImageExportDialogOptions = Readonly<{
  capture: (width: number, height: number) => Promise<Blob>;
  fileName: () => string;
}>;

const defaultLongEdge = 1920;
const minimumEdge = 64;
const maximumEdge = 8192;

export class ImageExportDialog {
  private readonly dialog = document.createElement('dialog');
  private readonly form = document.createElement('form');
  private readonly widthInput = resolutionInput('Width');
  private readonly heightInput = resolutionInput('Height');
  private readonly submit = document.createElement('button');
  private readonly cancel = document.createElement('button');
  private readonly status = document.createElement('div');

  constructor(
    private readonly host: HTMLElement,
    private readonly options: ImageExportDialogOptions,
  ) {
    this.dialog.className = 'viewport-export-dialog';
    this.dialog.setAttribute('aria-label', 'Export image');

    const heading = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'Export image';
    const description = document.createElement('p');
    description.textContent = 'PNG image of the current viewport.';
    heading.append(title, description);

    const dimensions = document.createElement('div');
    dimensions.className = 'viewport-export-dimensions';
    const separator = document.createElement('span');
    separator.textContent = '×';
    dimensions.append(this.widthInput.label, separator, this.heightInput.label);

    this.status.className = 'viewport-export-status';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');

    this.submit.type = 'submit';
    this.submit.className = 'viewport-export-submit';
    this.submit.textContent = 'Export PNG';
    this.cancel.type = 'button';
    this.cancel.className = 'viewport-export-cancel';
    this.cancel.textContent = 'Cancel';
    const actions = document.createElement('footer');
    actions.append(this.cancel, this.submit);
    this.form.append(heading, dimensions, this.status, actions);
    this.dialog.append(this.form);
    this.host.append(this.dialog);

    this.cancel.addEventListener('click', () => this.dialog.close());
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      void this.export();
    });
    this.dialog.addEventListener('cancel', event => {
      if (this.submit.disabled) event.preventDefault();
    });
    this.dialog.addEventListener('keydown', event => {
      event.stopPropagation();
    });
  }

  open(): void {
    if (!this.widthInput.input.value) this.setDefaultResolution();
    this.status.hidden = true;
    this.dialog.showModal();
    this.widthInput.input.focus();
    this.widthInput.input.select();
  }

  private setDefaultResolution(): void {
    const {width, height} = this.host.getBoundingClientRect();
    const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
    const landscape = aspect >= 1;
    this.widthInput.input.value = String(
      landscape ? defaultLongEdge : Math.round(defaultLongEdge * aspect),
    );
    this.heightInput.input.value = String(
      landscape ? Math.round(defaultLongEdge / aspect) : defaultLongEdge,
    );
  }

  private async export(): Promise<void> {
    if (this.submit.disabled || !this.form.reportValidity()) return;
    const width = this.widthInput.input.valueAsNumber;
    const height = this.heightInput.input.valueAsNumber;

    this.submit.disabled = true;
    this.cancel.disabled = true;
    this.widthInput.input.disabled = true;
    this.heightInput.input.disabled = true;
    this.form.setAttribute('aria-busy', 'true');
    this.submit.textContent = 'Rendering…';
    this.status.hidden = true;
    try {
      const image = await this.options.capture(width, height);
      download(image, normalizedPngName(this.options.fileName()));
      this.dialog.close();
    } catch (error) {
      this.status.textContent =
        error instanceof Error ? error.message : String(error);
      this.status.hidden = false;
    } finally {
      this.submit.disabled = false;
      this.cancel.disabled = false;
      this.widthInput.input.disabled = false;
      this.heightInput.input.disabled = false;
      this.form.removeAttribute('aria-busy');
      this.submit.textContent = 'Export PNG';
    }
  }
}

function resolutionInput(name: string): Readonly<{
  label: HTMLLabelElement;
  input: HTMLInputElement;
}> {
  const label = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = `${name.toUpperCase()} (PX)`;
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = String(minimumEdge);
  input.max = String(maximumEdge);
  input.step = '1';
  input.required = true;
  input.setAttribute('aria-label', `${name} in pixels`);
  label.append(caption, input);
  return {label, input};
}

function normalizedPngName(value: string): string {
  const stem = value.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-');
  return `${stem || 'code3d-model'}.png`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}
