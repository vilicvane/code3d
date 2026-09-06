import type {SketchPosition} from '@code3d/core/tooling';
import {
  LockKeyhole,
  MoveHorizontal,
  MoveVertical,
  CircleDot,
  Triangle,
  Ruler,
  DraftingCompass,
} from 'lucide';
import type {SketchConstraintDisplay} from '../tools/sketch-constraints';
import {createIcon} from './icons';

const icons = {
  fixed: LockKeyhole,
  x: LockKeyhole,
  y: LockKeyhole,
  horizontal: MoveHorizontal,
  vertical: MoveVertical,
  coincident: CircleDot,
  midpoint: Triangle,
  length: Ruler,
  angle: DraftingCompass,
};
const svg = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS('http://www.w3.org/2000/svg', tag);

/** Read-only, screen-sized constraint glyphs; ownership and relations stay in snapshots. */
export class SketchConstraints {
  readonly guides = svg('g');
  readonly labels = svg('g');
  private readonly badges = new Map<
    string,
    {
      root: SVGGElement;
      background: SVGRectElement;
      icon: SVGElement;
      text: SVGTextElement;
      title: SVGTitleElement;
      guides: SVGGElement;
      display: SketchConstraintDisplay;
    }
  >();
  private hovered?: string;
  private focused?: string;

  constructor(private readonly change: () => void) {}

  related(layer: string, id: number): boolean {
    const display = this.badges.get(
      this.hovered ?? this.focused ?? '',
    )?.display;
    return (
      !!display &&
      [...display.points, ...(display.line ? [display.line] : [])].some(
        p => p.layer === layer && p.id === id,
      )
    );
  }

  draw(
    displays: readonly SketchConstraintDisplay[],
    project: (position: SketchPosition) => SketchPosition,
    local: string,
    visible: boolean,
  ): void {
    this.guides.style.display = this.labels.style.display = visible
      ? ''
      : 'none';
    if (!visible) this.hovered = this.focused = undefined;
    const used = new Set(displays.map(d => d.key));
    if (!used.has(this.hovered ?? '')) this.hovered = undefined;
    if (!used.has(this.focused ?? '')) this.focused = undefined;
    for (const [key, badge] of this.badges) {
      if (used.has(key)) continue;
      badge.root.remove();
      badge.guides.remove();
      this.badges.delete(key);
    }
    const occupied: {x: number; y: number; width: number}[] = [];
    for (const display of displays) {
      let badge = this.badges.get(display.key);
      if (!badge) {
        const root = svg('g'),
          background = svg('rect'),
          text = svg('text'),
          title = svg('title');
        const icon = createIcon(icons[display.kind]);
        icon.setAttribute('x', '3');
        icon.setAttribute('y', '2');
        background.setAttribute('rx', '3');
        background.setAttribute('height', '20');
        text.setAttribute('x', '23');
        text.setAttribute('y', '14');
        root.setAttribute('tabindex', '0');
        root.setAttribute('role', 'img');
        root.append(title, background, icon, text);
        root.addEventListener('pointerenter', () => {
          this.hovered = display.key;
          this.change();
        });
        root.addEventListener('pointerleave', () => {
          this.hovered = undefined;
          this.change();
        });
        root.addEventListener('focus', () => {
          this.focused = display.key;
          this.change();
        });
        root.addEventListener('blur', () => {
          this.focused = undefined;
          this.change();
        });
        // Glyph inspection must not start drawing, moving or trimming underneath.
        root.addEventListener('pointerdown', event => {
          event.stopPropagation();
          event.preventDefault();
        });
        root.addEventListener('pointermove', event => event.stopPropagation());
        const guides = svg('g');
        badge = {root, background, icon, text, title, guides, display};
        this.badges.set(display.key, badge);
        this.labels.append(root);
        this.guides.append(guides);
      }
      if (badge.display.kind !== display.kind) {
        const icon = createIcon(icons[display.kind]);
        icon.setAttribute('x', '3');
        icon.setAttribute('y', '2');
        badge.icon.replaceWith(icon);
        badge.icon = icon;
      }
      badge.display = display;
      const active = display.key === (this.hovered ?? this.focused);
      const classes = `${display.layer === local ? 'constraint-local' : 'constraint-upstream'}${active ? ' constraint-active' : ''}`;
      badge.root.setAttribute('class', `constraint-badge ${classes}`);
      badge.guides.setAttribute('class', `constraint-guides ${classes}`);
      badge.root.dataset.kind = display.kind;
      badge.root.dataset.key = display.key;
      badge.guides.dataset.key = display.key;
      const title = `${display.title}${display.layer !== local ? ' · upstream (locked)' : ''}`;
      badge.root.setAttribute('aria-label', title);
      if (badge.title.textContent !== title) badge.title.textContent = title;
      if (badge.text.textContent !== display.label)
        badge.text.textContent = display.label;
      const [anchorX, anchorY] = project(display.anchor);
      const width = display.label ? 28 + display.label.length * 6.5 : 22;
      const x = anchorX + 10;
      let y = anchorY - 28;
      // Deterministic screen-space stacking; no label coordinates enter the model.
      while (
        occupied.some(
          r =>
            x < r.x + r.width + 3 &&
            x + width + 3 > r.x &&
            y < r.y + 23 &&
            y + 23 > r.y,
        )
      )
        y += 23;
      occupied.push({x, y, width});
      badge.root.setAttribute('transform', `translate(${x}, ${y})`);
      badge.background.setAttribute('width', String(width));
      while (badge.guides.children.length > display.guides.length)
        badge.guides.lastChild!.remove();
      display.guides.forEach(([a, b], index) => {
        let line = badge.guides.children[index];
        if (!line) {
          line = svg('line');
          badge.guides.append(line);
        }
        const start = project(a),
          end = project(b);
        line.setAttribute('x1', String(start[0]));
        line.setAttribute('y1', String(start[1]));
        line.setAttribute('x2', String(end[0]));
        line.setAttribute('y2', String(end[1]));
      });
    }
  }
}
