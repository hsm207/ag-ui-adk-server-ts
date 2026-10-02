# Components (C3 view)

Two views over the same folders. Vendor packages (`@google/adk`,
`@ag-ui/*`) sit outside every subgraph — they are not ours.

## Runtime

Value imports — the code that actually loads:

```mermaid
flowchart LR
    subgraph httpc["http/"]
        http["createAdkHttpHandler"]
    end

    subgraph runc["run/"]
        factory["createAdkAgent"]
        orchestrator["run.ts (executeRun)"]
        sessions["adk-sessions · tool-results · state-carrying"]
    end

    subgraph trc["translation/"]
        translator["event-translator"]
        mappings["run-lifecycle · text-message · tool-call"]
    end

    runC["run/contracts"]
    proto["protocol.ts (root)"]
    adkV["@google/adk"]
    aguiV["@ag-ui/core · @ag-ui/encoder"]

    http -- "EventType, RunAgentInputSchema" --> proto
    http -- "EventEncoder" --> aguiV
    factory -- "executeRun" --> orchestrator
    factory -- "injects createEventTranslator" --> translator
    factory -- "DEFAULT_STATE_ROOT_KEY" --> runC
    orchestrator --> sessions
    sessions -- "createEvent" --> adkV
    translator --> mappings
    mappings -- "EventType" --> proto
```

Two runtime paths into vendors, no shortcuts: ADK's runtime
(`createEvent`) is touched only by `run/tool-results`; AG-UI's runtime
(`EventType`, the encoder) only by `protocol.ts` and `http/`.

## Compile time

`import type` edges and structural shapes — erased at runtime, nothing
loads:

```mermaid
flowchart LR
    httpT["http/"]
    runT["run/"]
    trT["translation/"]

    runC["run/contracts"]
    trC["translation/contracts"]
    proto["protocol.ts"]
    adkT["@google/adk types
(BaseSessionService, RunConfig)"]
    adkShape["@google/adk Event
(shape only — no import)"]
    aguiT["@ag-ui/core types
(BaseEvent, RunAgentInput, …)"]

    httpT -- "AdkAgent" --> runC
    runT -- "RunDeps, RunnerLike, SessionLike" --> runC
    runT -- "RunTranslator (the injected seam's type)" --> trC
    trT -- "TranslationState" --> trC
    runC -- "BaseEvent, RunAgentInput" --> proto
    trC -- "BaseEvent" --> proto
    proto -- "re-exports" --> aguiT
    runC -- "imports" --> adkT
    trT -- "reads Event fields structurally" --> adkShape
```

Notes:

- `translation/` never imports `@google/adk`, not even as a type. It
  reads ADK events through a local structural type (`AdkEventLike`):
  any object with those fields translates, ADK's own events included.
  The shapes are pinned by the real-Gemini probes in
  `tests/learning/`, which go red if adk-js changes them.
- `protocol.ts` is the only file that imports `@ag-ui/core`; every
  other module gets its protocol types from it.
- The injected seam: `run/run.ts` knows the translator only as the
  `RunTranslator` type; `createAdkAgent` supplies the concrete
  factory. `run/` would run unchanged against a different translator.
