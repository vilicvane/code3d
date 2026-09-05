import type {
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
} from '@code3d/core/tooling';
import {
  Maximize,
  Magnet,
  Minus,
  MousePointer2,
  Trash2,
  type IconNode,
} from 'lucide';
import type {SketchChange} from '../tools/sketch-source';
import {SketchLineDrawing} from '../tools/sketch-drawing';
import {
  endpointPosition,
  sameSketchPoint as same,
  sketchDistance as distance,
  sketchGridStep,
  snapSketchPointer,
  type SketchPoint as Point,
} from '../tools/sketch-snap';
import {DrawingInputs} from './drawing-inputs';
import {createIcon} from './icon';

export type SketchEditorView = Readonly<{
  id: string;
  layers: readonly SketchSnapshot[];
  movable: ReadonlySet<number>;
  referenceable: ReadonlySet<string>;
  readOnlyReason?: string;
}>;

type Gesture =
  | {
      kind: 'move';
      point: Point;
      start: SketchPosition;
      position: SketchPosition;
    }
  | {kind: 'pan'; start: SketchPosition; center: SketchPosition};

/** Pure 2D interaction: source parsing, runtime tracing and transactions live outside this view. */
export class SketchEditor {
  readonly root = document.createElement('section');
  private readonly svg = svgElement('svg');
  private readonly status = document.createElement('output');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly overlay = svgElement('g');
  private readonly draftLine = svgElement('line');
  private readonly draftMarker = svgElement('circle');
  private readonly snapLabel = svgElement('text');
  private readonly snapText = document.createTextNode('');
  private readonly drawingInputs = new DrawingInputs(
    () => this.drawDraft(),
    () => this.place(),
    () => this.escape(),
  );
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private view?: SketchEditorView;
  private drawing?: SketchLineDrawing;
  private snapping = true;
  private bypassSnap = false;
  private center: SketchPosition = [0, 0];
  private scale = 6;
  private selection?: SketchPointAddress;
  private gesture?: Gesture;
  private space = false;

  private get mode() {
    return this.drawing ? 'Line' : 'Select';
  }

  constructor(
    container: HTMLElement,
    private readonly commit: (change: SketchChange) => boolean,
  ) {
    this.root.className = 'sketch-editor';
    this.root.setAttribute('aria-label', 'Sketch editor');
    this.root.hidden = true;
    const toolbar = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'Sketch';
    toolbar.append(title);
    for (const [mode, icon] of [
      ['Select', MousePointer2],
      ['Line', Minus],
    ] as const)
      this.button(toolbar, mode, icon, () => {
        this.cancel();
        this.drawing = mode === 'Select' ? undefined : new SketchLineDrawing();
        this.svg.focus();
        this.draw();
      });
    this.button(toolbar, 'Delete', Trash2, () => this.deleteSelection());
    this.button(toolbar, 'Fit', Maximize, () => this.fit());
    this.button(toolbar, 'Snap', Magnet, () => {
      this.snapping = !this.snapping;
      this.svg.focus();
      this.draw();
    });
    this.buttons.get('Snap')!.title =
      'Snap to points, origin, grid and directions · Hold Alt to bypass';
    this.svg.classList.add('sketch-canvas');
    this.svg.setAttribute('tabindex', '0');
    this.svg.setAttribute('aria-label', 'Sketch drawing');
    this.svg.addEventListener('pointerdown', event => this.pointerDown(event));
    this.svg.addEventListener('pointermove', event => this.pointerMove(event));
    this.svg.addEventListener('pointerup', event => this.pointerUp(event));
    this.svg.addEventListener('pointercancel', () => this.cancel());
    this.svg.addEventListener('lostpointercapture', () => {
      if (this.gesture) this.cancel();
    });
    this.svg.addEventListener(
      'wheel',
      event => {
        event.preventDefault();
        const before = this.coordinates(event);
        this.scale = Math.min(
          1000,
          Math.max(0.05, this.scale * Math.exp(-event.deltaY * 0.001)),
        );
        const after = this.coordinates(event);
        this.center = [
          this.center[0] + before[0] - after[0],
          this.center[1] + before[1] - after[1],
        ];
        this.draw();
      },
      {passive: false},
    );
    this.root.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      this.escape();
    });
    this.root.addEventListener('pointerdown', event => event.stopPropagation());
    this.root.addEventListener('keydown', event => this.keyDown(event));
    this.root.addEventListener('keyup', event => {
      if (event.code === 'Space') this.space = false;
      if (event.key === 'Alt') {
        this.bypassSnap = false;
        this.drawDraft();
      }
    });
    this.root.addEventListener('focusout', event => {
      if (
        event.relatedTarget instanceof Node &&
        this.root.contains(event.relatedTarget)
      )
        return;
      this.space = false;
      this.bypassSnap = false;
      this.cancel();
    });
    window.addEventListener(
      'blur',
      () => {
        this.space = false;
        this.bypassSnap = false;
        this.cancel();
      },
      {signal: this.abort.signal},
    );
    const stage = document.createElement('div');
    stage.className = 'sketch-stage';
    stage.append(this.svg, this.drawingInputs.root);
    this.overlay.classList.add('drawing-overlay');
    this.snapLabel.append(this.snapText);
    this.overlay.append(this.draftLine, this.draftMarker, this.snapLabel);
    this.root.append(toolbar, stage, this.status);
    container.append(this.root);
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(this.svg);
  }

  show(view: SketchEditorView): void {
    const changed = this.view?.id !== view.id;
    if (changed) {
      this.cancel();
      this.selection = undefined;
      this.drawing = undefined;
    }
    this.view = view;
    if (view.readOnlyReason) this.drawing = undefined;
    const start = this.drawing?.start;
    if (start && 'point' in start) {
      const point = this.points().find(point => same(point, start.point));
      if (point) this.drawing!.start = {point};
      else this.drawing!.reset();
    }
    this.root.hidden = false;
    if (changed) this.fit();
    else this.draw();
  }

  hide(): void {
    this.cancel();
    this.view = undefined;
    this.root.hidden = true;
  }
  dispose(): void {
    this.abort.abort();
    this.resize.disconnect();
    this.root.remove();
  }
  cancel(): void {
    if (this.drawingInputs.root.contains(document.activeElement))
      this.svg.focus();
    this.gesture = undefined;
    this.drawing?.reset();
    this.draw();
  }

  private escape(): void {
    const hasDraft = this.gesture || this.drawing?.hasDraft;
    this.svg.focus();
    if (!hasDraft) this.drawing = undefined;
    this.cancel();
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.escape();
      return;
    }
    if (event.key === 'Alt') {
      this.bypassSnap = true;
      this.drawDraft();
    }
    const canvas = event.target === this.svg;
    const input =
      event.target instanceof HTMLInputElement &&
      this.drawingInputs.root.contains(event.target);
    if (this.drawing && (canvas || input)) {
      const axis = event.key.toLowerCase();
      if (
        this.drawing.start &&
        !event.altKey &&
        (axis === 'x' || axis === 'y')
      ) {
        event.preventDefault();
        if (!event.repeat) {
          this.drawing.toggleAxis(axis);
          this.drawingInputs.clearError();
          this.drawDraft();
        }
      } else if (event.key === 'Tab') {
        event.preventDefault();
        this.drawingInputs.focusField(event.shiftKey);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.place();
      } else if (canvas && !event.altKey && /^[\d.+-]$/.test(event.key)) {
        // Move focus before the native character insertion. Do not synthesize
        // input or assign the first character: it must participate in undo/IME.
        this.drawingInputs.focusField();
      }
    }
    if (
      canvas &&
      !this.drawing &&
      (event.key === 'Delete' || event.key === 'Backspace')
    ) {
      event.preventDefault();
      this.deleteSelection();
    }
    if (canvas && event.code === 'Space') {
      event.preventDefault();
      this.space = true;
    }
  }

  private snapContext() {
    return {
      points: this.points().reverse(),
      scale: this.scale,
      gridStep: sketchGridStep(this.scale),
      enabled: this.snapping && !this.bypassSnap,
    };
  }

  private place(): void {
    const drawing = this.drawing;
    if (!drawing || !this.view || this.view.readOnlyReason) return;
    this.svg.focus();
    const {endpoint} = drawing.resolve(this.snapContext());
    if (
      'point' in endpoint &&
      endpoint.point.layer !== this.view.id &&
      !this.view.referenceable.has(endpoint.point.layer)
    ) {
      this.drawingInputs.report(
        'This upstream point has no accessible named sketch',
      );
      return;
    }
    const error = drawing.place(
      endpoint,
      this.view.id,
      this.nextId(),
      this.commit,
    );
    this.draw();
    if (error) this.drawingInputs.report(error);
  }

  private button(
    toolbar: HTMLElement,
    label: string,
    icon: IconNode,
    action: () => void,
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.append(createIcon(icon), label);
    button.addEventListener('click', action);
    this.buttons.set(label, button);
    toolbar.append(button);
  }

  private points(): Point[] {
    return (
      this.view?.layers.flatMap(layer =>
        layer.entities.flatMap(entity =>
          entity.kind === 'point'
            ? [
                {
                  layer: layer.id,
                  id: entity.id,
                  position:
                    this.gesture?.kind === 'move' &&
                    same(this.gesture.point, {layer: layer.id, id: entity.id})
                      ? this.gesture.position
                      : entity.position,
                },
              ]
            : [],
        ),
      ) ?? []
    );
  }

  private screen(position: SketchPosition): SketchPosition {
    return [
      (position[0] - this.center[0]) * this.scale + this.svg.clientWidth / 2,
      (this.center[1] - position[1]) * this.scale + this.svg.clientHeight / 2,
    ];
  }

  private coordinates(event: MouseEvent): SketchPosition {
    const rect = this.svg.getBoundingClientRect();
    return [
      this.center[0] +
        (event.clientX - rect.left - rect.width / 2) / this.scale,
      this.center[1] -
        (event.clientY - rect.top - rect.height / 2) / this.scale,
    ];
  }

  private pick(position: SketchPosition): Point | undefined {
    return this.points()
      .reverse()
      .filter(point => distance(point.position, position) * this.scale < 9)
      .sort(
        (a, b) =>
          distance(a.position, position) - distance(b.position, position),
      )[0];
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.view || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    this.svg.focus();
    const position = this.coordinates(event);
    this.bypassSnap = event.altKey;
    if (event.button === 1 || this.space) {
      this.gesture = {
        kind: 'pan',
        start: [event.clientX, event.clientY],
        center: this.center,
      };
      this.svg.setPointerCapture(event.pointerId);
      return;
    }
    if (this.mode !== 'Select' && this.view.readOnlyReason) return;
    const point = this.pick(position);
    if (this.drawing) {
      this.drawing.pointer = position;
      this.place();
    } else {
      this.selection = point;
      if (!point) {
        const points = this.points();
        for (const layer of [...this.view.layers].reverse()) {
          const line = layer.entities.find(entity => {
            if (entity.kind !== 'line') return false;
            const [a, b] = entity.points.map(ref =>
              points.find(p => same(p, ref))!,
            );
            return (
              segmentDistance(position, a.position, b.position) * this.scale < 6
            );
          });
          if (line) {
            this.selection = {layer: layer.id, id: line.id};
            break;
          }
        }
      } else if (
        !this.view.readOnlyReason &&
        point.layer === this.view.id &&
        this.view.movable.has(point.id)
      ) {
        this.gesture = {
          kind: 'move',
          point,
          start: position,
          position: point.position,
        };
        this.svg.setPointerCapture(event.pointerId);
      }
    }
    this.draw();
  }

  private pointerMove(event: PointerEvent): void {
    this.bypassSnap = event.altKey;
    if (this.gesture?.kind === 'pan') {
      this.center = [
        this.gesture.center[0] -
          (event.clientX - this.gesture.start[0]) / this.scale,
        this.gesture.center[1] +
          (event.clientY - this.gesture.start[1]) / this.scale,
      ];
    } else {
      const pointer = this.coordinates(event);
      if (this.drawing) this.drawing.pointer = pointer;
      const gesture = this.gesture;
      if (gesture?.kind === 'move')
        gesture.position = endpointPosition(
          snapSketchPointer(
            [
              gesture.point.position[0] + pointer[0] - gesture.start[0],
              gesture.point.position[1] + pointer[1] - gesture.start[1],
            ],
            {kind: 'cartesian'},
            {
              ...this.snapContext(),
              points: this.points().filter(
                point => !same(point, gesture.point),
              ),
            },
          ).endpoint,
        );
    }
    if (this.gesture) this.draw();
    else this.drawDraft();
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    this.gesture = undefined;
    if (this.svg.hasPointerCapture(event.pointerId))
      this.svg.releasePointerCapture(event.pointerId);
    if (
      gesture?.kind === 'move' &&
      distance(gesture.position, gesture.point.position) > 0
    )
      this.commit({
        kind: 'move',
        id: gesture.point.id,
        position: gesture.position,
      });
    this.draw();
  }

  private nextId(): number {
    return (
      Math.max(0, ...this.view!.layers.at(-1)!.entities.map(e => e.id)) + 1
    );
  }

  private deleteSelection(): void {
    if (
      !this.view ||
      this.view.readOnlyReason ||
      this.selection?.layer !== this.view.id
    )
      return;
    const id = this.selection.id;
    const ids = [
      id,
      ...this.view.layers
        .at(-1)!
        .entities.flatMap(entity =>
          entity.kind === 'line' &&
          entity.points.some(p => p.layer === this.view!.id && p.id === id)
            ? [entity.id]
            : [],
        ),
    ];
    this.cancel();
    if (this.commit({kind: 'delete', ids: [...new Set(ids)]}))
      this.selection = undefined;
    this.draw();
  }

  private fit(): void {
    const points = this.points();
    if (points.length) {
      const xs = points.map(p => p.position[0]),
        ys = points.map(p => p.position[1]);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys);
      this.center = [(minX + maxX) / 2, (minY + maxY) / 2];
      this.scale = Math.max(
        0.05,
        Math.min(
          20,
          (this.svg.clientWidth - 100) / Math.max(1, maxX - minX),
          (this.svg.clientHeight - 100) / Math.max(1, maxY - minY),
        ),
      );
    } else {
      this.center = [0, 0];
      this.scale = 6;
    }
    this.draw();
  }

  private draw(): void {
    if (!this.view || this.root.hidden) return;
    this.svg.replaceChildren();
    const width = this.svg.clientWidth,
      height = this.svg.clientHeight;
    const step = sketchGridStep(this.scale);
    const [originX, originY] = this.screen([0, 0]);
    const spacing = step * this.scale;
    for (
      let i = Math.ceil(-originX / spacing);
      originX + i * spacing < width;
      i++
    ) {
      const x = originX + i * spacing;
      this.line([x, 0], [x, height], i % 5 === 0 ? 'grid major' : 'grid');
    }
    for (
      let i = Math.ceil(-originY / spacing);
      originY + i * spacing < height;
      i++
    ) {
      const y = originY + i * spacing;
      this.line([0, y], [width, y], i % 5 === 0 ? 'grid major' : 'grid');
    }
    this.line([originX, 0], [originX, height], 'axis');
    this.line([0, originY], [width, originY], 'axis');
    const points = this.points();
    for (const layer of this.view.layers) {
      for (const entity of layer.entities) {
        if (entity.kind !== 'line') continue;
        const positions = entity.points.map(ref =>
          this.screen(points.find(p => same(p, ref))!.position),
        );
        const element = this.line(
          positions[0],
          positions[1],
          this.entityClass(layer.id, entity.id),
        );
        this.tag(element, layer.id, entity.id, 'line');
      }
    }
    for (const point of points) {
      const circle = svgElement('circle');
      const [x, y] = this.screen(point.position);
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', '4');
      circle.setAttribute('class', this.entityClass(point.layer, point.id));
      this.tag(circle, point.layer, point.id, 'point');
      const title = svgElement('title');
      title.textContent = `Point ${point.id} (${point.position.join(', ')})${point.layer !== this.view.id ? ' · upstream (locked)' : !this.view.movable.has(point.id) ? ' · expression-driven (edit in code)' : ''}`;
      circle.append(title);
      this.svg.append(circle);
    }
    this.svg.append(this.overlay);
    this.drawDraft();
    for (const [name, button] of this.buttons) {
      if (name === 'Select' || name === 'Line')
        button.setAttribute('aria-pressed', String(name === this.mode));
      if (name === 'Snap')
        button.setAttribute('aria-pressed', String(this.snapping));
      button.disabled =
        name === 'Delete'
          ? !!this.view.readOnlyReason || this.selection?.layer !== this.view.id
          : name === 'Line' && !!this.view.readOnlyReason;
    }
    const selected = this.selection;
    this.status.textContent =
      this.view.readOnlyReason ??
      (selected?.layer && selected.layer !== this.view.id
        ? 'Upstream geometry · locked'
        : selected &&
            points.some(p => same(p, selected)) &&
            !this.view.movable.has(selected.id)
          ? 'Expression-driven point · edit coordinates in code'
          : this.mode === 'Line'
            ? this.drawing?.start
              ? 'Next point · Enter length/angle or click · X/Y locks direction · Esc ends the chain'
              : 'Start point · Enter X/Y or click'
            : 'Drag points · Delete removes connected local lines · Wheel to zoom · Space-drag to pan');
  }

  private entityClass(layer: string, id: number): string {
    return `entity ${layer === this.view!.id ? 'local' : 'upstream'}${same(this.selection, {layer, id}) ? ' selected' : ''}`;
  }
  private drawDraft(): void {
    if (!this.drawing || !this.view || this.root.hidden) {
      this.overlay.style.display = 'none';
      this.draftLine.classList.remove('draft');
      this.snapLabel.classList.remove('snap-label');
      this.drawingInputs.hide();
      return;
    }
    const {endpoint, hint} = this.drawing.resolve(this.snapContext());
    const position = endpointPosition(endpoint);
    const lock = this.drawing.axis
      ? `${this.drawing.axis.toUpperCase()} locked`
      : undefined;
    this.drawingInputs.show(
      this.drawing.start ? (lock ?? 'Next point') : 'Start point',
      this.drawing.dimensions,
      this.drawing.measurements(position),
    );
    this.overlay.style.display = position.every(Number.isFinite) ? '' : 'none';
    this.draftLine.style.display = this.drawing.start ? '' : 'none';
    this.draftLine.classList.toggle('draft', !!this.drawing.start);
    const [x, y] = this.screen(position);
    if (this.drawing.start) {
      const [startX, startY] = this.screen(
        endpointPosition(this.drawing.start),
      );
      this.draftLine.setAttribute('x1', String(startX));
      this.draftLine.setAttribute('y1', String(startY));
      this.draftLine.setAttribute('x2', String(x));
      this.draftLine.setAttribute('y2', String(y));
    }
    this.draftMarker.setAttribute('cx', String(x));
    this.draftMarker.setAttribute('cy', String(y));
    this.draftMarker.setAttribute('r', hint ? '7' : '4');
    this.draftMarker.setAttribute(
      'class',
      hint ? 'snap-marker' : 'draft-marker',
    );
    this.snapLabel.style.display = hint || lock ? '' : 'none';
    this.snapLabel.classList.toggle('snap-label', !!hint || !!lock);
    if (hint || lock) {
      this.snapLabel.setAttribute('x', String(x + 12));
      this.snapLabel.setAttribute('y', String(y - 12));
      const snap =
        'point' in endpoint
          ? `Point ${endpoint.point.id}${endpoint.point.layer !== this.view.id ? ' · upstream' : ''}`
          : hint;
      const text = [lock, snap].filter(Boolean).join(' · ');
      // Updating the existing text node preserves native input undo grouping;
      // replacing a connected text node during input ends Chrome's typing group.
      if (this.snapText.data !== text) this.snapText.data = text;
    }
  }
  private tag(
    element: SVGElement,
    layer: string,
    id: number,
    kind: string,
  ): void {
    element.dataset.layer = layer;
    element.dataset.id = String(id);
    element.dataset.kind = kind;
  }
  private line(
    a: SketchPosition,
    b: SketchPosition,
    className: string,
  ): SVGLineElement {
    const line = svgElement('line');
    line.setAttribute('x1', String(a[0]));
    line.setAttribute('y1', String(a[1]));
    line.setAttribute('x2', String(b[0]));
    line.setAttribute('y2', String(b[1]));
    line.setAttribute('class', className);
    this.svg.append(line);
    return line;
  }
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', name);
}
function segmentDistance(
  p: SketchPosition,
  a: SketchPosition,
  b: SketchPosition,
): number {
  const length2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  const t = length2
    ? Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) /
            length2,
        ),
      )
    : 0;
  return distance(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}
