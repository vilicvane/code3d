import type {
  SketchPointAddress,
  SketchPosition,
  SketchSnapshot,
} from '@code3d/core/tooling';
import type {SketchChange, SketchDraftEntry} from '../tools/sketch-source';

export type SketchEditorView = Readonly<{
  id: string;
  layers: readonly SketchSnapshot[];
  movable: ReadonlySet<number>;
  referenceable: ReadonlySet<string>;
  readOnlyReason?: string;
}>;

type Point = SketchPointAddress & {position: SketchPosition};
type Endpoint = {point: Point} | {position: SketchPosition};
type Mode = 'Select' | 'Point' | 'Line';
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
  private draft?: SVGLineElement;
  private readonly resize: ResizeObserver;
  private view?: SketchEditorView;
  private mode: Mode = 'Select';
  private center: SketchPosition = [0, 0];
  private scale = 6;
  private selection?: SketchPointAddress;
  private gesture?: Gesture;
  private lineStart?: Endpoint;
  private pointer?: SketchPosition;
  private space = false;

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
    for (const mode of ['Select', 'Point', 'Line'] as const)
      this.button(toolbar, mode, () => {
        this.cancel();
        this.mode = mode;
        this.svg.focus();
        this.draw();
      });
    this.button(toolbar, 'Delete', () => this.deleteSelection());
    this.button(toolbar, 'Fit', () => this.fit());
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
      this.cancel();
    });
    this.root.addEventListener('pointerdown', event => event.stopPropagation());
    this.svg.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.deleteSelection();
      }
      if (event.code === 'Space') {
        event.preventDefault();
        this.space = true;
      }
    });
    this.svg.addEventListener('keyup', event => {
      if (event.code === 'Space') this.space = false;
    });
    this.svg.addEventListener('blur', () => {
      this.space = false;
      this.cancel();
    });
    this.root.append(toolbar, this.svg, this.status);
    container.append(this.root);
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(this.svg);
  }

  show(view: SketchEditorView): void {
    const changed = this.view?.id !== view.id;
    if (changed) {
      this.cancel();
      this.selection = undefined;
      this.mode = 'Select';
    }
    this.view = view;
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
    this.resize.disconnect();
    this.root.remove();
  }
  cancel(): void {
    this.gesture = undefined;
    this.lineStart = undefined;
    this.draw();
  }

  private button(
    toolbar: HTMLElement,
    label: string,
    action: () => void,
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
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

  private endpoint(position: SketchPosition): Endpoint | undefined {
    const point = this.pick(position);
    if (!point) return {position: rounded(position)};
    if (
      point.layer !== this.view!.id &&
      !this.view!.referenceable.has(point.layer)
    ) {
      this.status.textContent =
        'This upstream point has no accessible named sketch.';
      return undefined;
    }
    return {point};
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.view || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    this.svg.focus();
    const position = this.coordinates(event);
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
    if (this.mode === 'Point') {
      if (!point)
        this.commit({
          kind: 'append',
          entries: [['point', this.nextId(), rounded(position)]],
        });
    } else if (this.mode === 'Line') {
      const endpoint = this.endpoint(position);
      if (!endpoint) return;
      if (!this.lineStart) {
        this.lineStart = endpoint;
        this.pointer = position;
      } else {
        if (
          'point' in this.lineStart &&
          'point' in endpoint &&
          same(this.lineStart.point, endpoint.point)
        )
          return;
        const entries: SketchDraftEntry[] = [];
        let id = this.nextId();
        const address = (end: Endpoint): SketchPointAddress => {
          if ('point' in end) return end.point;
          const pointId = id++;
          entries.push(['point', pointId, end.position]);
          return {layer: this.view!.id, id: pointId};
        };
        const start = address(this.lineStart),
          end = address(endpoint);
        entries.push(['line', id, [start, end]]);
        this.lineStart = undefined;
        this.commit({kind: 'append', entries});
      }
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
    if (this.gesture?.kind === 'pan') {
      this.center = [
        this.gesture.center[0] -
          (event.clientX - this.gesture.start[0]) / this.scale,
        this.gesture.center[1] +
          (event.clientY - this.gesture.start[1]) / this.scale,
      ];
    } else {
      this.pointer = this.coordinates(event);
      if (this.gesture?.kind === 'move')
        this.gesture.position = rounded([
          this.gesture.point.position[0] +
            this.pointer[0] -
            this.gesture.start[0],
          this.gesture.point.position[1] +
            this.pointer[1] -
            this.gesture.start[1],
        ]);
    }
    if (this.gesture) this.draw();
    else if (this.lineStart) this.drawDraft();
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
    this.draft = undefined;
    const width = this.svg.clientWidth,
      height = this.svg.clientHeight;
    const step = 10 ** Math.ceil(Math.log10(35 / this.scale));
    const [originX, originY] = this.screen([0, 0]);
    for (
      let x = originX % (step * this.scale);
      x < width;
      x += step * this.scale
    )
      this.line([x, 0], [x, height], 'grid');
    for (
      let y = originY % (step * this.scale);
      y < height;
      y += step * this.scale
    )
      this.line([0, y], [width, y], 'grid');
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
    this.drawDraft();
    for (const [name, button] of this.buttons) {
      if (name === 'Select' || name === 'Point' || name === 'Line')
        button.setAttribute('aria-pressed', String(name === this.mode));
      button.disabled =
        name === 'Delete'
          ? !!this.view.readOnlyReason || this.selection?.layer !== this.view.id
          : (name === 'Point' || name === 'Line') && !!this.view.readOnlyReason;
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
            ? this.lineStart
              ? 'Choose the end point · Esc to cancel'
              : 'Choose the start point'
            : this.mode === 'Point'
              ? 'Click to add a point'
              : 'Drag points · Delete removes connected local lines · Wheel to zoom · Space-drag to pan');
  }

  private entityClass(layer: string, id: number): string {
    return `entity ${layer === this.view!.id ? 'local' : 'upstream'}${same(this.selection, {layer, id}) ? ' selected' : ''}`;
  }
  private drawDraft(): void {
    if (!this.lineStart || !this.pointer) return;
    const start =
      'point' in this.lineStart
        ? this.lineStart.point.position
        : this.lineStart.position;
    const end = this.pick(this.pointer)?.position ?? this.pointer;
    this.draft?.remove();
    this.draft = this.line(this.screen(start), this.screen(end), 'draft');
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
function same(
  a: SketchPointAddress | undefined,
  b: SketchPointAddress,
): boolean {
  return a?.layer === b.layer && a.id === b.id;
}
function distance(a: SketchPosition, b: SketchPosition): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
function rounded(position: SketchPosition): SketchPosition {
  return [Number(position[0].toFixed(3)), Number(position[1].toFixed(3))];
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
