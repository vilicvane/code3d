import {box, group, tube} from '@code3d/core';

const block = box(20, 30, 10);
const pipe = tube(15, 10, 40).originOffset(-60, 0, 0);

// Select .volume to inspect the solid and the space occupied by its material.
const blockVolume = block.volume; // 6000
const pipeVolume = pipe.volume; // 5000 * Math.PI; the bore is excluded.
const enlargedVolume = block.scaled(2).volume; // 48000

export default group([block, pipe]);
