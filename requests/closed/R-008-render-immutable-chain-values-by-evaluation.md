# R-008 Render immutable chain values by evaluation

## Request

Source selection should render the immutable value at that exact point in a
chain. In the sample, `postBlank` and `named` retain the primitive appearance,
`paint` introduces the accent color, `relate` adds its relation, and only the
`posts` collection boundary renders both posts. At the `union` input, both posts
render with their operation peers as context.

## Resolution

Source targets now preserve separate runtime evaluations instead of flattening
all objects produced at a source site. A chained call renders one evaluation's
result; a collection value renders all objects returned by its evaluation.
Operation-input context and decorations use the matching operation evaluation,
so the scope remains exact through Boolean previews and peer switching.

The default primitive color is now neutral rather than nearly identical to the
UI accent, making the `named` to `paint` transition visually explicit.

The chainable `named()` operation referenced by this historical request was
later removed from the authoring API. The evaluation-boundary behavior remains
applicable to the other semantic-immutable model operations.
