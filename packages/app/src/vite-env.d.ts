/// <reference types="vite/client" />

declare module 'virtual:code3d-browser-packages' {
  export const files: Readonly<Record<string, {version: string; url: string}>>;
}
