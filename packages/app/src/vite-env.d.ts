/// <reference types="vite/client" />

/** Current development CLI command, or the installed executable in builds. */
declare const __CODE3D_CLI_COMMAND__: string;

declare module 'virtual:code3d-browser-packages' {
  export const files: Readonly<Record<string, {version: string; url: string}>>;
}
