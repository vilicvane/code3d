import {
  AgentError,
  encodeBase64,
  failure,
  parseRequest,
  type AgentRequest,
  type AgentResponse,
  type FileChange,
  type ApplyInput,
} from '@code3d/agent';
import type {SourceRef} from '@code3d/core/tooling';
import type {ProjectEditorChange} from '../editor';
import type {ProjectFileSystem} from '../project/filesystem';
import {
  isSourceFile,
  projectDirectory,
  type ModelProject,
} from '../project/project';
import {inspectAgentCursor} from './cursor-resolver';
import type {ResolvedAgentCursor} from './cursor';

export interface AgentProjectEditor {
  project(): ModelProject;
  fileState(path: string): {content: string; version: string} | undefined;
  applyFiles(files: readonly {path: string; content: string | null}[]): void;
  setAgentCursor(id: string, name: string, ref?: SourceRef): void;
  agentCursor(id: string): {ref?: SourceRef; invalid: boolean};
}

export type AgentObservation = Readonly<{
  agentId: string;
  project: ModelProject;
  cursor: SourceRef;
  arguments?: string;
  input: ApplyInput;
  revision: number;
}>;
type FileState = {
  path: string;
  kind: 'file';
  content: string;
  version: string;
  editorVersion?: string;
  saved: boolean;
};
type Draft = {content: string | null; version: string; error?: string};
const textLimit = 8 * 1024 * 1024;
const encoder = new TextEncoder();

/** One per App project: every user save and agent acceptance uses the same queue. */
export class AgentProjectSession {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly drafts = new Map<string, Draft>();
  private accepting = false;
  private revision = 1;

  constructor(
    readonly fileSystem: ProjectFileSystem,
    private readonly editor: AgentProjectEditor,
    private readonly observe: (
      request: AgentObservation,
    ) => Promise<AgentResponse>,
    private readonly changed: () => void,
    private readonly reportSaveError: (error: Error) => void,
    private readonly resolveCursor = inspectAgentCursor,
  ) {}

  get hasUnsaved(): boolean {
    return this.drafts.size > 0;
  }
  get currentRevision(): number {
    return this.revision;
  }

  recordEditorChange(change: ProjectEditorChange): void {
    if (this.accepting) return;
    this.revision++;
    const files =
      change.kind === 'rename'
        ? [
            {
              path: change.to,
              content: this.editor.fileState(change.to)!.content,
            },
            {path: change.from, content: null},
          ]
        : [
            {
              path: change.path,
              content: change.kind === 'delete' ? null : change.source,
            },
          ];
    const drafts = this.stage(files);
    void this.enqueue(() => this.save(drafts)).catch(error =>
      this.reportSaveError(error as Error),
    );
  }

  async flush(): Promise<void> {
    await this.queue;
    if (this.drafts.size)
      throw new Error(
        'Project files have unsaved changes. Retry saving before leaving this project.',
      );
  }

  async retrySaves(): Promise<void> {
    await this.enqueue(() => this.save([...this.drafts]));
    await this.flush();
  }

  /** Reset/reload operations share the save queue and invalidate outstanding observations. */
  async update<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (this.drafts.size)
        throw new Error('Save pending project changes before replacing files.');
      this.revision++;
      return operation();
    });
  }

  async handle(
    agentId: string,
    name: string,
    value: Exclude<AgentRequest, {operation: 'result'}>,
  ): Promise<AgentResponse> {
    const request = parseRequest(value);
    if (request.operation === 'result')
      throw new Error('Result queries belong to the session endpoint.');
    try {
      if (request.operation !== 'apply')
        return await this.enqueue(() =>
          this.read(request.operation, request.path),
        );
      const accepted = await this.enqueue(() =>
        this.apply(agentId, name, request.input),
      );
      if (!accepted.response.ok || !accepted.observation)
        return accepted.response;
      let observed: AgentResponse;
      try {
        observed = await this.observe(accepted.observation);
      } catch (error) {
        observed = failure(
          error instanceof AgentError ? error.code : 'observation_failed',
          error instanceof Error ? error.message : 'Model observation failed.',
        );
      }
      if (this.revision !== accepted.observation.revision)
        observed = failure(
          'observation_superseded',
          'Project changed during observation. Request a new observation.',
        );
      if (!observed.ok)
        return failure(observed.error.code, observed.error.message, {
          ...(accepted.response.data as object),
          observation: observed.error.details,
        });
      return {
        ok: true,
        data: {
          ...(accepted.response.data as object),
          observation: observed.data,
        },
        ...(observed.artifacts ? {artifacts: observed.artifacts} : {}),
      };
    } catch (error) {
      if (error instanceof AgentError)
        return failure(error.code, error.message, {accepted: false});
      return failure(
        'project_access_failed',
        error instanceof Error ? error.message : 'Project access failed.',
        {accepted: false},
      );
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  private async current(
    path: string,
  ): Promise<FileState | {path: string; kind: 'directory'} | undefined> {
    const info = await this.fileSystem.stat(path);
    if (info?.kind === 'directory') return {path, kind: 'directory'};
    const draft = this.drafts.get(path);
    if (draft?.content === null) return undefined;
    if (info?.size !== undefined && info.size > textLimit)
      throw new AgentError(
        'file_too_large',
        'Agent text files are limited to 8 MiB.',
      );
    const bytes = info ? await this.fileSystem.readFile(path) : undefined;
    if (bytes && bytes.byteLength > textLimit)
      throw new AgentError(
        'file_too_large',
        'Agent text files are limited to 8 MiB.',
      );
    const hash = bytes
      ? encodeBase64(
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
          ),
        )
      : 'absent';
    const document = this.editor.fileState(path);
    const contents = document?.content ?? draft?.content;
    let content: string;
    if (contents !== undefined) content = contents;
    else if (bytes) {
      try {
        content = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      } catch {
        throw new AgentError(
          'binary_file',
          'This operation requires a UTF-8 text file.',
        );
      }
      if (content.includes('\0'))
        throw new AgentError(
          'binary_file',
          'This operation requires a UTF-8 text file.',
        );
    } else return undefined;
    return {
      path,
      kind: 'file',
      content,
      version: `${document?.version ?? draft?.version ?? 'disk'}:${hash}:${info?.version ?? ''}`,
      ...(document ? {editorVersion: document.version} : {}),
      saved: !draft,
    };
  }

  private async read(
    operation: 'fs.list' | 'fs.read' | 'fs.stat',
    path: string,
  ): Promise<AgentResponse> {
    if (operation === 'fs.list') {
      const state = await this.current(path);
      if (state?.kind === 'file')
        throw new AgentError('not_directory', 'The requested path is a file.');
      const entries = new Map<string, 'file' | 'directory'>();
      if (state?.kind === 'directory')
        for (const entry of await this.fileSystem.list(path))
          entries.set(entry.name, entry.kind);
      const prefix = path === '/' ? '/' : path + '/';
      const overlay = new Map(
        this.editor.project().files.map(file => [file.path, file.source]),
      );
      for (const [file, draft] of this.drafts) {
        if (draft.content === null) {
          if (projectDirectory(file) === path)
            entries.delete(file.slice(prefix.length));
          overlay.delete(file);
        } else overlay.set(file, draft.content);
      }
      for (const file of overlay.keys()) {
        if (!file.startsWith(prefix)) continue;
        const tail = file.slice(prefix.length);
        entries.set(
          tail.split('/')[0],
          tail.includes('/') ? 'directory' : 'file',
        );
      }
      if (!state && !entries.size)
        throw new AgentError('not_found', 'Project directory does not exist.');
      return {
        ok: true,
        data: {
          path,
          entries: [...entries]
            .map(([name, kind]) => ({name, kind}))
            .sort((a, b) => a.name.localeCompare(b.name)),
        },
      };
    }
    let state: Awaited<ReturnType<AgentProjectSession['current']>>;
    try {
      state = await this.current(path);
    } catch (error) {
      if (
        !(error instanceof AgentError) ||
        !['binary_file', 'file_too_large'].includes(error.code)
      )
        throw error;
      const info = await this.fileSystem.stat(path);
      if (!info)
        throw new AgentError('not_found', 'Project path does not exist.');
      const data = {
        path,
        kind: 'file',
        version: info.version,
        size: info.size,
        editable: false,
      };
      if (operation === 'fs.stat') return {ok: true, data};
      if (error.code === 'file_too_large') throw error;
      const bytes = await this.fileSystem.readFile(path);
      if (!bytes || bytes.length > textLimit)
        throw new AgentError(
          'file_too_large',
          'Agent file reads are limited to 8 MiB.',
        );
      return {
        ok: true,
        data,
        artifacts: [
          {
            name: path.split('/').at(-1)!,
            mimeType: 'application/octet-stream',
            base64: encodeBase64(bytes),
          },
        ],
      };
    }
    if (!state)
      throw new AgentError('not_found', 'Project path does not exist.');
    if (operation === 'fs.read' && state.kind !== 'file')
      throw new AgentError('not_file', 'The requested path is a directory.');
    if (state.kind === 'directory') return {ok: true, data: state};
    return {
      ok: true,
      data: {
        path,
        kind: 'file',
        version: state.version,
        saved: state.saved,
        size: encoder.encode(state.content).length,
        ...(operation === 'fs.read' ? {content: state.content} : {}),
      },
    };
  }

  private async apply(
    agentId: string,
    name: string,
    input: ApplyInput,
  ): Promise<{response: AgentResponse; observation?: AgentObservation}> {
    const files = input.files ?? [];
    const proposed = new Map(files.map(file => [file.path, file.content]));
    for (const file of files) {
      if (
        file.path.split('/').some(part => part === '.git' || part === '.code3d')
      )
        throw new AgentError(
          'protected_path',
          'Git and Code3D workspace metadata cannot be changed through apply.',
        );
      if (
        file.content !== null &&
        (encoder.encode(file.content).length > textLimit ||
          file.content.includes('\0'))
      )
        throw new AgentError(
          'invalid_file',
          'apply accepts UTF-8 text up to 8 MiB per file, without NUL characters.',
        );
      for (
        let parent = projectDirectory(file.path);
        parent !== '/';
        parent = projectDirectory(parent)
      ) {
        if (proposed.has(parent))
          throw new AgentError(
            'path_conflict',
            'A file batch cannot replace an ancestor of another affected path.',
          );
        if ((await this.current(parent))?.kind === 'file')
          throw new AgentError('path_conflict', 'A parent path is a file.');
      }
    }
    const initial = await Promise.all(
      files.map(file => this.current(file.path)),
    );
    const conflicts = files.flatMap((file, i) => {
      const current = initial[i];
      return current?.kind === 'directory' ||
        (current?.version ?? null) !== file.version
        ? [
            {
              path: file.path,
              currentVersion: current?.kind === 'file' ? current.version : null,
              kind: current?.kind ?? 'absent',
            },
          ]
        : [];
    });
    if (conflicts.length)
      return {
        response: failure(
          'version_conflict',
          'Project files changed. Read them again before applying.',
          {accepted: false, conflicts},
        ),
      };
    const remaining = new Set(
      this.editor.project().files.map(file => file.path),
    );
    for (const file of files)
      if (isSourceFile(file.path)) {
        if (file.content === null) remaining.delete(file.path);
        else remaining.add(file.path);
      }
    if (!remaining.size)
      throw new AgentError(
        'empty_project',
        'A project needs at least one source file.',
      );

    let resolved: ResolvedAgentCursor | undefined;
    let cursorBase: FileState | undefined;
    if (input.cursor) {
      if (!isSourceFile(input.cursor.file))
        throw new AgentError(
          'cursor_not_source',
          'Agent cursors require a source file.',
        );
      const state = await this.current(input.cursor.file);
      cursorBase = state?.kind === 'file' ? state : undefined;
      const source = proposed.has(input.cursor.file)
        ? proposed.get(input.cursor.file)
        : cursorBase?.content;
      if (source === null || source === undefined)
        throw new AgentError(
          'cursor_file_missing',
          'Cursor file is absent from the proposed project.',
        );
      resolved = await this.resolveCursor(source, input.cursor);
    }
    const checks = new Map<
      string,
      FileState | {path: string; kind: 'directory'} | undefined
    >(files.map((file, i) => [file.path, initial[i]]));
    if (input.cursor && !checks.has(input.cursor.file))
      checks.set(input.cursor.file, cursorBase);
    for (const [path, before] of checks) {
      const now = await this.current(path);
      if (
        before?.kind !== now?.kind ||
        (before?.kind === 'file' ? before.version : null) !==
          (now?.kind === 'file' ? now.version : null)
      )
        return {
          response: failure(
            'version_conflict',
            'A file changed during preflight.',
            {
              accepted: false,
              conflicts: [
                {
                  path,
                  currentVersion: now?.kind === 'file' ? now.version : null,
                },
              ],
            },
          ),
        };
      checks.set(path, now);
    }
    // No await between this final editor revision check and accepting the whole batch.
    for (const [path, state] of checks)
      if (
        (state?.kind === 'file' ? state.editorVersion : undefined) !==
        this.editor.fileState(path)?.version
      )
        return {
          response: failure(
            'version_conflict',
            'Editor content changed during preflight.',
            {accepted: false, conflicts: [{path}]},
          ),
        };
    const staged = this.stage(files);
    this.accepting = true;
    try {
      this.editor.applyFiles(files.filter(file => isSourceFile(file.path)));
    } finally {
      this.accepting = false;
    }
    if (resolved)
      this.editor.setAgentCursor(agentId, name, {
        file: resolved.file,
        start: resolved.start,
        end: resolved.end,
      });
    if (files.length) this.revision++;
    this.changed();
    const acceptedVersions = new Map(
      files.map(file => [file.path, this.editor.fileState(file.path)?.version]),
    );
    const project = this.editor.project();
    const revision = this.revision;
    const cursor = this.editor.agentCursor(agentId);
    await this.save(staged);
    const outcomes = [];
    for (const file of files) {
      const saved = !this.drafts.has(file.path);
      const superseded =
        acceptedVersions.get(file.path) !==
        this.editor.fileState(file.path)?.version;
      let state: Awaited<ReturnType<AgentProjectSession['current']>>;
      try {
        state = await this.current(file.path);
      } catch (error) {
        outcomes.push({
          path: file.path,
          saved,
          versionUnavailable: true,
          error:
            error instanceof Error
              ? error.message
              : 'Cannot read saved file state.',
        });
        continue;
      }
      outcomes.push({
        path: file.path,
        saved,
        ...(superseded
          ? {superseded: true}
          : {version: state?.kind === 'file' ? state.version : null}),
        ...(this.drafts.get(file.path)?.error
          ? {error: this.drafts.get(file.path)!.error}
          : {}),
      });
    }
    const data = {
      accepted: true,
      saved: outcomes.every(file => file.saved),
      revision,
      files: outcomes,
      ...(resolved
        ? {cursor: resolved}
        : {cursor: cursor.ref ?? null, cursorInvalid: cursor.invalid}),
    };
    if (!data.saved)
      return {
        response: failure(
          'save_failed',
          'Changes were accepted, but some files could not be saved. Read the pending contents and retry saving.',
          data,
        ),
      };
    if (!(input.render || input.topology)) return {response: {ok: true, data}};
    if (!cursor.ref)
      return {
        response: failure(
          'cursor_required',
          cursor.invalid
            ? 'The agent cursor was invalidated by an edit. Supply a new cursor.'
            : 'Supply a cursor to choose the model to observe.',
          data,
        ),
      };
    return {
      response: {ok: true, data},
      observation: {
        agentId,
        project,
        cursor: cursor.ref,
        revision,
        input,
        ...(input.cursor?.arguments === undefined
          ? {}
          : {arguments: input.cursor.arguments}),
      },
    };
  }

  private stage(
    files: readonly Pick<FileChange, 'path' | 'content'>[],
  ): [string, Draft][] {
    return files.map(file => {
      const draft: Draft = {
        content: file.content,
        version: crypto.randomUUID(),
      };
      this.drafts.set(file.path, draft);
      return [file.path, draft];
    });
  }

  private async save(drafts: readonly [string, Draft][]): Promise<void> {
    let failed = false;
    for (const [path, draft] of [...drafts].sort(
      (a, b) => Number(a[1].content === null) - Number(b[1].content === null),
    )) {
      if (failed) {
        draft.error = 'Not attempted because an earlier save failed.';
        continue;
      }
      try {
        if (draft.content === null) {
          if (await this.fileSystem.stat(path))
            await this.fileSystem.remove(path);
        } else await this.fileSystem.writeFile(path, draft.content);
        if (this.drafts.get(path) === draft) this.drafts.delete(path);
      } catch (error) {
        failed = true;
        draft.error =
          error instanceof Error ? error.message : 'File save failed.';
        this.reportSaveError(
          new Error('Could not save ' + path + ': ' + draft.error),
        );
      }
    }
    this.changed();
  }
}
