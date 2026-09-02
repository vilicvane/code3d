import {sampleSource} from '../model/sample';
import type {ModelProject} from './project';

export const defaultProject: ModelProject = Object.freeze({
  entryPath: '/model.ts',
  files: Object.freeze([{path: '/model.ts', source: sampleSource}]),
});

export function projectWithLegacySource(source: string | null): ModelProject {
  if (source === null) {
    return defaultProject;
  }
  return {
    entryPath: defaultProject.entryPath,
    files: [{path: defaultProject.entryPath, source}],
  };
}
