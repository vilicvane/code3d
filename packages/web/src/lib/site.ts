export const githubUrl = 'https://github.com/vilicvane/code3d';
export const tagline =
  'The expressive power of code, with the immediacy of direct manipulation.';

export function sitePath(path: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function appUrl(file?: string): string {
  return (
    sitePath('app/') +
    (file
      ? `#/file/examples/${file.split('/').map(encodeURIComponent).join('/')}`
      : '')
  );
}
