/// <reference types="vite/client" />
declare const __CODE3D_NODE_BUILTINS__: readonly string[];

declare module 'monaco-editor/languages/definitions/typescript/typescript' {
  export const language: import('monaco-editor/editor').languages.IMonarchLanguage;
}

declare module 'monaco-editor/languages/definitions/javascript/javascript' {
  export const language: import('monaco-editor/editor').languages.IMonarchLanguage;
}

declare module 'virtual:code3d-browser-packages' {
  export const files: Readonly<Record<string, {version: string; url: string}>>;
}
