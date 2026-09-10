import {box, group} from '@code3d/core';
import range from 'just-range';

// Browser storage installs just-range from this folder's package.json.
// Select the postArray call to change its parameters; F12 opens package sources.
/**
 * @code3d.param count {kind: 'count', constraints: {min: 1, max: 9}}
 * @code3d.param spacing {kind: 'length', constraints: {min: 10}}
 * @code3d.param height {kind: 'length', constraints: {min: 4}}
 */
export function postArray(count = 5, spacing = 16, height = 20) {
  const base = box((count - 1) * spacing + 16, 4, 20)
    .originOffset(0, 2, 0)
    .material('#38423d');
  const posts = range(count).map(index =>
    box(8, height, 8)
      .originOffset(((count - 1) / 2 - index) * spacing, -height / 2, 0)
      .material('#d8ff3e'),
  );
  return group([base, ...posts], 'Post array');
}

export default postArray();
