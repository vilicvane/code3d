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

export function projectWithLegacySource(source: string | null): ModelProject {
  if (source === null) {
    return defaultProject;
  }
  return {
    entryPath: defaultProject.entryPath,
    files: [
      {path: defaultProject.entryPath, source},
      ...defaultProject.files.filter(
        file => file.path !== defaultProject.entryPath,
      ),
    ],
  };
}

export function withDefaultLibraries(project: ModelProject): ModelProject {
  const paths = new Set(project.files.map(file => file.path));
  const missing = defaultProject.files.filter(
    file => file.path !== defaultProject.entryPath && !paths.has(file.path),
  );
  return missing.length === 0
    ? project
    : {...project, files: [...project.files, ...missing]};
}
