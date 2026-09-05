# R-035 — Parameter annotation editor support

Status: complete

## Feedback

Bring `@code3d.param` up to the editor support of `@code3d.arguments`:
highlighting, completion, and validation.

## Resolution

- Highlight parameter names and configuration tokens using the same embedded
  TypeScript colors as design arguments. Multiline JSDoc retains its comment
  prefixes and exact source offsets, including CRLF and Unicode text.
- Complete actual parameter names, configuration properties, kind values,
  numeric constraint fields, and action fields/values. Completion uses the
  actual configuration types in a private TypeScript projection, without
  adding imports or exposing synthetic files to the author.
- Resolve names from callable signatures, including ordinary functions,
  methods, inferred factory results, and emitted named rest tuples.
- Share annotation extraction, signature parameters, and static configuration
  validation between the compiler and editor. Invalid names, duplicate tags,
  unsupported kinds, unknown fields, malformed/static-only values, constraints,
  and actions produce editor markers even on unused declarations.
- Scan real JSDoc rather than annotation-like text inside ordinary strings.
- Isolate each app test loader's Vite cache and disable its WebSocket server.
  Tests previously shared the running preview's cache and could delete its
  optimized modules when their server configuration differed.

## Verification

- Regression tests cover extraction and offsets, unused declarations,
  overloads, shared compile/editor validation, completion replacement spans,
  multiline values, inferred callables, and emitted tuple parameters.
- Existing compiler/tooling tests cover imported and aliased callable metadata
  and the custom primitive example.
- Host Chrome checks cover visible token colors, native completion insertion,
  inline errors, and marker removal after fixing the configuration.
- App build and workspace tests pass.
