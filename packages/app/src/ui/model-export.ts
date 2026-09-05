import type {
  ModelExportFormat,
  ModelExportOptions,
} from '../model/model-export';
import {ExportDialog, exportField, exportFileName} from './export-dialog';

export type ModelExportSession = Readonly<{
  fileName: string;
  export(options: ModelExportOptions): Promise<Blob>;
}>;

export class ModelExportDialog {
  private readonly dialog: ExportDialog;
  private readonly format = selectInput('Format', [
    ['step', 'STEP'],
    ['stl', 'STL'],
    ['3mf', '3MF'],
  ]);
  private readonly fileName = document.createElement('input');
  private readonly scale = numberInput('Millimeters per model unit', '1');
  private readonly upAxis = selectInput('Up axis', [
    ['y', 'Y — as modeled'],
    ['z', 'Z — for printing'],
  ]);
  private readonly tolerance = numberInput(
    'Linear tolerance in millimeters',
    '0.1',
  );
  private readonly angle = numberInput('Angular tolerance in degrees', '10');
  private readonly encoding = selectInput('STL encoding', [
    ['binary', 'Binary'],
    ['ascii', 'ASCII'],
  ]);
  private readonly meshFields = document.createElement('fieldset');
  private readonly encodingField = exportField('ENCODING', this.encoding);
  private session?: ModelExportSession;

  constructor(
    host: HTMLElement,
    private readonly createSession: () => ModelExportSession,
  ) {
    this.dialog = new ExportDialog(host, {
      title: 'Export model',
      description: '',
      busyLabel: 'Exporting…',
      export: async () => {
        const options: ModelExportOptions = {
          format: this.format.value as ModelExportFormat,
          scale: this.scale.valueAsNumber,
          upAxis: this.upAxis.value as 'y' | 'z',
          tolerance: this.tolerance.valueAsNumber,
          angularTolerance: (this.angle.valueAsNumber * Math.PI) / 180,
          binary: this.encoding.value === 'binary',
        };
        return {
          blob: await this.session!.export(options),
          fileName: exportFileName(this.fileName.value, options.format),
        };
      },
    });
    this.fileName.required = true;
    this.fileName.setAttribute('aria-label', 'File name');
    this.angle.max = '90';
    this.meshFields.append(
      exportField('LINEAR TOLERANCE (MM)', this.tolerance),
      exportField('ANGULAR TOLERANCE (DEG)', this.angle),
      this.encodingField,
    );
    this.dialog.append(
      exportField('FORMAT', this.format),
      exportField('FILE NAME', this.fileName),
      exportField('MILLIMETERS PER MODEL UNIT', this.scale),
      exportField('UP AXIS', this.upAxis),
      this.meshFields,
    );
    this.format.value = 'step';
    this.format.addEventListener('change', () => {
      this.upAxis.value = this.format.value === 'step' ? 'y' : 'z';
      this.updateFormat();
    });
  }

  open(): void {
    this.session = this.createSession();
    this.fileName.value = this.session.fileName;
    this.updateFormat();
    this.dialog.open(this.fileName);
  }

  private updateFormat(): void {
    const format = this.format.value as ModelExportFormat;
    this.fileName.value = exportFileName(this.fileName.value, format);
    this.meshFields.hidden = this.meshFields.disabled = format === 'step';
    this.encodingField.hidden = this.encoding.disabled = format !== 'stl';
    this.dialog.description.textContent =
      format === 'step'
        ? 'CAD geometry with part names and colors. Output units: millimeters.'
        : format === 'stl'
          ? 'Triangle mesh without colors. STL has no units; coordinates are exported in millimeters.'
          : 'Triangle meshes with part names, colors and relative placement. Output units: millimeters.';
    this.dialog.setSubmitLabel(`Export ${format.toUpperCase()}`);
  }
}

function numberInput(label: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0.000001';
  input.step = 'any';
  input.required = true;
  input.value = value;
  input.setAttribute('aria-label', label);
  return input;
}

function selectInput(
  label: string,
  values: readonly (readonly [string, string])[],
): HTMLSelectElement {
  const input = document.createElement('select');
  input.setAttribute('aria-label', label);
  for (const [value, text] of values) input.add(new Option(text, value));
  return input;
}
