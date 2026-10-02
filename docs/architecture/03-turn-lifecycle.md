# Turn lifecycle

One POST, arrival to last frame. The participants are the folders from
[02-components.md](02-components.md).

```mermaid
sequenceDiagram
    participant C as AG-UI client
    participant H as http/
    participant R as run/
    participant S as session service (port)
    participant T as translation/
    participant A as ADK Runner (port)

    C->>H: POST RunAgentInput
    H->>H: JSON.parse (400 on garbage)
    H->>H: RunAgentInputSchema.safeParse (422 on invalid)
    H->>H: pick encoder (SSE default, protobuf on Accept)
    H->>R: executeRun(deps, input, createTranslator)

    R->>S: getOrCreateThreadSession(threadId)
    S-->>R: session (created once per thread)

    R->>S: stitch tool results (exact id echo, answered once)
    Note over R: no new turn AND no results → RUN_ERROR "nothing to run"

    R->>T: createTranslator(threadId, runId)
    R->>A: runner.runAsync({ newMessage, stateDelta?, runConfig? })

    loop every ADK event
        A-->>T: ADK event
        T-->>R: AG-UI frames
        R-->>C: frames streamed as they arrive
    end

    Note over T: RUN_STARTED lazily on first event<br/>TEXT_MESSAGE_END before TOOL_CALL_START<br/>consolidated replay skipped<br/>RUN_FINISHED exactly once
    A-->>R: stream exhausted
    R->>T: finish()
    T-->>C: RUN_FINISHED

    Note over H,R: runner throws (invocation or mid-stream)<br/>→ RUN_ERROR frame, never a broken connection
```

Each promise in the diagram has a contract test in
`tests/programmer/` (run them with `npm test`):

- One closing frame per run, `RUN_FINISHED` or `RUN_ERROR`, never two
  — `createAdkAgent-errors.contract.test.ts`.
- An empty POST (no new turn, no tool results) gets a schema-valid
  `RUN_ERROR` — `http-handler.contract.test.ts`.
- 400/422 only before the first byte; once streaming starts the
  status is 200 and failures go out as frames.
- Each pull takes one event from the generator; cancelling the stream
  stops the runner.
