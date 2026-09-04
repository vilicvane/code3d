import {codeToHtml, type ThemeRegistrationRaw} from 'shiki';
import {
  code3dCodeColors as colors,
  code3dCodeFocusColors as focusColors,
} from '../../../app/src/code-theme';
import {
  sourceTokenOffset,
  type SourceToken,
} from '../../../app/render-samples/source-focus';

const theme: ThemeRegistrationRaw = {
  name: 'code3d',
  type: 'dark',
  fg: colors.foreground,
  bg: colors.background,
  settings: [
    {scope: 'comment', settings: {foreground: colors.comment}},
    {
      scope: [
        'keyword',
        'storage',
        'constant.language',
        'support.type.primitive',
      ],
      settings: {foreground: colors.keyword},
    },
    {scope: 'string', settings: {foreground: colors.string}},
    {scope: 'constant.numeric', settings: {foreground: colors.number}},
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.type'],
      settings: {foreground: colors.type},
    },
  ],
};

export async function highlightedSource(source: string, focus?: SourceToken) {
  const offset = focus ? sourceTokenOffset(source, focus) : undefined;
  return codeToHtml(source, {
    lang: 'typescript',
    theme,
    decorations:
      focus && offset !== undefined
        ? [
            {
              start: offset,
              end: offset + focus.token.length,
              properties: {
                class: 'source-focus',
                style: `background:${focusColors.currentSymbol};border-bottom:2px solid ${focusColors.cursor}`,
              },
              alwaysWrap: true,
            },
          ]
        : [],
  });
}
