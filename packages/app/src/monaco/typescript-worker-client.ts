import type * as monaco from 'monaco-editor/editor';
import * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';
import type {ProjectTypeScriptWorker} from './typescript-protocol';

export async function projectTypeScriptWorker(
  language: string,
  uri: monaco.Uri,
): Promise<ProjectTypeScriptWorker> {
  const factory = await (language === 'javascript'
    ? typeScriptLanguage.getJavaScriptWorker()
    : typeScriptLanguage.getTypeScriptWorker());
  return (await factory(uri)) as ProjectTypeScriptWorker;
}
