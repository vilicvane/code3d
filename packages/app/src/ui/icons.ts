import {createElement, type IconNode} from 'lucide';

export function createIcon(node: IconNode, className = ''): SVGElement {
  return createElement(node, {
    class: `ui-icon ${className}`.trim(),
    width: 16,
    height: 16,
    'stroke-width': 1.75,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}
