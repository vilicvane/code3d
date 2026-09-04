# R-032 — Limit editor types to ECMAScript

Status: complete

## Feedback

The editor loaded TypeScript's default DOM declarations even though Code3D
authoring code does not run against the browser document. Unrelated globals
such as audio and HTML APIs consequently appeared in completion.

## Resolution

- TypeScript and JavaScript project models explicitly use `lib.esnext.d.ts`.
- The normal ECMAScript language surface remains available, while DOM,
  WebWorker, and ScriptHost globals are no longer part of the project type
  environment.
- Completion continues to come directly from the TypeScript language service;
  no name-based filtering or Code3D-specific suppression list is introduced.

## Verification

- Host Chrome completion includes ECMAScript globals such as `Array`, `Map`,
  and `Promise`, but excludes DOM globals such as `BaseAudioContext`,
  `HTMLElement`, and `document`.
- TypeScript reports the expected missing-name diagnostic for `document` while
  accepting ECMAScript globals.
- The app build passes.
