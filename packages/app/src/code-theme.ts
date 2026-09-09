export const code3dCodeColors = {
  background: '#11110f',
  foreground: '#e7e8df',
  comment: '#6f756b',
  keyword: '#d8ff3e',
  string: '#e8bd76',
  number: '#8ed5d1',
  type: '#aebcff',
} as const;

export const code3dCodeFocusColors = {
  cursor: code3dCodeColors.keyword,
  currentLine: '#1a1b17',
  relatedSymbol: '#d8ff3e1a',
  currentSymbol: '#d8ff3e33',
  bracketMatch: '#7f9239',
  overviewMarker: '#d8ff3e80',
} as const;

export const code3dEditorWidgetColors = {
  accent: code3dCodeColors.keyword,
  accentBorder: code3dCodeFocusColors.bracketMatch,
  background: '#1a1b17',
  mutedForeground: '#a0a694',
  border: '#34362f',
  hoverBackground: '#272923',
  selectedBackground: '#303527',
  selectionBackground: code3dCodeFocusColors.currentSymbol,
  inactiveSelectionBackground: '#d8ff3e14',
} as const;
