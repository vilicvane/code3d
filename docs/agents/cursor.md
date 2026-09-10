# Source selection and function arguments

[Start here](../agents.md) · Read this to choose an observation target precisely, inspect a function with custom arguments, or recover a lost selection.

## Select an expression and inspect a function

```json
{
  "operation": "apply",
  "input": {
    "cursor": {
      "file": "/model.ts",
      "regex": "return ([^;]+);",
      "lines": [20, 40],
      "arguments": "[10, 5, 6]"
    },
    "render": {
      "view": "front"
    },
    "topology": true,
    "type": true
  }
}
```

The complete regex match must be unique, with **exactly one capturing group**.
The capture selects the expression; an empty capture places a caret. Use `(?:...)`
for any other groups. An unmatched capture is invalid. Optional `lines` is an
inclusive, 1-based range; both the whole match and capture must fall inside it,
excluding the final line's newline. Regex anchors/lookarounds still see the full
source; overlapping matches count toward uniqueness. Default flags are `u`;
`i`, `m`, `s`, `u`, or `v` may be supplied in `flags`. Regex evaluation is bounded
in a separate worker. Returned offsets are UTF-16 with Monaco line/column positions.

The cursor matches source **after** this apply's file changes. Omitting it retains
your tracked agent cursor. If edits invalidate the selection, explicitly select
again. After a page reload, reread file versions and supply a new cursor before
observing. Agent decorations never take over the user's selection.

`cursor.arguments` is a TypeScript array-expression string evaluated in the
containing module's scope; imports, variables, and model objects are available.
Explicit arguments take priority over the function's JSDoc `@code3d.arguments`,
then ordinary execution. Omission does not reuse previous custom arguments;
`"[]"` explicitly calls with no arguments. This also works without JSDoc.

## Related reading

See [observation](observation.md) for output options, [sketches](sketches.md) for 2D targets, and [files](files.md) for changing source in the same request.
