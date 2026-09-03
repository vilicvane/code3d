import {metricFastenerLibrarySource} from './metric-fastener-library';
import type {ModelProject} from './project';

const workspaceSource = `export * from './examples';
export {fastenerExample as default} from './examples/fasteners';
`;

export const defaultProject = {
  files: [
    {path: '/model.ts', source: workspaceSource},
    {
      path: '/lib/fasteners/metric.ts',
      source: metricFastenerLibrarySource,
    },
  ],
} satisfies ModelProject;
