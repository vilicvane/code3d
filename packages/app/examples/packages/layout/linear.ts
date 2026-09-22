import {box, group} from '@code3d/core';
import {linear, repeat} from '@code3d/layout';

const posts = linear(repeat(box(8, 20, 8), 5), {axis: 'x', step: 16});
export default group(posts, {name: 'Linear posts'});
