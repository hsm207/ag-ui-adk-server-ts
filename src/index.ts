/**
 * The public surface: the transport-free core (createAdkAgent) and the
 * one canonical server face (createAdkHttpHandler), plus the protocol
 * types and the event translator factory — the named extension point
 * for future outbound-state strategies.
 */

export { createAdkAgent } from './run/createAdkAgent.js'

export { DEFAULT_STATE_ROOT_KEY, type AdkAgent, type AdkAgentOptions } from './run/contracts.js'

export { createAdkHttpHandler } from './http/createAdkHttpHandler.js'

export { createEventTranslator } from './translation/event-translator.js'

export type { RunTranslator } from './translation/contracts.js'

export type {
  BaseEvent,
  RunAgentInput,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
} from './protocol.js'

export { EventType, RunAgentInputSchema } from './protocol.js'
