import type {ModelProject} from './project';

const workspaceSource = `import {box, cylinder, group} from '@code3d/core';

const base = box(36, 4, 24).fillet(1);
const post = cylinder(4, 14).relate(part =>
  part.on(base.up).offset(-10, 0, 0),
);

group([base, post]);
`;

export const defaultProject = {
  files: [{path: '/model.ts', source: workspaceSource}],
} satisfies ModelProject;
