---
type: decision-record
title: 'ADR-0001: Package end state — transport-free core + one canonical web-standard server face'
description: Structure, naming, the v0.1 contract set, the direction-of-ownership partition, and the named unimplemented features.
status: accepted
---

# ADR-0001: Package end state

- **Status**: Accepted
- **Date**: 2026-09-30

## Decision

### 1. Structure: core + one canonical server face

- **Core (transport-free)**: `createAdkAgent(options)` →
  `{ run(input: RunAgentInput): AsyncIterable<BaseEvent> }`. Sessions,
  state carrying, and translation live here. Zero HTTP imports.
- **Server face**: `createAdkHttpHandler(adkAgent)` — one adapter over
  the web-standard `Request`/`Response` pair, streaming SSE via
  `@ag-ui/encoder` (protobuf negotiation comes free with the encoder).
  Framework shims (Express, Fastify, Next, Hono, Bun) are documented
  glue, not packages, until a real consumer demands one (Common Reuse
  discipline).
- The adapter transposes the Python reference's FastAPI face to the
  TypeScript world's universal interface (web-standard
  Request/Response).
  Core never learns `Request` exists.

### 2. Naming: TypeScript-idiomatic, collision-free

- Factory functions returning plain objects (`createAdkAgent`,
  `createAdkHttpHandler`); camelCase verbs, PascalCase types.
- No `ADKAgent` class (upstream owns that name for its client-side
  `@ag-ui/adk`); no Python package names beyond the structural mirror.
- npm package name: decided at publish day; `@ag-ui/adk` is taken.

### 3. v0.1 contract set

- **Emitted events**: run lifecycle (`RUN_STARTED`/`RUN_FINISHED`/
  `RUN_ERROR`), text streaming (`TEXT_MESSAGE_START`/`CONTENT`/`END`),
  tool calls (`TOOL_CALL_START`/`ARGS`/`END`). All events built through
  `@ag-ui/core` factories/types only; contract tests pin the wire
  through the package's zod schemas, so a suite cannot pass while
  emitting a fabricated dialect.
- **Inbound state carrying**: client-wins per-run write of
  `input.state` into the ADK session state, nested under a reserved
  root key (`_ag_ui_state`, configurable).
- **Consumption stays app-side**: how an agent reads carried state
  (instruction provider per model call) is application pedagogy,
  documented but not shipped.
- **Outbound agent→client state** (`STATE_SNAPSHOT`/`STATE_DELTA`): a
  named unimplemented slot at the translator's strategy extension
  point; implemented only
  when a consumer exists. Adding it later is additive (one strategy),
  never surgical.

### 4. Direction-of-ownership partition

The wrapper is an Interface Adapter between the AG-UI client state
domain and the ADK session state domain. The reserved root key **is**
the partition: client-owned keys live structurally outside the outbound
channel, so echo suppression and staleness guards are unnecessary by
construction. Applications that never enable the outbound channel are
unaffected either way.

### 5. Named unimplemented features (no speculative machinery)

Per-thread session get-or-create (shipped); HITL/LRO deferral,
capability predicates, multi-framework shim packages, session caching,
A2UI support: each named as an extension point, none built before a consumer
exists.

## Repository conventions (binding for this repo)

- **Test tiers by audience and purpose**: `tests/programmer/` (the TDD
  engine, contract tests included — seconds-fast), `tests/learning/`
  (probes of `@ag-ui/core`, `@ag-ui/encoder`, `@google/adk`; each
  records its discovered behavior in a doc-comment; the real-model
  round-trip probe is `*.llm.test.ts` and runs only explicitly),
  `tests/application/` (the real HTTP face end to end). Learning tests
  exist so that a breaking upstream release breaks the dependency tier
  first — a red programmer tier is then known to be our bug.
- **Test naming**: `test(...)`, never `it(...)`; noun-phrase
  `describe`; one Given/When/Then sentence per programmer/learning
  test.
- **Structure (screaming architecture)**: top-level folders named by
  the product's verbs and contracts — `src/run/`, `src/translation/`,
  `src/http/` — never `core/`, `utils/`, `common/`, `internal/`. Every
  file carries a header sentence naming its purpose ("this file serves …").
  Dependency direction is strictly inward:
  `http/ → run/ → translation/ → protocol.ts → @ag-ui/core`.
  `src/http/createAdkHttpHandler.ts` is the single designated framework
  orchestration adapter; its docstring says so, and nothing else
  imports `Request`/`Response`.
