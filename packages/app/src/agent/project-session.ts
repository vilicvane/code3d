import {action, computed, makeObservable, observable, runInAction} from 'mobx';
import {
  AgentError,
  encodeBase64,
  failure,
  parseRequest,
  type AgentRequest,
  type AgentResponse,
  type FileChange,
  type ApplyInput,
  type RenderView,
  type RenderMode,
} from '@code3d/agent';
import type {SourceRef} from '@code3d/core/tooling';
import type {ProjectEditorChange} from '../editor';
import type {CursorTypeInfo} from '../monaco/type-info';
import {decodeProjectFile} from '../project/file-reader';
import {mapProjectIO} from '../project/io';
import type {ProjectFileSystem} from '../project/filesystem';
import {
  checkProjectEntryOperation,
  copyProjectEntry,
  type ProjectEntryOperation,
} from '../project/file-operations';
import {
  isSourceFile,
  isProjectTextFile,
  projectDirectory,
  projectPathIsWithin,
  type ModelProject,
} from '../project/project';
import {inspectAgentCursor} from './cursor-resolver';
import type {ResolvedAgentCursor} from './cursor';
import {contextCursor} from './context';

export interface AgentProjectEditor {
  currentFile(): string | undefined;
  selectedSource(): SourceRef | undefined;
  project(): ModelProject;
  filePaths(): readonly string[];
  fileState(path: string): {content: string; version: string} | undefined;
  applyFiles(files: readonly {path: string; content: string | null}[]): void;
  moveFiles(from: string, to: string): void;
  setAgentCursor(id: string, name: string, ref?: SourceRef): void;
  agentCursor(id: string): {ref?: SourceRef; invalid: boolean};
  inspectType(ref: SourceRef): Promise<CursorTypeInfo | null>;
}

export type AgentObservation = Readonly<{
  agentId: string;
  project: ModelProject;
  cursor: SourceRef;
  arguments?: string;
  input: ApplyInput;
  revision: number;
}>;
type AgentReadTarget = Readonly<{kind: 'read' | 'list'; path: string}>;
export type AgentUpdate = Readonly<{agentId: string}> &
  (
    | Readonly<{
        kind: 'apply';
        cursor?: SourceRef;
        arguments?: string;
        view?: RenderView;
        mode?: RenderMode;
      }>
    | AgentReadTarget
  );
type FileState = {
  path: string;
  kind: 'file';
  content: string;
  version: string;
  editorVersion?: string;
  saved: boolean;
};
type Draft = {content: string | null; error?: string};
const textLimit = 8 * 1024 * 1024;
const encoder = new TextEncoder();

/** One per App project: every user save and agent acceptance uses the same queue. */
export class AgentProjectSession {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly drafts = observable.map<string, Draft>([], {deep: false});
  private accepting = false;
  private readonly externalVersions = new Map<string, string | undefined>();
  private revision = 1;
  private readonly updateListeners = new Set<(update: AgentUpdate) => void>();
  private readonly agentStates = new Map<
    string,
    {
      target: {kind: 'apply'} | AgentReadTarget;
      arguments?: string;
      view?: RenderView;
      mode?: RenderMode;
    }
  >();
  private readonly entryListeners = new Set<
    (reason: 'operation' | 'save' | 'external') => void
  >();

  constructor(
    readonly fileSystem: ProjectFileSystem,
    private readonly editor: AgentProjectEditor,
    private readonly observe: (
      request: AgentObservation,
    ) => Promise<AgentResponse>,
    private readonly reportSaveError: (error: Error) => void,
    private readonly resolveCursor = inspectAgentCursor,
  ) {
    makeObservable<this, 'revision' | 'advanceRevision' | 'stage'>(this, {
      revision: observable,
      hasUnsaved: computed,
      currentRevision: computed,
      advanceRevision: action,
      recordEditorChange: action,
      stage: action,
    });
  }

  get hasUnsaved(): boolean {
    return this.drafts.size > 0;
  }
  unsavedFilePaths(): readonly string[] {
    return [...this.drafts]
      .filter(([, draft]) => draft.content !== null)
      .map(([path]) => path);
  }
  get currentRevision(): number {
    return this.revision;
  }

  onEntriesChange(
    listener: (reason: 'operation' | 'save' | 'external') => void,
  ): () => void {
    this.entryListeners.add(listener);
    return () => this.entryListeners.delete(listener);
  }

  private entriesChanged(reason: 'operation' | 'save' | 'external'): void {
    for (const listener of this.entryListeners) listener(reason);
  }

  private acceptEditorChanges(operation: () => void): void {
    this.accepting = true;
    try {
      operation();
    } finally {
      this.accepting = false;
    }
  }

  /** Explorer mutations use the same queue as user saves and accepted agent edits. */
  async changeEntries(operation: ProjectEntryOperation): Promise<void> {
    await this.update(async () => {
      await checkProjectEntryOperation(this.fileSystem, operation);
      try {
        if (operation.kind === 'create') {
          const {path, kind} = operation.entry;
          if (kind === 'directory') await this.fileSystem.createDirectory(path);
          else await this.fileSystem.writeFile(path, '');
        } else if (operation.kind === 'remove') {
          for (const path of operation.paths) {
            await this.fileSystem.remove(path);
            const files = this.editor
              .filePaths()
              .filter(file => projectPathIsWithin(file, path));
            this.acceptEditorChanges(() =>
              this.editor.applyFiles(
                files.map(path => ({path, content: null})),
              ),
            );
          }
        } else {
          for (const {from, to} of operation.entries) {
            if (operation.kind === 'copy')
              await copyProjectEntry(this.fileSystem, from, to);
            else {
              await this.fileSystem.rename(from, to);
              this.acceptEditorChanges(() => this.editor.moveFiles(from, to));
            }
          }
        }
      } finally {
        this.entriesChanged('operation');
      }
    });
  }

  onAgentUpdate(listener: (update: AgentUpdate) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  latestAgentUpdate(agentId: string): AgentUpdate | undefined {
    const state = this.agentStates.get(agentId);
    if (state && state.target.kind !== 'apply')
      return {agentId, ...state.target};
    // Monaco maintains the live selection through formatting, edits and renames.
    const cursor = this.editor.agentCursor(agentId).ref;
    if (!cursor) return undefined;
    return {
      agentId,
      kind: 'apply',
      cursor,
      arguments: state?.arguments,
      view: state?.view,
      mode: state?.mode,
    };
  }

  forgetAgent(agentId: string): void {
    this.agentStates.delete(agentId);
  }

  private advanceRevision(): void {
    this.revision++;
  }

  recordEditorChange(change: ProjectEditorChange): void {
    if (this.accepting) return;
    this.advanceRevision();
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

  /** Reconcile disk changes without saving them back or replacing in-flight edits. */
  async refreshExternalFiles(
    project: ModelProject,
    cancelled: () => boolean = () => false,
    changedPaths?: readonly string[],
    force = false,
  ): Promise<void> {
    await this.enqueue(async () => {
      if (cancelled()) return;
      const sources = new Map(
        project.files.map(file => [file.path, file.source]),
      );
      const unique = [
        ...new Set([
          ...sources.keys(),
          ...[...this.externalVersions]
            .filter(([, version]) => version === undefined)
            .map(([path]) => path),
        ]),
      ];
      const retained = new Set(unique);
      for (const path of this.externalVersions.keys())
        if (!retained.has(path)) this.externalVersions.delete(path);
      const selected = changedPaths
        ? unique.filter(path =>
            changedPaths.some(changed => projectPathIsWithin(path, changed)),
          )
        : unique;
      const states = new Map(
        selected.map(path => [path, this.editor.fileState(path)]),
      );
      const infos = await mapProjectIO(selected, path =>
        this.fileSystem.stat(path),
      );
      const updates: {path: string; content: string | null}[] = [];
      let changed = false;
      for (const [index, path] of selected.entries()) {
        if (cancelled()) return;
        if (this.drafts.has(path)) continue;
        const info = infos[index];
        const version =
          info && JSON.stringify([info.kind, info.version, info.size]);
        if (
          !force &&
          !changedPaths &&
          this.externalVersions.has(path) &&
          this.externalVersions.get(path) === version
        )
          continue;
        const state = states.get(path);
        const bytes =
          info?.kind === 'file'
            ? await this.fileSystem.readFile(path)
            : undefined;
        if (cancelled()) return;
        if (
          this.drafts.has(path) ||
          this.editor.fileState(path)?.version !== state?.version
        )
          continue;
        const content = bytes === undefined ? null : decodeProjectFile(bytes);
        // First observation also checks editor buffers: they may predate this watcher.
        if (state) {
          if (state.content !== content) {
            updates.push({path, content});
            changed = true;
          }
        } else if (content !== sources.get(path)) changed = true;
        this.externalVersions.set(path, version);
      }
      if (cancelled() || !changed) return;
      this.advanceRevision();
      const applicable = updates.filter(update => {
        const current = this.editor.fileState(update.path);
        if (
          this.drafts.has(update.path) ||
          current?.version !== states.get(update.path)?.version
        ) {
          this.externalVersions.delete(update.path);
          return false;
        }
        return true;
      });
      this.acceptEditorChanges(() => this.editor.applyFiles(applicable));
      this.entriesChanged('external');
    });
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
      this.advanceRevision();
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
      if (request.operation === 'context')
        return await this.enqueue(async () => {
          const file = this.editor.currentFile() ?? null;
          const ref = this.editor.selectedSource();
          return {
            ok: true,
            data: {
              file,
              revision: this.revision,
              cursor: ref
                ? contextCursor(this.editor.fileState(ref.file)!.content, ref)
                : null,
            },
          };
        });
      if (request.operation !== 'apply')
        return await this.enqueue(async () => {
          const response = await this.read(request.operation, request.path);
          if (response.ok && request.operation !== 'fs.stat') {
            const target: AgentReadTarget = {
              kind: request.operation === 'fs.read' ? 'read' : 'list',
              path: request.path,
            };
            this.agentStates.set(agentId, {
              ...this.agentStates.get(agentId),
              target,
            });
            for (const listener of this.updateListeners)
              listener({agentId, ...target});
          }
          return response;
        });
      const accepted = await this.enqueue(() =>
        this.apply(agentId, name, request.input),
      );
      if (!accepted.response.ok || !accepted.observation)
        return accepted.response;
      let observed: AgentResponse;
      try {
        const observation = accepted.observation;
        const geometry: AgentResponse =
          observation.input.render || observation.input.topology
            ? await this.observe(observation)
            : {
                ok: true,
                data: {
                  revision: observation.revision,
                  cursor: observation.cursor,
                },
              };
        // A retained topology snapshot may predate a cursor-only move. Type
        // feedback must describe that snapshot's source selection too.
        const type = observation.input.type
          ? await this.editor.inspectType(
              geometry.ok
                ? (geometry.data as {cursor: SourceRef}).cursor
                : observation.cursor,
            )
          : undefined;
        observed = geometry.ok
          ? {
              ...geometry,
              data: {
                ...(geometry.data as object),
                ...(type === undefined ? {} : {type}),
              },
            }
          : {
              ...geometry,
              error: {
                ...geometry.error,
                details: {
                  ...(geometry.error.details as object),
                  ...(type === undefined ? {} : {type}),
                },
              },
            };
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
    // Opening an unchanged editor document must not invalidate an agent's read.
    // The editor revision is checked separately during apply preflight.
    const contentHash = encodeBase64(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', encoder.encode(content)),
      ),
    );
    return {
      path,
      kind: 'file',
      content,
      version: `${contentHash}:${hash}:${info?.version ?? ''}`,
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
    this.acceptEditorChanges(() =>
      this.editor.applyFiles(
        files.filter(
          file =>
            isProjectTextFile(file.path) || this.editor.fileState(file.path),
        ),
      ),
    );
    if (resolved)
      this.editor.setAgentCursor(agentId, name, {
        file: resolved.file,
        start: resolved.start,
        end: resolved.end,
      });
    if (files.length) this.advanceRevision();
    const acceptedVersions = new Map(
      files.map(file => [file.path, this.editor.fileState(file.path)?.version]),
    );
    const project = this.editor.project();
    const revision = this.revision;
    const cursor = this.editor.agentCursor(agentId);
    const view =
      typeof input.render === 'object' ? input.render.view : undefined;
    const mode =
      typeof input.render === 'object' ? input.render.mode : undefined;
    if (files.length || input.cursor || view || mode) {
      const update: AgentUpdate = {
        agentId,
        kind: 'apply',
        cursor: cursor.ref,
        arguments: input.cursor?.arguments,
        view,
        mode,
      };
      this.agentStates.set(agentId, {
        target: {kind: 'apply'},
        arguments: update.arguments,
        view: view ?? this.agentStates.get(agentId)?.view,
        mode: mode ?? this.agentStates.get(agentId)?.mode,
      });
      for (const listener of this.updateListeners) listener(update);
    }
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
    if (!(input.render || input.topology || input.type))
      return {response: {ok: true, data}};
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
      };
      this.drafts.set(file.path, draft);
      return [file.path, draft];
    });
  }

  private async save(drafts: readonly [string, Draft][]): Promise<void> {
    let failed = false;
    let entriesChanged = false;
    for (const [path, draft] of [...drafts].sort(
      (a, b) => Number(a[1].content === null) - Number(b[1].content === null),
    )) {
      if (failed) {
        draft.error = 'Not attempted because an earlier save failed.';
        continue;
      }
      try {
        const existed = await this.fileSystem.stat(path);
        if (draft.content === null) {
          if (existed) await this.fileSystem.remove(path);
        } else await this.fileSystem.writeFile(path, draft.content);
        entriesChanged ||= draft.content === null ? !!existed : !existed;
        runInAction(() => {
          if (this.drafts.get(path) === draft) this.drafts.delete(path);
        });
      } catch (error) {
        failed = true;
        draft.error =
          error instanceof Error ? error.message : 'File save failed.';
        this.reportSaveError(
          new Error('Could not save ' + path + ': ' + draft.error),
        );
      }
    }
    if (entriesChanged || failed) this.entriesChanged('save');
  }
}
