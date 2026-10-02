# System context (C2 view)

```mermaid
flowchart LR
    client["AG-UI client
(CopilotKit widget, or any
RunAgentInput producer)"]

    pkg["ag-ui-adk-server-ts"]

    adk["@google/adk
(Runner + SessionService)"]

    model["Gemini
(via Vertex AI)"]

    client -- "POST RunAgentInput (JSON)" --> pkg
    pkg -- "SSE or protobuf (AG-UI events)" --> client
    pkg -- "one turn per POST" --> adk
    adk -- "model calls (streaming)" --> model
    adk -- "ADK events" --> pkg
    pkg -- "session get-or-create,
tool-result appends" --> adk
```

The package accepts an AG-UI `RunAgentInput` over HTTP, runs one ADK
agent turn, and streams the turn back as AG-UI events.

- Transport is the web-standard `Request`/`Response`. The README shows
  an Express bridge; any server that can hand over a `Request` and
  send back the `Response` works.
- SSE by default; protobuf when the client's `Accept` header asks
  (both via `@ag-ui/encoder`).
- Model auth is yours to set up: construct the model and `Runner` —
  ADC, API key, whatever the deployment uses — and hand the runner to
  `createAdkAgent`. The package never sees credentials.
- Conversation memory lives in the ADK session service you provide to
  `createAdkAgent`. The client's UI state rides into the session each
  run under `DEFAULT_STATE_ROOT_KEY`.
