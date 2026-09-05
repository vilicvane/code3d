import type {ProjectFileInfo, ProjectFileReader} from './file-reader';
import {normalizeProjectPath} from './project';

type CachedFile = {
  info: Promise<ProjectFileInfo | undefined>;
  contents?: Promise<Uint8Array | undefined>;
};

/** Cache reached files only, including misses so newly installed packages are detected. */
export class ProjectFileCache implements ProjectFileReader {
  private readonly entries = new Map<string, CachedFile>();

  constructor(private readonly reader: ProjectFileReader) {}

  private entry(path: string): CachedFile {
    path = normalizeProjectPath(path);
    let entry = this.entries.get(path);
    if (!entry) {
      const info = this.reader.stat(path).catch(error => {
        if (this.entries.get(path)?.info === info) this.entries.delete(path);
        throw error;
      });
      entry = {info};
      this.entries.set(path, entry);
    }
    return entry;
  }

  stat(path: string): Promise<ProjectFileInfo | undefined> {
    return this.entry(path).info;
  }

  readFile(path: string): Promise<Uint8Array | undefined> {
    const entry = this.entry(path);
    entry.contents ??= entry.info
      .then(info =>
        info?.kind === 'file' ? this.reader.readFile(path) : undefined,
      )
      .catch(error => {
        // A transient package fetch or permission failure is not file content.
        entry.contents = undefined;
        throw error;
      });
    return entry.contents;
  }

  async refresh(): Promise<ReadonlySet<string>> {
    const changed = new Set<string>();
    await Promise.all(
      [...this.entries].map(async ([path, entry]) => {
        const [previous, next] = await Promise.all([
          entry.info,
          this.reader.stat(path),
        ]);
        if (
          previous?.kind !== next?.kind ||
          previous?.version !== next?.version
        ) {
          changed.add(path);
          this.entries.set(path, {info: Promise.resolve(next)});
        }
      }),
    );
    return changed;
  }
}
