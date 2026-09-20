import * as monaco from 'monaco-editor/editor';
import * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';
import type {FileTextChanges} from '@typescript/typescript6';
import {projectTypeScriptWorker} from './typescript-worker-client';

/** Project fixes use the same import preferences and formatting as completions. */
export function registerProjectTypeScriptCodeActions(
  selector: monaco.languages.LanguageSelector,
): monaco.IDisposable {
  for (const defaults of [
    typeScriptLanguage.typescriptDefaults,
    typeScriptLanguage.javascriptDefaults,
  ]) {
    defaults.setModeConfiguration({
      ...defaults.modeConfiguration,
      codeActions: false,
    });
  }
  const resolvers = new WeakMap<
    monaco.languages.CodeAction,
    (
      token: monaco.CancellationToken,
    ) => Promise<monaco.languages.CodeAction | undefined>
  >();
  return monaco.languages.registerCodeActionProvider(
    selector,
    {
      async provideCodeActions(model, _range, context, token) {
        if (!context.markers.length) return undefined;
        const version = model.getVersionId();
        const language = model.getLanguageId();
        const defaults =
          language === 'javascript'
            ? typeScriptLanguage.javascriptDefaults
            : typeScriptLanguage.typescriptDefaults;
        const libs = defaults.getExtraLibs();
        const options = defaults.getCompilerOptions();
        const current = (requestToken = token) =>
          !requestToken.isCancellationRequested &&
          !model.isDisposed() &&
          model.getVersionId() === version &&
          model.getLanguageId() === language &&
          defaults.getExtraLibs() === libs &&
          defaults.getCompilerOptions() === options;
        try {
          const worker = await projectTypeScriptWorker(language, model.uri);
          if (!current()) return undefined;
          const actions: monaco.languages.CodeAction[] = [];
          const combined = new Map<string, string>();
          const seen = new Set<string>();
          for (const marker of context.markers) {
            const code = Number(
              typeof marker.code === 'object' ? marker.code.value : marker.code,
            );
            if (!Number.isFinite(code)) continue;
            const range = monaco.Range.lift(marker);
            const fixes = await worker.getProjectCodeFixes(
              model.uri.toString(),
              model.getOffsetAt(range.getStartPosition()),
              model.getOffsetAt(range.getEndPosition()),
              [code],
            );
            if (!current()) return undefined;
            for (const fix of fixes) {
              // TypeScript commands and file creation need a project filesystem
              // transaction. Never partially apply those as current-file edits.
              if (fix.commands?.length) continue;
              const edit = fileEdit(model, version, fix.changes);
              if (!edit) continue;
              const key = JSON.stringify([fix.description, fix.changes]);
              if (seen.has(key)) continue;
              seen.add(key);
              actions.push({
                title: fix.description,
                kind: 'quickfix',
                diagnostics: [marker],
                edit,
              });
              if (
                fix.fixName === 'import' &&
                typeof fix.fixId === 'string' &&
                fix.fixAllDescription
              )
                combined.set(fix.fixId, fix.fixAllDescription);
            }
          }
          for (const [fixId, title] of combined) {
            const action: monaco.languages.CodeAction = {
              title,
              kind: 'quickfix',
            };
            resolvers.set(action, async resolveToken => {
              if (!current(resolveToken)) return undefined;
              try {
                // Resolve only when selected; TypeScript merges the file's imports.
                const fix = await worker.getProjectCombinedCodeFix(
                  model.uri.toString(),
                  fixId,
                );
                if (!current(resolveToken) || fix.commands?.length)
                  return undefined;
                const edit = fileEdit(model, version, fix.changes);
                return edit ? {...action, edit} : undefined;
              } catch (error) {
                if (current(resolveToken)) throw error;
                return undefined;
              }
            });
            actions.push(action);
          }
          return {actions, dispose() {}};
        } catch (error) {
          if (current()) throw error;
          return undefined;
        }
      },
      resolveCodeAction(action, token) {
        return resolvers.get(action)?.(token);
      },
    },
    {providedCodeActionKinds: ['quickfix']},
  );
}

function fileEdit(
  model: monaco.editor.ITextModel,
  versionId: number,
  changes: readonly FileTextChanges[],
): monaco.languages.WorkspaceEdit | undefined {
  if (
    changes.some(
      change =>
        change.isNewFile ||
        monaco.Uri.parse(change.fileName).toString() !== model.uri.toString(),
    )
  )
    return undefined;
  const edits = changes.flatMap(change =>
    change.textChanges.map(change => ({
      resource: model.uri,
      versionId,
      textEdit: {
        range: monaco.Range.fromPositions(
          model.getPositionAt(change.span.start),
          model.getPositionAt(change.span.start + change.span.length),
        ),
        text: change.newText,
      },
    })),
  );
  return edits.length ? {edits} : undefined;
}
