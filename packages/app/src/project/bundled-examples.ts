import type {ProjectDirectoryTemplate, ProjectSourceFile} from './project';

const sources = import.meta.glob<string>(
  [
    '../../examples/**/*.{ts,js,json}',
    '!../../examples/**/node_modules/**',
    '!../../examples/**/.code3d/**',
  ],
  {query: '?raw', import: 'default', eager: true},
);

const files = Object.entries(sources)
  .map(([path, source]) => ({
    path: path.slice('../..'.length),
    source,
  }))
  .sort((left, right) =>
    left.path.localeCompare(right.path),
  ) satisfies ProjectSourceFile[];

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
