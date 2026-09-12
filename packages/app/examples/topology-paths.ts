import {loft, rectangle} from '@code3d/core';

const base = rectangle(28, 20);
const top = rectangle(18, 12).originOffset(0, -32, 0);
const body = loft([base, top]).material('#d8ff3e');

// Input 1 and input 2 each contribute their own surface 1.
export const inlet = body.surface([1, 1]);
export const outlet = body.surface([2, 1]);
export const inletEdges = inlet.edges();
// New side surfaces have local numeric IDs.
export const side = body.surface(1);

export default body;
