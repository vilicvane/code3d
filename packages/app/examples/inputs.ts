import {box, input} from '@code3d/core';

const width = input('Width', 40, {min: 4, max: 100, step: 1});
const height = input('Height', 16, {min: 2, max: 60, step: 0.5});

export default box(width, height, 24).material('#d3b46c');
