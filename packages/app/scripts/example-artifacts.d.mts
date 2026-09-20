import type {BrowserContext} from 'playwright-core';
import type {Plugin} from 'vite';
import type {PackageManifest} from '../src/project/package-manifest.ts';
import type {BrowserPackageLock} from '../src/project/package-lock.ts';

export type ExampleArtifacts = {
  artifacts: {
    name: string;
    version: string;
    tarball: string;
    filename: string;
    integrity: string;
    manifest: PackageManifest;
  }[];
  projects: {
    directory: string;
    manifest: PackageManifest;
    lock: BrowserPackageLock;
  }[];
};

export const appDirectory: string;
export function prepareExampleArtifacts(): Promise<ExampleArtifacts>;
export function exampleArtifactFiles(
  projects: ExampleArtifacts['projects'],
): Record<string, string>;
export function exampleArtifactsPlugin(
  projects: ExampleArtifacts['projects'],
): Plugin;
export function useExampleArtifacts(
  context: BrowserContext,
  prepared: ExampleArtifacts,
): Promise<void>;
