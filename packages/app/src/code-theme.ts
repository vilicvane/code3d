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
  relatedSymbol: '#264f78',
  currentSymbol: '#34362f',
  bracketMatch: '#9b7ad9',
} as const;
