import {box} from '@code3d/core';

// Positive thickness keeps the outside dimensions. S4 is the box's +Y face.
// Place the cursor inside shell(...) to adjust thickness and pick openings.
const enclosure = box(40, 24, 30).shell(1.5, [4]);

export default enclosure.paint('#d8ff3e');
