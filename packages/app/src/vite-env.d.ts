/// <reference types="vite/client" />
declare const __CODE3D_NODE_BUILTINS__: readonly string[];

declare module 'virtual:code3d-browser-packages' {
  export const files: Readonly<Record<string, {version: string; url: string}>>;
}
