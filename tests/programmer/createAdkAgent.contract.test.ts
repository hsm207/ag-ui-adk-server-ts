import { describe, expect, test } from 'vitest'

import { EventSchema } from '@ag-ui/core/schemas'
import { StreamingMode } from '@google/adk'

import { InMemorySessions, userTurn } from '../fixtures/session-service.ts'
import type { BaseEvent, RunAgentInput } from '../../src/protocol.ts'
import { createAdkAgent } from '../../src/run/createAdkAgent.ts'
import type { AdkAgentOptions } from '../../src/run/contracts.ts'
import { DEFAULT_STATE_ROOT_KEY } from '../../src/run/contracts.ts'

/*
 * Evidenced composition mechanics (cited, not tested here): the
 * runner only executes inside `if (newMessage)` (verified behavior 2); a
 * client's tool result enters as an appended FunctionResponse with
 * the exact pending call id (verified behavior 5); the continuation turn
 * carries an empty-text message; client state rides the runner's
 * stateDelta under a reserved root key (observed against real
 * Gemini, 2026-09-30). The fake session service stands in for
 * BaseSessionService at exactly those calls, and the scripted runner
 * applies the same effects the real Runner does (append the turn,
 * apply stateDelta).
 */

const makeAgent = (options: Partial<AdkAgentOptions> & { rootAgentName?: string } = {}) => {
  const sessions = new InMemorySessions()
  const runnerInvocations: Array<{
    runConfig?: unknown
    stateDelta?: Record<string, unknown> | undefined
  }> = []
  const scriptedResponses = new Map<
    string,
    Array<{ text: string; functionCalls?: Array<{ id: string; name: string; args?: unknown }> }>
  >()
  let pendingSession: Promise<unknown> | undefined = undefined
  const requirePendingSession = (): Promise<unknown> => {
    if (pendingSession === undefined) throw new Error('setPendingSession was never called')
    return pendingSession
  }
  const scriptedRunner: {
    runAsync(input: {
      sessionId: string
      newMessage: { parts: Array<{ text?: string }> }
      stateDelta?: Record<string, unknown>
      runConfig?: unknown
    }): AsyncGenerator<unknown>
    agent?: { name: string }
  } = {
    /** Scripted runner: faithful effects, then the scripted response. */
    runAsync: (input) => {
      runnerInvocations.push({ runConfig: input.runConfig, stateDelta: input.stateDelta })
      const text = input.newMessage.parts.map((part) => part.text ?? '').join('')
      const script = scriptedResponses.get(text)?.shift() ?? { text: `echo:${text}` }
      const event = {
        author: 'widget_agent',
        content: {
          parts: [
            ...(script.functionCalls ?? []).map((call) => ({ functionCall: call })),
            ...(script.text !== '' ? [{ text: script.text }] : []),
          ],
        },
      }
      const effects = requirePendingSession().then((session) =>
        sessions.invokeRunnerEffects(session as never, input, event as never),
      )
      return (async function* () {
        await effects
        yield event
        yield { author: 'widget_agent', turnComplete: true }
      })()
    },
  }
  // The scripted runner may carry the root agent's name the way a
  // real Runner does (agent.name) — how the wrapper derives the
  // owning agent for stitched results.
  if (options.rootAgentName !== undefined) scriptedRunner.agent = { name: options.rootAgentName }
  const { rootAgentName: _ignored, ...adkOptions } = options
  const agent = createAdkAgent({
    ...adkOptions,
    agent: scriptedRunner,
    appName: 'test-app',
    sessionService: sessions as unknown as AdkAgentOptions['sessionService'],
  })
  return {
    agent,
    sessions,
    runnerInvocations,
    scriptedResponses,
    setPendingSession: (p: Promise<unknown>) => {
      pendingSession = p
    },
  }
}

const input = (overrides: Partial<RunAgentInput> = {}): RunAgentInput => ({
  threadId: 'thread-w',
  runId: 'run-w',
  messages: [userTurn('Please turn the button red.')],
  tools: [],
  context: [],
  ...overrides,
})

describe('CreateAdkAgent', () => {
  test('Given RunAgentInput.state - When a run starts - Then the ADK session carries it under the reserved root key', async () => {
    const { agent, sessions, runnerInvocations, setPendingSession } = makeAgent()
    setPendingSession(
      sessions.getOrCreateSession({ appName: 'test-app', userId: 'u', sessionId: 'thread-w' }),
    )

    for await (const _frame of agent.run(input({ state: { canvas: { buttonColor: 'blue' } } }))) {
      void _frame
    }

    const session = await sessions.getOrCreateSession({
      appName: 'test-app',
      userId: 'u',
      sessionId: 'thread-w',
    })
    expect(session.state[DEFAULT_STATE_ROOT_KEY]).toEqual({ canvas: { buttonColor: 'blue' } })
    expect(runnerInvocations[0]?.stateDelta).toEqual({
      [DEFAULT_STATE_ROOT_KEY]: { canvas: { buttonColor: 'blue' } },
    })
  })

  test('Given a repeat threadId - When a run starts - Then the existing session is resumed (get-or-create), never recreated', async () => {
    const { agent, sessions, setPendingSession } = makeAgent()
    setPendingSession(
      sessions.getOrCreateSession({ appName: 'test-app', userId: 'u', sessionId: 'thread-w' }),
    )

    for await (const _frame of agent.run(input())) {
      void _frame
    }
    for await (const _frame of agent.run(input({ runId: 'run-w2' }))) {
      void _frame
    }

    expect(sessions.createdCount).toBe(1)
  })

  test('Given the stream ends - When the run is consumed - Then RUN_STARTED and RUN_FINISHED bracket the frames and every frame schema-parses', async () => {
    const { agent, setPendingSession } = makeAgent()
    setPendingSession(Promise.resolve({ id: 'thread-w', state: {}, events: [] }))
    const frames: BaseEvent[] = []
    for await (const frame of agent.run(input())) {
      frames.push(frame)
    }

    expect(frames[0]).toMatchObject({ type: 'RUN_STARTED', threadId: 'thread-w', runId: 'run-w' })
    expect(frames.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      threadId: 'thread-w',
      runId: 'run-w',
    })
    for (const frame of frames) {
      expect(EventSchema.parse(frame)).toBeDefined()
    }
  })

  test(
    'Given a pending client-proxied tool call from a previous run and the client result in this run messages - ' +
      'When the run starts - Then the result is appended as a FunctionResponse with the exact call id and the runner gets the empty-text continuation turn',
    async () => {
      const { agent, sessions, scriptedResponses, setPendingSession } = makeAgent()
      scriptedResponses.set('Please turn the button red.', [
        {
          text: '',
          functionCalls: [{ id: 'call_pending', name: 'set_button_color', args: { color: 'red' } }],
        },
      ])
      setPendingSession(
        sessions.getOrCreateSession({ appName: 'test-app', userId: 'u', sessionId: 'thread-w' }),
      )
      for await (const _frame of agent.run(input())) {
        void _frame
      }
      const session = await sessions.getOrCreateSession({
        appName: 'test-app',
        userId: 'u',
        sessionId: 'thread-w',
      })
      expect(sessions.functionCallIds(session)).toEqual(['call_pending'])

      setPendingSession(Promise.resolve(session))
      const frames: BaseEvent[] = []
      for await (const frame of agent.run(
        input({
          runId: 'run-w3',
          messages: [
            {
              id: 'msg_tool_pending',
              role: 'tool',
              toolCallId: 'call_pending',
              content: JSON.stringify({ status: 'done', color: 'red' }),
            },
          ],
        }),
      )) {
        frames.push(frame)
      }

      expect(sessions.functionResponseIds(session)).toEqual(['call_pending'])
      expect(frames.at(-1)).toMatchObject({ type: 'RUN_FINISHED' })
    },
  )

  test(
    'Given a tool result already answered once - When the same result is re-delivered in a later run - ' +
      'Then no duplicate FunctionResponse is appended (an id is answered exactly once)',
    async () => {
      const { agent, sessions, scriptedResponses, setPendingSession } = makeAgent()
      scriptedResponses.set('Please turn the button red.', [
        {
          text: '',
          functionCalls: [{ id: 'call_dup', name: 'set_button_color', args: { color: 'red' } }],
        },
      ])
      setPendingSession(
        sessions.getOrCreateSession({ appName: 'test-app', userId: 'u', sessionId: 'thread-w' }),
      )
      for await (const _frame of agent.run(input())) {
        void _frame
      }
      const session = await sessions.getOrCreateSession({
        appName: 'test-app',
        userId: 'u',
        sessionId: 'thread-w',
      })

      const toolResult = {
        id: 'msg_tool_dup',
        role: 'tool' as const,
        toolCallId: 'call_dup',
        content: JSON.stringify({ status: 'done', color: 'red' }),
      }
      setPendingSession(Promise.resolve(session))
      for await (const _frame of agent.run(input({ runId: 'run-d1', messages: [toolResult] }))) {
        void _frame
      }
      setPendingSession(Promise.resolve(session))
      for await (const _frame of agent.run(input({ runId: 'run-d2', messages: [toolResult] }))) {
        void _frame
      }

      expect(sessions.functionResponseIds(session)).toEqual(['call_dup'])
    },
  )

  test('Given runConfig is not configured - When a run starts - Then the runner invocation carries no runConfig (ADK defaults govern)', async () => {
    const { agent, runnerInvocations, setPendingSession } = makeAgent()
    setPendingSession(Promise.resolve({ id: 'thread-w', state: {}, events: [] }))

    for await (const _frame of agent.run(input())) {
      void _frame
    }

    expect(runnerInvocations[0]?.runConfig).toBeUndefined()
  })

  test('Given a runConfig - When a run starts - Then every runner invocation carries it verbatim (the streaming and HITL knobs ride through)', async () => {
    const { agent, runnerInvocations, setPendingSession } = makeAgent({
      runConfig: { streamingMode: StreamingMode.SSE, pauseOnToolCalls: true },
    })
    setPendingSession(Promise.resolve({ id: 'thread-w', state: {}, events: [] }))

    for await (const _frame of agent.run(input())) {
      void _frame
    }

    expect(runnerInvocations[0]?.runConfig).toEqual({
      streamingMode: StreamingMode.SSE,
      pauseOnToolCalls: true,
    })
  })

  test(
    'Given a runner port exposing its root agent and a stitched tool result - When the result is appended - ' +
      "Then the FunctionResponse is authored by the runner's real agent name (the name the ADK runner resolves against the tree)",
    async () => {
      const { agent, sessions, scriptedResponses, setPendingSession } = makeAgent({
        rootAgentName: 'greeter',
      })
      scriptedResponses.set('Please turn the button red.', [
        {
          text: '',
          functionCalls: [{ id: 'call_author', name: 'set_button_color', args: { color: 'red' } }],
        },
      ])
      setPendingSession(
        sessions.getOrCreateSession({ appName: 'test-app', userId: 'u', sessionId: 'thread-w' }),
      )
      for await (const _frame of agent.run(input())) {
        void _frame
      }
      const session = await sessions.getOrCreateSession({
        appName: 'test-app',
        userId: 'u',
        sessionId: 'thread-w',
      })

      setPendingSession(Promise.resolve(session))
      for await (const _frame of agent.run(
        input({
          runId: 'run-author',
          messages: [
            { id: 'msg_tool_author', role: 'tool', toolCallId: 'call_author', content: '{}' },
          ],
        }),
      )) {
        void _frame
      }

      const responseAuthor = (
        session.events as Array<{
          author?: string
          content?: { parts?: Array<{ functionResponse?: unknown }> }
        }>
      ).find((event) => event.content?.parts?.[0]?.functionResponse)?.author
      expect(responseAuthor).toBe('greeter')
    },
  )
})
