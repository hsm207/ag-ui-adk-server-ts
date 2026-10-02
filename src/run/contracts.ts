/**
 * The contracts of the run context: the types run/ obeys, the types
 * its collaborators must satisfy, and the consumer faces of the
 * agent factory, in one place. Implementation files import from here;
 * file-local shapes stay beside their only consumer. Cross-context
 * imports touch translation/ only through translation/contracts.ts.
 */

import type { BaseEvent, RunAgentInput } from '../protocol.js'
import type { BaseSessionService, RunConfig } from '@google/adk'

/** One session in the ADK session service, as the run context reads it. */
export interface SessionLike {
  readonly id: string
  state: Record<string, unknown>
  events: unknown[]
}

/**
 * The append-event face the stitching port consumes — a supertype of
 * the session service so any SessionServicePort satisfies it.
 */
export interface AppendEventPort {
  appendEvent: (input: { session: SessionLike; event: unknown }) => Promise<void>
}

export interface SessionServicePort extends AppendEventPort {
  getOrCreateSession: (input: {
    appName: string
    userId: string
    sessionId: string
  }) => Promise<SessionLike>
}

/**
 * The runner port the run drives: what a real ADK `Runner` provides
 * (its `runAsync` generator plus the root `agent` whose name session
 * events are authored against). Method syntax on `runAsync` mirrors
 * the SDK's own declaration style so parameter checks stay per-member
 * — a scripted partial runner stays assignable while `runConfig`
 * still checks against the real `RunConfig`. The members are declared
 * explicitly so a consumer passing the wrong object — an LlmAgent has
 * no runAsync — learns at compile time, not deep inside their first
 * request.
 */
export interface RunnerLike {
  /** One ADK run: the scripted conversation turn in, ADK events out. */
  runAsync(input: {
    userId: string
    sessionId: string
    newMessage: { role: 'user'; parts: Array<{ text?: string }> }
    stateDelta?: Record<string, unknown>
    runConfig?: RunConfig
  }): AsyncIterable<unknown>
  /** The root agent of the runner tree, if the port exposes it. */
  agent?: { name?: unknown }
}

/** Everything one run needs from the agent factory: ports and identity. */
export interface RunDeps {
  readonly sessionService: SessionServicePort
  readonly runner: RunnerLike
  readonly owningAgent: string
  readonly appName: string
  readonly userId: string
  readonly stateRootKey: string
  /** Verbatim consumer runConfig for every runner invocation (optional). */
  readonly runConfig?: RunConfig
}

/** The AG-UI client state rides into the session under this root key. */
export const DEFAULT_STATE_ROOT_KEY = '_ag_ui_state'

/** Construction options for the translator core. */
export interface AdkAgentOptions {
  /** The ADK runner to drive (a `Runner`, or any `RunnerLike` port). */
  readonly agent: RunnerLike
  /** ADK application name the runner is scoped to. */
  readonly appName: string
  /** Session persistence port; per-thread get-or-create runs over it. */
  readonly sessionService: BaseSessionService
  /**
   * Reserved root key partitioning client-owned state from anything
   * the agent may write. Defaults to `_ag_ui_state`.
   */
  readonly stateRootKey?: string
  /**
   * The user id ADK sessions are scoped to. Defaults to a package
   * constant — the thread is the conversation identity, the user is
   * the deployment's concern.
   */
  readonly userId?: string
  /**
   * Verbatim runConfig handed to every runner invocation — the
   * streaming and HITL knobs ride through unwrapped. Omitted: the
   * runner's own defaults govern.
   */
  readonly runConfig?: RunConfig
  /**
   * The author stamped on appended FunctionResponse events. Defaults
   * to the runner port's own agent name (a real Runner exposes its
   * root agent there), because the ADK runner resolves appended-event
   * authors against its tree — a phantom author warns ('Event from
   * an unknown agent') and mis-routes resumption in multi-agent
   * trees. The neutral 'agent' covers only bare ports without a
   * name. Authorship does not gate continuation, but it does route
   * it.
   */
  readonly owningAgent?: string
}

/** The run face: one conversation turn in, one event stream out. */
export interface AdkAgent {
  run: (input: RunAgentInput) => AsyncIterable<BaseEvent>
}
