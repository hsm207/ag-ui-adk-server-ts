import { describe, expect, test } from 'vitest'

import { InMemorySessionService, LlmAgent, Runner, StreamingMode } from '@google/adk'
import type { RunConfig } from '@google/adk'

import { createAdkAgent } from '../../src/run/createAdkAgent.ts'

/*
 * Verified behavior (learning probe, @google/adk 2.1): a real Runner
 * satisfies RunnerLike only when the port declares the runner's
 * actual calling convention — `newMessage` is REQUIRED (its
 * `Content` parameter type has no optional marker) and its parts
 * must be a MUTABLE array (`Content.parts` is `Part[]`; a
 * ReadonlyArray is not assignable). Discovered when a real app's
 * `tsc --noEmit` rejected 0.1.2's RunnerLike while every scripted
 * tier stayed green: the scripted fixtures parameterized newMessage
 * wider than the real runner (optional, readonly), masking the
 * mismatch — the scripted tiers never prove assignability of the
 * real Runner, only this probe does.
 *
 * `RunConfig` rides the same edge: the wrapper's runConfig option
 * must accept what the SDK's own enum and field set produce
 * (StreamingMode.SSE, pauseOnToolCalls), checked here at the type
 * level the way a consumer writes it.
 */

describe('RunnerLike', () => {
  test(
    'Given a real Runner built over an InMemorySessionService - ' +
      'When the Runner is passed to createAdkAgent - ' +
      'Then it is accepted as a RunnerLike port at compile time',
    () => {
      const sessionService = new InMemorySessionService()
      const agent = new LlmAgent({
        name: 'probe-agent',
        model: 'gemini-2.0-flash',
        instruction: 'Reply with the single word ok.',
      })
      const runner = new Runner({ appName: 'runner-port-probe', agent, sessionService })

      const adkAgent = createAdkAgent({
        agent: runner,
        appName: 'runner-port-probe',
        sessionService,
      })

      expect(typeof adkAgent.run).toBe('function')
    },
  )

  test(
    'Given the SDK streaming knobs a consumer sets - ' +
      'When a runConfig is built with StreamingMode.SSE and pauseOnToolCalls - ' +
      'Then it typechecks as the RunConfig the wrapper forwards verbatim',
    () => {
      const runConfig: RunConfig = { streamingMode: StreamingMode.SSE, pauseOnToolCalls: true }

      expect(runConfig.streamingMode).toBe('sse')
      expect(runConfig.pauseOnToolCalls).toBe(true)
    },
  )
})
