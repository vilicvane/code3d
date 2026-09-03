import {normalizeProjectPath} from './project';

const fileRoutePrefix = '#/file/';

export function filePathFromRoute(hash: string): string | undefined {
  if (!hash.startsWith(fileRoutePrefix)) return undefined;
  const encodedPath = hash.slice(fileRoutePrefix.length);
  if (!encodedPath) return undefined;
  try {
    return normalizeProjectPath(
      `/${encodedPath.split('/').map(decodeURIComponent).join('/')}`,
    );
  } catch {
    return undefined;
  }
}

export function fileRoute(path: string): string {
  const encodedPath = normalizeProjectPath(path)
    .slice(1)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${fileRoutePrefix}${encodedPath}`;
}
