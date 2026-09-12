import {box, group} from '@code3d/core';
import range from 'just-range';

// Browser storage installs dependencies from this folder's package.json.
// For a local folder, run npm install here, then Reload folder in the App.
// F12 on range opens the installed package's definitions and source.
const posts = range(5).map(index =>
  box(8, 20, 8).originOffset(-index * 16, 0, 0),
);

export default group(posts, 'Using just-range');
