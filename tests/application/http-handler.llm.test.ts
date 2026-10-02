/**
 * Application tier, real-model mode: the handler end to end against
 * REAL Gemini (ADC-only Vertex, the certified learning-harness
 * instrument). REAL LLM CALLS — expensive. Lives in a *.llm.test.ts
 * file, which the application project excludes; run it explicitly via
 * `npm run test:app:llm`.
 *
 * Covers the features a consuming BFF relies on, in one conversation
 * shape each:
 * 1. Run lifecycle + text streaming + state carrying: a streaming
 *    runConfig must produce TEXT_MESSAGE_CONTENT deltas (streamingMode
 *    NONE buffers the whole turn into one — adk-js
 *    core/src/agents/run_config.ts), and the client state must reach
 *    the model: the probe plays the consuming app by reading the
 *    reserved root key in an instruction provider (consumption is
 *    app-side pedagogy (the package carries, the app
 *    reads). Progressive streaming is the pinned contract; the CHUNK
 *    COUNT is the model's pacing and is asserted only as presence.
 * 2. Tool calls: a client-proxied set_button_color tool declared
 *    long-running (pending is opt-in — adk-js
 *    core/src/agents/functions.ts), paused via runConfig
 *    pauseOnToolCalls (llm_agent.ts: endInvocation right after the
 *    call event), then the client result re-posted as a tool message —
 *    the handler stitches it with the exact id echo (a mismatched id
 *    is fatal at request-build time, the package's verified behavior 5) and
 *    the continuation turn completes. The session-service assertions
 *    re-fetch the current log before asserting: the real service
 *    returns snapshots, so a reference held across runs goes stale.
 *
 * Runs the real handler over real HTTP: Express hosts it exactly as
 * the scripted-mode harness does (the shared bridge fixture — the
 * glue recipe a consuming BFF runs); the deterministic scripted suite
 * proves OUR glue so a failure here is never confused with a model
 * hiccup.
 */

import { describe, expect, test } from 'vitest'

import { EventSchema } from '@ag-ui/core/schemas'
import { z } from 'zod'
import { FunctionTool, InMemorySessionService, StreamingMode } from '@google/adk'
import type { Event as AdkEvent } from '@google/adk'

import { createAdkAgent } from '../../src/run/createAdkAgent.ts'
import { DEFAULT_STATE_ROOT_KEY } from '../../src/run/contracts.ts'
import { createAdkHttpHandler } from '../../src/http/createAdkHttpHandler.ts'
import { bridgeToExpress, listen, parseFrame, postSse } from '../fixtures/express-bridge.ts'
import { createProbe } from '../learning/harness.ts'

const PORT = 4321
const AGENT_NAME = 'widget_agent'
const TOOL_NAME = 'set_button_color'
const TOOL_RESULT = { status: 'done', color: 'red' }
const DEFAULT_USER_ID = 'ag-ui-adk-server-ts'
const APP_NAME = 'app-llm'
const STATE_TIMEOUT_MS = 120_000

interface Frame {
  readonly type: string
  readonly delta?: string
  readonly toolCallId?: string
  readonly toolCallName?: string
}

/**
 * Client-proxied tool: the client owns execution; the long-running
 * declaration with a null executor is the only shape that leaves the
 * call pending on pinned adk-js (verified behavior 1).
 */
const setButtonColor = new FunctionTool({
  name: TOOL_NAME,
  description: 'Set the color of the on-screen button. Client-proxied: the client owns execution.',
  parameters: z.object({
    color: z.string().describe('The color to set, e.g. "red".'),
  }),
  execute: async () => {
    await Promise.resolve()
    return null
  },
  isLongRunning: true,
})

const TOOL_INSTRUCTION =
  'You help the user control a demo widget. ' +
  `When the user asks to change the button's color, call the ${TOOL_NAME} tool exactly once and say nothing else in that turn. ` +
  'Never invent a tool result. Once the tool result has arrived in the conversation, confirm the change in one short sentence.'

/**
 * The consuming app's side of the state contract: reads the reserved
 * root key out of the live session state (the package carried it there
 * via the runner's stateDelta) and speaks it into the prompt.
 */
const STATE_INSTRUCTION = (context: { state: unknown }): string => {
  const state = context.state as
    | { get?: <T>(key: string, defaultValue?: T) => T }
    | Record<string, unknown>
  const root =
    typeof state?.get === 'function'
      ? ((state.get as <T>(key: string) => T)(DEFAULT_STATE_ROOT_KEY) as
          | Record<string, unknown>
          | undefined)
      : ((state as Record<string, unknown>)[DEFAULT_STATE_ROOT_KEY] as
          | Record<string, unknown>
          | undefined)
  const color = (root as { buttonColor?: string } | undefined)?.buttonColor ?? 'unknown'
  return `The widget button is currently ${color}. Tell the user the current button color in one short sentence.`
}

/**
 * The exact tool list shape `createProbe` hands to an LlmAgent — the
 * only constraint the passthrough needs to honor.
 */
type ProbeTools = NonNullable<Parameters<typeof createProbe>[1]>['tools']

/**
 * Boots the real handler behind the shared Express bridge and returns
 * a POST-to-frames reader plus the session store. ONE store serves
 * both the wrapper and the runner (the runner resolves sessions in
 * its own service — 'Session not found' otherwise — so the wrapper
 * must receive the same instance).
 */
const startServer = (
  instruction: string | ((context: { state: unknown }) => string),
  runConfig: Record<string, unknown>,
  tools?: ProbeTools,
): Promise<{
  post: (body: object) => Promise<Frame[]>
  sessionService: InMemorySessionService
  close: () => Promise<void>
}> => {
  const sessionService = new InMemorySessionService()
  return createProbe(AGENT_NAME, {
    instruction,
    appName: APP_NAME,
    ...(tools !== undefined ? { tools } : {}),
    sessionService,
  }).then((runner) => {
    const adkAgent = createAdkAgent({
      agent: runner,
      appName: APP_NAME,
      sessionService,
      runConfig,
    })
    const app = bridgeToExpress(createAdkHttpHandler(adkAgent))
    const close = listen(app, PORT)
    return {
      sessionService,
      post: async (body: object): Promise<Frame[]> => {
        const { lines } = await postSse(PORT, body)
        return lines.map(parseFrame<Frame>).filter((frame): frame is Frame => !!frame)
      },
      close,
    }
  })
}

const replyTextOf = (frames: readonly Frame[]): string =>
  frames
    .filter((frame) => frame.type === 'TEXT_MESSAGE_CONTENT')
    .map((frame) => frame.delta ?? '')
    .join('')

const callIdsOf = (session: { events: AdkEvent[] }): string[] =>
  session.events
    .flatMap((event) => event.content?.parts ?? [])
    .map((part) => part.functionCall?.id)
    .filter((id): id is string => id !== undefined)

const responseIdsOf = (session: { events: AdkEvent[] }): string[] =>
  session.events
    .flatMap((event) => event.content?.parts ?? [])
    .map((part) => part.functionResponse?.id)
    .filter((id): id is string => id !== undefined)

describe('AdkHttpHandler against real Gemini', () => {
  test(
    'Given a streaming runConfig and the client state carrying a button color - When a full turn executes end to end - ' +
      'Then schema-valid frames stream the run lifecycle with streamed text deltas and the reply reflects the carried state',
    { timeout: STATE_TIMEOUT_MS },
    async () => {
      const server = await startServer(STATE_INSTRUCTION, { streamingMode: StreamingMode.SSE })
      try {
        const frames = await server.post({
          threadId: 'thread-llm-state',
          runId: 'run-llm-state',
          state: { buttonColor: 'red' },
          messages: [
            {
              id: 'msg-llm-1',
              role: 'user',
              content: 'What color is the button right now?',
            },
          ],
        })

        const types = frames.map((frame) => frame.type)
        expect(types[0]).toBe('RUN_STARTED')
        expect(types[types.length - 1]).toBe('RUN_FINISHED')
        for (const frame of frames) {
          expect(EventSchema.parse(frame)).toBeDefined()
        }

        const deltas = frames
          .filter((frame) => frame.type === 'TEXT_MESSAGE_CONTENT')
          .map((frame) => frame.delta ?? '')
        expect(deltas.length).toBeGreaterThan(0)
        expect(deltas.join('').length).toBeGreaterThan(0)

        expect(replyTextOf(frames)).toContain('red')
      } finally {
        await server.close()
      }
    },
  )

  test(
    'Given a client-proxied long-running tool - When the user asks to change the button color - ' +
      'Then the stream pauses at a schema-valid tool call with no model text after it (the HITL pause)',
    { timeout: STATE_TIMEOUT_MS },
    async () => {
      const server = await startServer(
        TOOL_INSTRUCTION,
        {
          streamingMode: StreamingMode.SSE,
          pauseOnToolCalls: true,
        },
        [setButtonColor],
      )
      try {
        const frames = await server.post({
          threadId: 'thread-llm-tool',
          runId: 'run-llm-tool',
          state: {},
          messages: [{ id: 'msg-llm-2', role: 'user', content: 'Please turn the button red.' }],
        })

        for (const frame of frames) {
          expect(EventSchema.parse(frame)).toBeDefined()
        }
        const types = frames.map((frame) => frame.type)
        expect(types[0]).toBe('RUN_STARTED')
        expect(types[types.length - 1]).toBe('RUN_FINISHED')
        const callIndex = types.indexOf('TOOL_CALL_START')
        expect(callIndex).toBeGreaterThan(-1)
        const started = frames[callIndex]
        expect(started?.toolCallName).toBe(TOOL_NAME)
        expect(started?.toolCallId).toBeTruthy()
        expect(types.slice(callIndex)).toContain('TOOL_CALL_END')

        const textAfterCall = frames
          .slice(callIndex + 1)
          .filter((frame) => frame.type === 'TEXT_MESSAGE_CONTENT')
        expect(textAfterCall).toEqual([])
      } finally {
        await server.close()
      }
    },
  )

  test(
    'Given a pending tool call paused in the previous turn and the client result re-posted as a tool message - ' +
      'When the follow-up executes end to end - ' +
      'Then the result is stitched into the session with the exact call id and the reply confirms the change',
    { timeout: STATE_TIMEOUT_MS },
    async () => {
      const server = await startServer(
        TOOL_INSTRUCTION,
        {
          streamingMode: StreamingMode.SSE,
          pauseOnToolCalls: true,
        },
        [setButtonColor],
      )
      try {
        const firstTurn = await server.post({
          threadId: 'thread-llm-resume',
          runId: 'run-llm-resume-1',
          state: {},
          messages: [{ id: 'msg-llm-3', role: 'user', content: 'Please turn the button red.' }],
        })
        const started = firstTurn.find((frame) => frame.type === 'TOOL_CALL_START')
        expect(started?.toolCallId).toBeTruthy()

        const session = await server.sessionService.getOrCreateSession({
          appName: APP_NAME,
          userId: DEFAULT_USER_ID,
          sessionId: 'thread-llm-resume',
        })
        expect(callIdsOf(session)).toEqual([started?.toolCallId])
        expect(responseIdsOf(session)).toEqual([])

        const followUp = await server.post({
          threadId: 'thread-llm-resume',
          runId: 'run-llm-resume-2',
          state: {},
          messages: [
            { id: 'msg-llm-3', role: 'user', content: 'Please turn the button red.' },
            {
              id: 'msg-llm-4',
              role: 'tool',
              toolCallId: started?.toolCallId ?? '',
              content: JSON.stringify(TOOL_RESULT),
            },
          ],
        })

        const afterFollowUp = await server.sessionService.getOrCreateSession({
          appName: APP_NAME,
          userId: DEFAULT_USER_ID,
          sessionId: 'thread-llm-resume',
        })
        expect(responseIdsOf(afterFollowUp)).toEqual([started?.toolCallId])
        for (const frame of followUp) {
          expect(EventSchema.parse(frame)).toBeDefined()
        }
        expect(followUp[followUp.length - 1]?.type).toBe('RUN_FINISHED')
        expect(replyTextOf(followUp)).toMatch(/red/i)
      } finally {
        await server.close()
      }
    },
  )
})
