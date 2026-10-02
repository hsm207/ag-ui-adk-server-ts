/**
 * The agent factory: wires the runner port and the session service
 * into the run orchestration over a per-run translator. The contracts
 * it fulfills — the options a consumer passes, the agent face the
 * handler drives, the ports the run obeys — live in ./contracts.ts.
 */

import type { BaseEvent, RunAgentInput } from '../protocol.js'

import { createEventTranslator } from '../translation/event-translator.js'
import {
  DEFAULT_STATE_ROOT_KEY,
  type AdkAgent,
  type AdkAgentOptions,
  type RunnerLike,
  type SessionServicePort,
} from './contracts.js'
import { executeRun } from './run.js'

const DEFAULT_USER_ID = 'ag-ui-adk-server-ts'
const DEFAULT_OWNING_AGENT = 'agent'

/**
 * The owning agent's name for stitched tool results, derived from the
 * port when it can speak: a real Runner carries its root agent at
 * `agent.name`, and the ADK runner resolves appended-event authors
 * against the agent tree — an unknown author warns 'Event from an
 * unknown agent' and is a mis-routing hazard in multi-agent trees.
 * The option overrides; the neutral default only covers bare ports
 * that expose no name.
 */
const deriveOwningAgent = (port: RunnerLike, override?: string): string => {
  if (override !== undefined) return override
  const name = port.agent?.name
  return typeof name === 'string' && name !== '' ? name : DEFAULT_OWNING_AGENT
}

/**
 * Build the translator core. The runner port is the agent's own
 * runAsync (an LlmAgent-backed Runner provides it); the session
 * service provides per-thread resolution; translation is composed per
 * run.
 */
export const createAdkAgent = (options: AdkAgentOptions): AdkAgent => {
  const runner = options.agent
  const sessionService = options.sessionService as unknown as SessionServicePort
  const userId = options.userId ?? DEFAULT_USER_ID
  const stateRootKey = options.stateRootKey ?? DEFAULT_STATE_ROOT_KEY

  return {
    run: (input: RunAgentInput): AsyncIterable<BaseEvent> =>
      executeRun(
        {
          sessionService,
          runner,
          owningAgent: deriveOwningAgent(options.agent, options.owningAgent),
          appName: options.appName,
          userId,
          stateRootKey,
          ...(options.runConfig !== undefined ? { runConfig: options.runConfig } : {}),
        },
        input,
        createEventTranslator,
      ),
  }
}
