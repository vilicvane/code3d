import {sampleSource} from '../model/sample';
import {metricFastenerLibrarySource} from './metric-fastener-library';
import type {ModelProject} from './project';

export const defaultProject: ModelProject = Object.freeze({
  entryPath: '/model.ts',
  files: Object.freeze([
    {path: '/model.ts', source: sampleSource},
    {
      path: '/lib/fasteners/metric.ts',
      source: metricFastenerLibrarySource,
    },
  ]),
});
