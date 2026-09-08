import firstModelSource from '../../examples/website/first-model.ts?raw';
import type {ModelProject} from './project';

export const defaultProject = {
  files: [{path: '/model.ts', source: firstModelSource}],
} satisfies ModelProject;
