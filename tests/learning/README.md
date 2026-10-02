# tests/learning/

Probes of the essential dependencies: `@ag-ui/core`,
`@ag-ui/encoder`, `@google/adk` (pinned). A probe exists to observe
real behavior, never to guess it. Probe against a REAL model/runtime
before asserting how it behaves.

## Rules

- Every probe records its findings as a **verified behavior**: a
  doc-comment above the test stating the behavior, the evidence
  (pinned source file + line, or the observed probe run), and the
  date.
- A fixture in `tests/fixtures/` enters only after a learning probe
  observed the real shape on the wire — never invented.
- Real-model probes (`*.llm.test.ts`) are expensive and run ONLY via
  `npm run test:learning:llm`, never in default suites or CI.
- Cheap probes (schema validation, encoder output, request-builder
  behavior against recorded shapes) run with `npm test` and act as the
  upstream-breakage tripwire: when a dependency ships a breaking
  release, this tier breaks first and names it.
- **A probe never answers a question the pinned dependency's source
  already answers** (the schemas' required/loose fields, an error
  message's wording) — that is re-testing the framework, redundant
  with reading the source. A probe asserts a load-bearing BEHAVIOR
  our code depends on, as an upgrade tripwire, cited to the evidence
  of its discovery. API surfaces `tsc` already checks need no
  tripwire; runtime semantics `tsc` cannot see do.
