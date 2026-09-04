import coreIndexTypes from '../../../core/bld/library/index.d.ts?raw';
import coreRuntimeTypes from '../../../core/bld/library/runtime.d.ts?raw';
import coreSpatialTypes from '../../../core/bld/library/spatial.d.ts?raw';
import coreTopologyTypes from '../../../core/bld/library/topology.d.ts?raw';
import corePackageMetadata from '../../../core/package.json?raw';
import screwsTypes from '../../../screws/bld/library/index.d.ts?raw';
import iso4762Types from '../../../screws/bld/library/iso-4762.d.ts?raw';
import screwsPackageMetadata from '../../../screws/package.json?raw';

export type InjectedPackage = Readonly<{
  specifier: string;
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
    specifier: '@code3d/screws',
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

export const injectedPackageSpecifiers = injectedPackages.map(
  injectedPackage => injectedPackage.specifier,
);
