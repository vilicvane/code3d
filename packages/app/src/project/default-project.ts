import type {ModelProject} from './project';

const workspaceSource = `export * from './examples/index.ts';
export {fastenerExample as default} from './examples/fasteners.ts';
`;

export const defaultProject = {
  files: [{path: '/model.ts', source: workspaceSource}],
} satisfies ModelProject;
