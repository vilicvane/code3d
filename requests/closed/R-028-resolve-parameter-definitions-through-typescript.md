# R-028 Resolve parameter definitions through TypeScript

## Request

- Replace name-based, one-file parameter lookup with TypeScript definition
  resolution.
- Let a tool parameter follow a uniquely resolved chain of aliases and object
  properties to an editable numeric definition.

## Confirmed behavior

- A reference is editable when every semantic definition step is unique and
  the chain ends at a static numeric initializer.
- Object properties, computed properties with literal keys, destructuring,
  local aliases, imports, and re-exports use the same definition path; source
  spelling and hand-written shadow detection do not participate.
- Ambiguous definitions and receivers without one concrete runtime definition
  remain uneditable rather than selecting a candidate heuristically.
- Contextual panels and viewport providers prefer a resolved upstream target
  over inline literals in the same parameter expression.
- A present numeric argument with no editable target keeps an empty input and
  shows its evaluated runtime value as the placeholder; omitted arguments
  remain blank without a placeholder.

## Status

Implemented.

## Verification

- `npm test --workspace @code3d/app`
- `npm run build --workspace @code3d/app`
- Host Chrome: object-property parameters display their effective values and
  write edits back to the property initializer.
- Host Chrome: an aliased property used in arithmetic writes through to the
  canonical initializer while retaining the call-site expression.
- Host Chrome: `box(Math.PI)` shows `3.142` as the width placeholder, while its
  omitted parameters do not receive placeholders.
