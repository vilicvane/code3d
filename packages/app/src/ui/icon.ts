import {createElement, type IconNode} from 'lucide';

/** Decorative UI glyph; its control owns the visible/accessibility label. */
export function createIcon(node: IconNode): SVGElement {
  return createElement(node, {
    class: 'ui-icon',
    width: 16,
    height: 16,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}
