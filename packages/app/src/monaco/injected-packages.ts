import coreIndexTypes from '../../../core/bld/library/index.d.ts?raw';
import coreRuntimeTypes from '../../../core/bld/library/runtime.d.ts?raw';
import coreSpatialTypes from '../../../core/bld/library/spatial.d.ts?raw';
import coreTopologyTypes from '../../../core/bld/library/topology.d.ts?raw';
import corePackageMetadata from '../../../core/package.json?raw';
import coreReplicadTypes from '../../../core/bld/library/replicad.d.ts?raw';
import screwsTypes from '../../../screws/bld/library/index.d.ts?raw';
import iso4762Types from '../../../screws/bld/library/iso-4762.d.ts?raw';
import screwsPackageMetadata from '../../../screws/package.json?raw';
import replicadTypes from '../../../../node_modules/replicad/dist/replicad.d.ts?raw';
import replicadPackageMetadata from '../../../../node_modules/replicad/package.json?raw';

export type InjectedPackage = Readonly<{
  specifier: string;
  entryFilePath: string;
  suggestImport?: boolean;
  files: readonly Readonly<{
    filePath: string;
    content: string;
  }>[];
}>;

/**
 * The current browser runtime injects these package files instead of
 * discovering a project dependency graph. Their paths preserve the installed
 * package layout so TypeScript applies package metadata and exports normally.
 */
export const injectedPackages: readonly InjectedPackage[] = [
  {
    specifier: '@code3d/core',
    entryFilePath: 'file:///node_modules/@code3d/core/bld/library/index.d.ts',
    files: [
      {
        filePath: 'file:///node_modules/@code3d/core/package.json',
        content: corePackageMetadata,
      },
      {
        filePath: 'file:///node_modules/@code3d/core/bld/library/index.d.ts',
        content: coreIndexTypes,
      },
      {
        filePath: 'file:///node_modules/@code3d/core/bld/library/runtime.d.ts',
        content: coreRuntimeTypes,
      },
      {
        filePath: 'file:///node_modules/@code3d/core/bld/library/spatial.d.ts',
        content: coreSpatialTypes,
      },
      {
        filePath: 'file:///node_modules/@code3d/core/bld/library/topology.d.ts',
        content: coreTopologyTypes,
      },
    ],
  },
  {
    specifier: '@code3d/core/replicad',
    entryFilePath:
      'file:///node_modules/@code3d/core/bld/library/replicad.d.ts',
    files: [
      {
        filePath: 'file:///node_modules/@code3d/core/bld/library/replicad.d.ts',
        content: coreReplicadTypes,
      },
    ],
  },
  {
    specifier: 'replicad',
    entryFilePath: 'file:///node_modules/replicad/dist/replicad.d.ts',
    suggestImport: false,
    files: [
      {
        filePath: 'file:///node_modules/replicad/package.json',
        content: replicadPackageMetadata,
      },
      {
        filePath: 'file:///node_modules/replicad/dist/replicad.d.ts',
        content: replicadTypes,
      },
    ],
  },
  {
    specifier: '@code3d/screws',
    entryFilePath: 'file:///node_modules/@code3d/screws/bld/library/index.d.ts',
    files: [
      {
        filePath: 'file:///node_modules/@code3d/screws/package.json',
        content: screwsPackageMetadata,
      },
      {
        filePath: 'file:///node_modules/@code3d/screws/bld/library/index.d.ts',
        content: screwsTypes,
      },
      {
        filePath:
          'file:///node_modules/@code3d/screws/bld/library/iso-4762.d.ts',
        content: iso4762Types,
      },
    ],
  },
];

export const injectedPackageFiles = injectedPackages.flatMap(
  injectedPackage => injectedPackage.files,
);

export const injectedPackageSpecifiers = injectedPackages
  .filter(injectedPackage => injectedPackage.suggestImport !== false)
  .map(injectedPackage => injectedPackage.specifier);
