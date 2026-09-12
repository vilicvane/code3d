import type {ModelProject} from './project';

export const defaultProject = {
  files: [
    {
      path: '/model.ts',
      source: `import {phoneStand} from './examples/projects/phone-stand.ts';

// Open phoneStand's definition to edit the design; change these dimensions here.
export default phoneStand(70, 20);
`,
    },
  ],
} satisfies ModelProject;
