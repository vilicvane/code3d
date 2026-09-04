export type ImageExportPanelOptions = Readonly<{
  capture: (width: number, height: number) => Promise<Blob>;
  fileName: () => string;
}>;

const defaultLongEdge = 1920;
const minimumEdge = 64;
const maximumEdge = 8192;

export class ImageExportPanel {
  private readonly button = document.createElement('button');
  private readonly panel = document.createElement('form');
  private readonly widthInput = resolutionInput('Width');
  private readonly heightInput = resolutionInput('Height');
  private readonly submit = document.createElement('button');
  private readonly status = document.createElement('div');

  constructor(
    private readonly host: HTMLElement,
    private readonly options: ImageExportPanelOptions,
  ) {
    this.button.type = 'button';
    this.button.className = 'viewport-export-button';
    this.button.textContent = 'Export';
    this.button.title = 'Export the current viewport as a PNG image';
    this.button.setAttribute('aria-expanded', 'false');

    this.panel.className = 'viewport-export-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Export viewport image');

    const heading = document.createElement('header');
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'PNG IMAGE';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'viewport-export-close';
    close.textContent = '×';
    close.title = 'Close';
    heading.append(eyebrow, close);

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
    this.panel.append(heading, dimensions, this.status, this.submit);
    this.host.append(this.button, this.panel);

    this.setDefaultResolution();
    this.button.addEventListener('click', () => this.toggle());
    close.addEventListener('click', () => this.close());
    this.panel.addEventListener('submit', event => {
      event.preventDefault();
      void this.export();
    });
    document.addEventListener('pointerdown', event => {
      if (
        !this.panel.hidden &&
        event.target instanceof Node &&
        !this.panel.contains(event.target) &&
        !this.button.contains(event.target)
      ) {
        this.close();
      }
    });
  }

  private toggle(): void {
    if (this.panel.hidden) this.open();
    else this.close();
  }

  private open(): void {
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.status.hidden = true;
    this.widthInput.input.focus();
    this.widthInput.input.select();
  }

  private close(): void {
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.button.focus();
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
    if (!this.panel.reportValidity()) return;
    const width = this.widthInput.input.valueAsNumber;
    const height = this.heightInput.input.valueAsNumber;

    this.submit.disabled = true;
    this.submit.textContent = 'Rendering…';
    this.status.hidden = true;
    try {
      const image = await this.options.capture(width, height);
      download(image, normalizedPngName(this.options.fileName()));
      this.close();
    } catch (error) {
      this.status.textContent =
        error instanceof Error ? error.message : String(error);
      this.status.hidden = false;
    } finally {
      this.submit.disabled = false;
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
  caption.textContent = name.toUpperCase();
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
