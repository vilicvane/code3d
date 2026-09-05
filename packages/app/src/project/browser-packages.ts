import {files} from 'virtual:code3d-browser-packages';
import type {ProjectFileReader} from './file-reader';
import {normalizeProjectPath, projectDirectory} from './project';

const directories = new Set<string>();
for (const path of Object.keys(files)) {
  for (
    let directory = projectDirectory(path);
    ;
    directory = projectDirectory(directory)
  ) {
    directories.add(directory);
    if (directory === '/') break;
  }
}

/** Read published artifacts on demand, without installing into the user's project. */
export const browserPackageFiles: ProjectFileReader = {
  async readFile(path) {
    const asset = files[normalizeProjectPath(path)];
    if (!asset) return undefined;
    const response = await fetch(asset.url);
    if (!response.ok)
      throw new Error('Unable to load built-in package file: ' + path);
    return new Uint8Array(await response.arrayBuffer());
  },
  async stat(path) {
    path = normalizeProjectPath(path);
    const asset = files[path];
    if (asset) return {kind: 'file', version: asset.version};
    if (directories.has(path)) return {kind: 'directory', version: ''};
    return undefined;
  },
};
