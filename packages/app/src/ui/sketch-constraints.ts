import type {SketchPosition} from '@code3d/core/tooling';
import type {SketchConstraintDisplay} from '../tools/sketch-constraints';
import {createIcon} from './icons';
import {sketchConstraintIcons} from './sketch-icons';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS('http://www.w3.org/2000/svg', tag);

/** Screen-sized constraint selectors; ownership and relations stay in snapshots. */
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

  constructor(
    private readonly change: () => void,
    private readonly select: (display: SketchConstraintDisplay) => void,
  ) {}

  related(layer: string, id: number): boolean {
    const display = this.badges.get(
      this.hovered ?? this.focused ?? '',
    )?.display;
    return (
      !!display &&
      [...display.points, ...display.curves].some(
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
        const icon = createIcon(sketchConstraintIcons[display.tool]);
        icon.setAttribute('x', '3');
        icon.setAttribute('y', '2');
        background.setAttribute('rx', '3');
        background.setAttribute('height', '20');
        text.setAttribute('x', '23');
        text.setAttribute('y', '14');
        root.setAttribute('tabindex', '0');
        root.setAttribute('role', 'button');
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
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
        });
        root.addEventListener('pointermove', event => event.stopPropagation());
        root.addEventListener('click', event => {
          if (event.button !== 0) return;
          event.stopPropagation();
          this.select(this.badges.get(display.key)!.display);
        });
        root.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          this.select(this.badges.get(display.key)!.display);
        });
        const guides = svg('g');
        badge = {root, background, icon, text, title, guides, display};
        this.badges.set(display.key, badge);
        this.labels.append(root);
        this.guides.append(guides);
      }
      if (badge.display.tool !== display.tool) {
        const icon = createIcon(sketchConstraintIcons[display.tool]);
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
      badge.root.dataset.tool = display.tool;
      badge.root.dataset.key = display.key;
      badge.guides.dataset.key = display.key;
      const title = `${display.title}${display.layer !== local ? ' · upstream (locked)' : ''}`;
      badge.root.setAttribute('aria-label', title);
      if (badge.title.textContent !== title) badge.title.textContent = title;
      if (badge.text.textContent !== display.label)
        badge.text.textContent = display.label;
      const [anchorX, anchorY] = project(display.anchor);
      const width = display.label ? 28 + display.label.length * 6.5 : 22;
      const x = anchorX + (display.angle ? 42 : 10);
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
      if (display.angle) {
        const {origin, directions, sweep} = display.angle;
        const [x, y] = project(origin);
        const position = (angle: number, radius: number) => [
          x + Math.cos(angle) * radius,
          y - Math.sin(angle) * radius,
        ];
        const guide = svg('path');
        guide.classList.add('constraint-angle-guide');
        const rays = directions.map(direction => {
          const [a, b] = position(direction, 32);
          const [cx, cy] = position(direction, 27);
          const dx = Math.sin(direction) * 3,
            dy = Math.cos(direction) * 3;
          return `M${x} ${y}L${a} ${b}M${cx - dx} ${cy - dy}L${a} ${b}L${cx + dx} ${cy + dy}`;
        });
        const start = position(directions[0], 22),
          end = position(directions[0] + sweep, 22);
        guide.setAttribute(
          'd',
          `${rays.join(' ')} M${start[0]} ${start[1]}A22 22 0 0 ${sweep >= 0 ? 0 : 1} ${end[0]} ${end[1]}`,
        );
        badge.guides.append(guide);
      }
    }
  }
}
