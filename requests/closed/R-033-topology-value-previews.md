# R-033 — Preview topology values through bindings

Status: closed

Selecting a binding such as `screwPoints = rectangle(...).vertices()` displays
the returned vertices. Aliases and collections preserve the actual topology
IDs and their owners, including subsets. The owning geometry is dimmed to keep
the returned topology prominent, both at the value binding and at its accessor
call.

Runtime source-value tracing retains topology references alongside the owning
model snapshots. The viewport renders these values directly; editing IDs at an
accessor remains the responsibility of the existing topology selection tool.
Compiler regression coverage checks bindings, aliases, subsets, and repeated
model occurrences.
