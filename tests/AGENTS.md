# Test naming rules

- Use `test(...)`, never `it(...)`.
- `describe` takes a noun phrase naming the subject: `RunLifecycleTranslator`, `CreateAdkAgent`.
- Programmer and learning tests: one Given/When/Then sentence per test, `-` separators. Example: `Given a completed ADK run - When the stream is translated - Then the first event is RUN_STARTED carrying threadId and runId`.
- Application tests: short scenario phrase for `test(...)`, phases in `test.step` items prefixed `Given ... / When ... / Then ...`.
- Type the `Then` first, then the `When`, then build the `Given` backward.
- Record discovered wire/behavior truths in a doc-comment above the test, with an evidence pointer (the probe run that observed it, or the dependency source that documents the behavior).
- Contract tests parse every emitted frame through the real `@ag-ui/core` zod schemas and carry one negative case per path (a deliberately malformed frame must throw) — a green suite that never fails on a violation is a smoke test wearing a contract test's name.
- A test fixture is a shape observed on the wire, never invented. Its doc-comment cites where: the learning probe that recorded it, or the documented reference behavior it mirrors.
