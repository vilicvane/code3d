import booleanOperationsSource from '../../examples/boolean-operations.ts?raw';
import combinedConstraintsSource from '../../examples/combined-constraints.ts?raw';
import boundRotationSource from '../../examples/bound-rotation.ts?raw';
import geometricAlignmentSource from '../../examples/geometric-alignment.ts?raw';
import customPrimitivesSource from '../../examples/custom-primitives.ts?raw';
import designArgumentsSource from '../../examples/design-arguments.ts?raw';
import exposedTopologySource from '../../examples/exposed-topology.ts?raw';
import fastenersSource from '../../examples/fasteners.ts?raw';
import examplesIndexSource from '../../examples/index.ts?raw';
import primitivesSource from '../../examples/primitives.ts?raw';
import topologyPathsSource from '../../examples/topology-paths.ts?raw';
import shellSource from '../../examples/shell.ts?raw';
import originAndRotationSource from '../../examples/origin-and-rotation.ts?raw';
import relationsAndElementsSource from '../../examples/relations-and-elements.ts?raw';
import sketchesSource from '../../examples/sketches.ts?raw';
import type {ProjectDirectoryTemplate, ProjectSourceFile} from './project';

const websiteSources = import.meta.glob<string>('../../examples/website/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const files = [
  {path: '/examples/index.ts', source: examplesIndexSource},
  {path: '/examples/primitives.ts', source: primitivesSource},
  {path: '/examples/sketches.ts', source: sketchesSource},
  {path: '/examples/shell.ts', source: shellSource},
  {path: '/examples/bound-rotation.ts', source: boundRotationSource},
  {path: '/examples/geometric-alignment.ts', source: geometricAlignmentSource},
  {path: '/examples/topology-paths.ts', source: topologyPathsSource},
  {path: '/examples/origin-and-rotation.ts', source: originAndRotationSource},
  {path: '/examples/exposed-topology.ts', source: exposedTopologySource},
  {path: '/examples/custom-primitives.ts', source: customPrimitivesSource},
  {
    path: '/examples/combined-constraints.ts',
    source: combinedConstraintsSource,
  },
  {
    path: '/examples/boolean-operations.ts',
    source: booleanOperationsSource,
  },
  {
    path: '/examples/relations-and-elements.ts',
    source: relationsAndElementsSource,
  },
  {path: '/examples/design-arguments.ts', source: designArgumentsSource},
  {path: '/examples/fasteners.ts', source: fastenersSource},
  ...Object.entries(websiteSources).map(([path, source]) => ({
    path: '/examples/website/' + path.split('/').at(-1)!,
    source,
  })),
] satisfies readonly ProjectSourceFile[];

export const bundledExamples = {
  directory: '/examples',
  revision: sourceRevision(files),
  files,
} satisfies ProjectDirectoryTemplate;

function sourceRevision(sourceFiles: readonly ProjectSourceFile[]): string {
  let hash = 0x811c9dc5;
  for (const file of sourceFiles) {
    const content = `${file.path}\0${file.source}\0`;
    for (let index = 0; index < content.length; index += 1) {
      hash = Math.imul(hash ^ content.charCodeAt(index), 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
