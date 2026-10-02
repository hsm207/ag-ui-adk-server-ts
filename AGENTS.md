# ag-ui-adk-server-ts

Server-side ADK → AG-UI protocol translator. The binding decisions
live in `docs/adr/0001-package-end-state.md` (structure, naming,
v0.1 contract set, test tiers); this file is the working digest.

## Communication

Replies in plain engineering language. Answer first, details on
request; short paragraphs; bullets for paths and commands.

## Commands

- `npm run verify` — the gate: tsc, oxlint, format check, tests,
  build. Green before every commit.
- `npm test` — programmer + learning tiers (vitest).
- `npm run test:learning:llm` — real-model probes. Expensive; run
  only when explicitly asked; never in default CI.
- Tarball rule: `npm pack` after `npm run build`, never before —
  and verify the packed bytes, not the working tree (untar and grep
  the artifact). Two shipped tarballs have gone out stale: comments
  edited after the last build, or `dist/` rebuilt after the pack.
  Re-packing the same version does not fix a stale `package-lock`
  integrity pin on the consumer side — bump the version instead.

## Code style

- TypeScript strict tiers; check `tsconfig.json` before weakening
  anything.
- Imports use explicit extensions where the compiler requires them;
  the build (`tsc`) is the arbiter.
- TSDoc every exported symbol in `src/` before commit.
- Every file carries a header sentence naming its purpose: "this file
  serves …". Role-word modules (`utils`, `helpers`, `common`) are
  banned by ADR-0001.

## Testing

- Tiers are by audience and purpose (ADR-0001; `tests/README.md`):
  `tests/programmer/` is the seconds-fast TDD engine and holds the
  schema-pinned contract tests; `tests/learning/` probes
  `@ag-ui/core`, `@ag-ui/encoder`, and `@google/adk`, recording wire
  truths with evidence pointers; `tests/application/` exercises the
  real HTTP face end to end; `tests/fixtures/` is a support
  resource, not a tier.
- `test(...)`, never `it(...)`; one Given/When/Then sentence per
  programmer/learning test; verified behaviors in doc-comments above
  the test.
- Contract tests parse every emitted frame through the real
  `@ag-ui/core` zod schemas and carry one negative case per path.
- Real-model probes are `*.llm.test.ts` and run only via
  `npm run test:learning:llm`.

## Structure

- Top level screams the product: `src/run/`, `src/translation/`,
  `src/http/`, `src/protocol.ts`. No `core/`, `utils/`, `common/`,
  `internal/`.
- Dependency direction is strictly inward:
  `http/ → run/ → translation/ → protocol.ts → @ag-ui/core`.
- `src/http/createAdkHttpHandler.ts` is the single designated
  framework orchestration adapter (Clean Architecture Stage 5
  clause 6); nothing else imports `Request`/`Response`.

## Security

- LLM calls run server-side only. This package never ships API keys
  or credentials; consumers provide their own via ADC or their
  runner configuration.

## Public hygiene

- Commit messages and code carry no private session references: no
  internal tracker codes, no internal document names.
