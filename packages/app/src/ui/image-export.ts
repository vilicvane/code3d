import {ExportDialog, exportField, exportFileName} from './export-dialog';

export type ImageExportDialogOptions = Readonly<{
  capture: (width: number, height: number) => Promise<Blob>;
  fileName: () => string;
}>;

const defaultLongEdge = 1920;

export class ImageExportDialog {
  private readonly dialog: ExportDialog;
  private readonly width = resolutionInput('Width');
  private readonly height = resolutionInput('Height');

  constructor(
    private readonly host: HTMLElement,
    options: ImageExportDialogOptions,
  ) {
    this.dialog = new ExportDialog(host, {
      title: 'Export image',
      description: 'PNG image of the current viewport.',
      busyLabel: 'Rendering…',
      export: async () => {
        const fileName = exportFileName(options.fileName(), 'png');
        const blob = await options.capture(
          this.width.valueAsNumber,
          this.height.valueAsNumber,
        );
        return {blob, fileName};
      },
    });
    const dimensions = document.createElement('div');
    dimensions.className = 'viewport-export-dimensions';
    const separator = document.createElement('span');
    separator.textContent = '×';
    dimensions.append(
      exportField('WIDTH (PX)', this.width),
      separator,
      exportField('HEIGHT (PX)', this.height),
    );
    this.dialog.append(dimensions);
    this.dialog.setSubmitLabel('Export PNG');
  }

  open(): void {
    if (!this.width.value) {
      const {width, height} = this.host.getBoundingClientRect();
      const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
      this.width.value = String(
        aspect >= 1 ? defaultLongEdge : Math.round(defaultLongEdge * aspect),
      );
      this.height.value = String(
        aspect >= 1 ? Math.round(defaultLongEdge / aspect) : defaultLongEdge,
      );
    }
    this.dialog.open(this.width);
  }
}

function resolutionInput(name: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = '64';
  input.max = '8192';
  input.step = '1';
  input.required = true;
  input.setAttribute('aria-label', `${name} in pixels`);
  return input;
}
