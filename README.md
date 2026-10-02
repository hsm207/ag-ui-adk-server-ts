# Server-side ADK → AG-UI Translator for TypeScript

`@hsm207/ag-ui-adk-server-ts` serves a [Google ADK](https://github.com/google/adk-js) agent over an AG-UI endpoint. A client posts one conversation turn; the server answers with a stream of AG-UI events. The package is written in TypeScript and has no framework dependency.

## Why it exists

An AG-UI client such as CopilotKit exchanges AG-UI protocol messages. An ADK agent produces ADK events. The two do not interoperate on their own, so something has to translate between them. This package does that on the server: it accepts an AG-UI `RunAgentInput`, runs one turn of the agent, and converts each ADK event into an AG-UI frame as the events arrive.

The package was written because no standalone TypeScript AG-UI backend existed. It runs on your server: the model call and the credentials stay there, and the browser receives AG-UI events only. No official package does this for a plain Node server.

The package calls the real ADK `Runner` rather than reimplementing it, so plugins, services, model routing, and session management keep working. The core is an async iterable and the handler uses the web-standard `Request`/`Response` pair, so the package runs on Hono, Bun, Deno, and Next.js route handlers, or on Express with ten lines of adapter code.

The package guarantees the following. Every frame passes the `@ag-ui/core` schemas. Every run closes with exactly one closing frame. Every tool call is answered exactly once. A slow consumer applies backpressure instead of losing the connection, and a failure mid-stream is sent as a `RUN_ERROR` frame.

CopilotKit's client libraries are open source, but they require their runtime: an agent registry, per-request agent clones, and an RxJS push model. This package depends on `@ag-ui/core`, `@ag-ui/encoder`, and `@google/adk`.

### Related packages

- [`@ag-ui/adk-js`](https://www.npmjs.com/package/@ag-ui/adk-js) — the official AG-UI integration: runs an ADK JavaScript `Runner` as an AG-UI agent inside CopilotKit's runtime. Requires `@ag-ui/client` and `rxjs` as peer dependencies.
- [`@ag-ui/adk`](https://www.npmjs.com/package/@ag-ui/adk) — the official TypeScript HTTP client for the Python `adk-middleware` server. A client, not a server.

The package has two parts:

- `createAdkAgent(options)` is the transport-free core. `run(RunAgentInput)` returns an async iterable of AG-UI events. The core owns per-thread ADK sessions (get-or-create over `BaseSessionService`), carries client state under a reserved root key (client-wins), and appends tool results for client-proxied, long-running tools. Zero HTTP imports.
- `createAdkHttpHandler(adkAgent)` is the server handler over the web-standard `Request`/`Response` pair. It validates the posted `RunAgentInput` (400 for malformed JSON, 422 for schema-invalid, both before the stream starts), picks the response dialect from the request's `Accept` header (SSE by default, the AG-UI protobuf media type on request), streams the encoded events, and reports mid-stream failures as `RUN_ERROR` frames instead of a broken socket.

## Quickstart

```bash
npm install github:hsm207/ag-ui-adk-server-ts
```

The package is published as a GitHub repository rather than to a registry. npm builds it from the repository on install, so the git URL above is the whole install step.

The package drives `@google/adk` (v2.1+) and emits `@ag-ui/core` (v1.x).

```ts
import { createAdkAgent, createAdkHttpHandler } from '@hsm207/ag-ui-adk-server-ts'

// Build your ADK agent and runner as usual, then:
const adkAgent = createAdkAgent({
  agent: runner, // a Runner (or any RunnerLike: runAsync + agent.name)
  appName,
  sessionService, // pass the SAME instance the runner uses
})

// Anywhere a web-standard handler fits:
export const POST = createAdkHttpHandler(adkAgent)
```

One POST, from arrival to the last frame:

```
POST /agui ──▶ 400 malformed JSON · 422 schema-invalid   (both before the stream)
            └─▶ 200, the stream begins
                  RUN_STARTED
                  TEXT_MESSAGE_START → CONTENT → END
                  TOOL_CALL_START → ARGS → END
                  RUN_FINISHED | RUN_ERROR   (exactly one closing frame, always)
```

## Usage

Build an ADK agent and runner as usual, hand the runner to `createAdkAgent`, and expose the handler on any framework that speaks web-standard `Request`/`Response` (Hono, Bun, Deno, Next.js route handlers) or bridge it into Express-style middleware:

```ts
import {
  createAdkAgent,
  createAdkHttpHandler,
  DEFAULT_STATE_ROOT_KEY,
} from '@hsm207/ag-ui-adk-server-ts'
import { Gemini, InMemorySessionService, LlmAgent, Runner } from '@google/adk'

const model = new Gemini({ model: 'gemini-2.0-flash' })
const agent = new LlmAgent({
  name: 'assistant',
  model,
  instruction: 'You are a helpful assistant.',
})

const appName = 'my-app'
const sessionService = new InMemorySessionService()
const runner = new Runner({ appName, agent, sessionService })

const adkAgent = createAdkAgent({
  agent: runner, // a Runner (or any RunnerLike: runAsync + agent.name)
  appName,
  sessionService, // pass the SAME instance the runner uses
  // optional knobs:
  // stateRootKey  — root key partitioning client state (default '_ag_ui_state')
  // userId        — ADK session scope (default 'ag-ui-adk-server-ts')
  // runConfig     — verbatim ADK runConfig, e.g. { streamingMode: 'SSE' }
  // owningAgent   — author for stitched tool results (default: runner's agent.name)
})

// Anywhere a web-standard handler fits:
export const POST = createAdkHttpHandler(adkAgent)

// Express-style bridging (the handler's API stays Request/Response):
//
//   app.post('/agui', async (req, res) => {
//     const webReq = new Request('http://localhost/agui', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(req.body),
//     })
//     const webRes = await createAdkHttpHandler(adkAgent)(webReq)
//     res.status(webRes.status)
//     webRes.headers.forEach((value, key) => res.setHeader(key, value))
//     const reader = webRes.body!.getReader()
//     for (;;) {
//       const { done, value } = await reader.read()
//       if (done) break
//       res.write(value)
//     }
//     res.end()
//   })
```

### Reading client state inside the agent

The AG-UI client's state arrives in the session under `DEFAULT_STATE_ROOT_KEY` (`_ag_ui_state`). Read it in an instruction provider or callback:

```ts
const state = context.state as Record<string, unknown>
const canvas = state[DEFAULT_STATE_ROOT_KEY] as { layout?: string } | undefined
```

### Client-proxied tools

Declare a `LongRunningFunctionTool` for any tool the client executes (a UI change, a browser action). The package leaves the call pending on the stream, and when the client re-posts the result as a `tool` message it is appended to the ADK session — exact call-id echo, answered once, authored by the owning agent — and the continuation turn is sent automatically.

## Behavior contract

- One AG-UI thread (`threadId`) = one ADK session; history accumulates once per thread even though clients re-post full history.
- The first frame is always `RUN_STARTED`; the last is always `RUN_FINISHED` or `RUN_ERROR` — a consumer never sees a run without a closing frame.
- Client state is carried per run under the reserved root key and replaces the previous payload wholesale (client-wins, no merge).
- A POST with no new user utterance and no pending tool result is refused as `RUN_ERROR` (`nothing to run`), never as an empty run.
- Stale or already-answered tool call ids are skipped, not appended — a duplicate follow-up cannot double-answer a call.

## What's not built yet

Named extension points, implemented only when a consumer exists (ADR-0001):

- Outbound agent→client state (`STATE_SNAPSHOT`/`STATE_DELTA`) — an unimplemented strategy at the translator's extension point.
- Framework shim packages (Express, Fastify, Next, Hono, Bun) — documented adapter code, not packages.
- HITL/LRO deferral, capability predicates, session caching, A2UI support.

## Development

```bash
npm install
npm run verify          # lint + oxlint + format + tests + build
npm test                # programmer + learning tiers
npm run test:app        # application tier (real HTTP face end to end)
npm run test:learning:llm   # real-LLM probes (expensive; explicit only)
```

Working conventions live in `AGENTS.md`.

## Docs & decisions

- `docs/architecture/` — system context, components, turn lifecycle, glossary. Start here when onboarding.
- `docs/adr/0001-package-end-state.md` — the ADR that defines the package: structure, naming, the v0.1 contract set, the partition, and the named unimplemented features.

## License

MIT
