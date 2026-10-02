# tests/ — purpose-driven test organization

Tests are organized by **audience and purpose**, not by technical
layer or tool. The mapping below is binding; `docs/adr/0001` records
it as a repository convention.

```
tests/
├── programmer/    The inner loop. Seconds-fast; drives the TDD cycle
│                  (red/green roughly once per minute). The schema-
│                  pinned contract tests live HERE — one file per
│                  translation contract, every emitted frame parsed
│                  through the @ag-ui/core zod schemas, one negative
│                  case per path. They are the design engine, not a
│                  category.
│
├── application/   The integrator's story, end to end through the
│                  glue recipe from the README: Express hosting
│                  createAdkHttpHandler
│                  (the handler stays web-standard; Express is the
│                  test harness, not the package's API) over the real
│                  @ag-ui/encoder. Two modes: a scripted ADK runner
│                  (deterministic; `npm run test:app`) and real
│                  Gemini (`application-llm` project;
│                  `npm run test:app:llm`, explicit run only, never
│                  in default CI).
│
├── verification/  (future) Performance envelopes and stress. Not
│                  wired yet.
│
├── learning/      Probes of the essential dependencies — @ag-ui/core,
│                  @ag-ui/encoder, @google/adk — each recording a
│                  verified behavior with an evidence pointer
│                  (doc-comment above the test). Real-model probes
│                  are `*.llm.test.ts`, excluded from default runs,
│                  executed only via `npm run test:learning:llm`
│                  (expensive: real Gemini calls).
│
└── fixtures/      Support resource, not a tier: scripted
                   real-ADK-event fixtures recorded from learning
                   probes, consumed by programmer tests.
```

## Why the learning tier exists

This package depends on `@ag-ui/core`, `@ag-ui/encoder`, and
`@google/adk`. When any of them ships a breaking release, the learning
tests break **first** and name the dependency — so a red programmer
tier is known to be our bug, not upstream drift.

## Commands

| Command                     | Tiers exercised                        |
| --------------------------- | -------------------------------------- |
| `npm test`                  | programmer + learning (cheap probes)   |
| `npm run test:app`          | application tier, scripted runner      |
| `npm run test:app:llm`      | application tier, real Gemini          |
| `npm run test:learning:llm` | real-model learning probes only        |
| `npm run verify`            | lint + oxlint + format + tests + build |

## When something is red: reading the tiers

Upstream changes (a new adk-js, a new @ag-ui/core) and our own bugs
light different tiers. The mapping:

| learning | programmer | diagnosis                                                                                     |
| -------- | ---------- | --------------------------------------------------------------------------------------------- |
| red      | red        | dependency drifted. Fix or re-pin first; the red learning test names the behavior that broke. |
| green    | red        | our bug. The dependency is proven healthy; fix our code.                                      |
| red      | green      | drift we do not touch yet. Upgrade deliberately, on our schedule.                             |

Precisely why the tiers split this way:

1. **Type-surface change** (field renamed, type restructured): `tsc`
   fails before any test runs. The compiler is the first tripwire.
2. **Runtime change with compatible types** (the dangerous one):
   `tsc` stays green, and the programmer/application tiers CANNOT
   catch it — they never touch the real runner, so their green means
   "correct for the shapes we recorded", nothing more. Only the
   learning tier runs the real dependency and observes what it
   actually does.
3. **Our own bug**: programmer red while learning green — the
   dependency's load-bearing behaviors are proven intact, so the
   fault is in our code.

Coverage discipline: the tripwire only covers the behaviors it specs.
Every load-bearing runtime behavior the translator starts depending
on gets a learning spec at the moment it is introduced.
