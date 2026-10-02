# Architecture

Four short documents, about fifteen minutes total. Read in order:

1. [01-system-context.md](01-system-context.md) — the package as one
   box: what arrives, what it calls, what leaves (C2).
2. [02-components.md](02-components.md) — the folders inside `src/`,
   grouped by layer, with the dependency arrows between them (C3).
3. [03-turn-lifecycle.md](03-turn-lifecycle.md) — one POST from
   arrival to last frame, error paths included.
4. [04-glossary.md](04-glossary.md) — the words this package uses
   with exact meanings.

Then read `src/`. The folder tree matches the diagrams.

Every arrow here is an import edge in the code. If a diagram and an
import disagree, the code wins — fix the doc.
