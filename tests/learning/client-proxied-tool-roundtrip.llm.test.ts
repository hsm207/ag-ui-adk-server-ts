/**
 * Learning tripwire: the client-proxied tool round trip against REAL
 * Gemini.
 *
 * REAL LLM CALL — expensive. Lives in a *.llm.test.ts file, which the
 * learning project excludes; run it explicitly via
 * `npm run test:learning:llm`.
 *
 * Role (tests/README.md "When something is red"): the upgrade tripwire
 * for the runtime behaviors this package's tool-result stitching
 * depends on — behaviors `tsc` cannot see. When adk-js ships a new
 * version, this file is what goes red first and names the dependency.
 *
 * Verified behaviors (each pinned here so an adk-js upgrade that
 * breaks one goes red in this file first):
 * 1. Pending is opt-in: only an isLongRunning tool whose executor
 *    returns nullish leaves a functionCall unanswered (adk-js
 *    core/src/agents/functions.ts); a plain local tool auto-executes
 *    server-side and auto-continues.
 * 2. A bare follow-up runAsync (no newMessage) is a silent no-op — the
 *    execution block lives inside `if (newMessage)` (adk-js
 *    core/src/agents/runner.ts).
 * 3. Authorship of the appended response does NOT gate continuation:
 *    tool-name authorship still resumes.
 * 5. A mismatched functionResponse id is fatal at request-build time:
 *    "No function call event found for function responses ids: …"; no
 *    model call is made. Observed 3/3 identical against real Gemini
 *    (discovery probes, 2026-09-30). The bridge must echo the pending
 *    call's id exactly.
 * (Truths 4 and 6 — local auto-execution masked the pending path; SSE
 * streaming must pause at calls — are recorded with the same
 * discovery session; the pause side is pinned by the application
 * tier's HITL tests.)
 *
 * Fixture: a client-proxied tool (the client owns execution) is
 * declared long-running with a stub server executor; the client's
 * result enters the session as an appended FunctionResponse event,
 * then a continuation turn re-invokes the runner. The scenario is
 * deliberately generic (a button-color widget) — this package is
 * public-bound and carries no application vocabulary.
 */

import { createEvent, FunctionTool, type Event as AdkEvent, type Runner } from '@google/adk'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'

import { createLearningSession, createProbe, getLearningSession } from './harness.ts'

const AGENT_NAME = 'widget_agent'
const TOOL_NAME = 'set_button_color'
const TOOL_RESULT = { status: 'done', color: 'red' }

/**
 * Per-probe ceiling for real-Gemini runs: a cold first turn takes
 * 100s+, and Vertex quota pressure after minutes of continuous calls
 * pushes a probe past three minutes. The ceiling exists to fail fast
 * on a hung run, not to false-red on throttling, so it sits well
 * above the observed slow path.
 */
const PROBE_TIMEOUT_MS = 300_000

/**
 * Client-proxied tool: the client owns execution; the server executor
 * is a stub returning nothing. The long-running declaration is the
 * only shape that leaves a call pending on pinned adk-js (verified behavior
 * 1).
 */
const setButtonColor = new FunctionTool({
  name: TOOL_NAME,
  description: 'Set the color of the on-screen button. Client-proxied: the client owns execution.',
  parameters: z.object({
    color: z.string().describe('The color to set, e.g. "red".'),
  }),
  // Never invoked server-side: the long-running declaration makes ADK
  // leave the call pending (verified behavior 1).
  execute: async () => {
    await Promise.resolve()
    return null
  },
  isLongRunning: true,
})

const CALL_INSTRUCTION =
  'You help the user control a demo widget. ' +
  `When the user asks to change the button's color, call the ${TOOL_NAME} tool exactly once and say nothing else in that turn. ` +
  'Never invent a tool result. Once the tool result has arrived in the conversation, confirm the change in one short sentence.'

const USER_REQUEST = 'Please turn the button red.'

type AdkPart = NonNullable<NonNullable<AdkEvent['content']>['parts']>[number]

const isColorCallPart = (part: AdkPart): boolean => part.functionCall?.name === TOOL_NAME

/**
 * Collects the ids of every set_button_color functionCall across a
 * run's event stream, in order. In ADK a model's tool request is not a
 * dedicated event kind — it rides inside event.content.parts[] as a
 * { functionCall: { id, name, args } } part, so counting calls means
 * counting parts, not events. Each id is the handle the client must
 * echo back as functionResponse.id for the model to pair the result
 * with its request (verified behavior 5: a mismatched id is fatal).
 */
const colorCallIds = (events: AdkEvent[]): Array<string | undefined> =>
  events.flatMap((event) =>
    (event.content?.parts ?? []).filter(isColorCallPart).map((part) => part.functionCall?.id),
  )

/**
 * Joins every text part the agent authored after events[index] into
 * one string ('' when the agent said nothing). One model answer can be
 * split across several events and parts, so the agent's post-call
 * utterance is the concatenation. After a pending tool call the model
 * must stay silent: an empty string is the observable signature of a
 * run that ends waiting on the client.
 */
const modelTextAfter = (events: AdkEvent[], index: number): string =>
  events
    .slice(index + 1)
    .filter((event) => event.author === AGENT_NAME)
    .flatMap((event) =>
      (event.content?.parts ?? []).map((part) => (part as { text?: string }).text ?? ''),
    )
    .join('')

const agentTextOf = (events: AdkEvent[]): string =>
  events
    .filter((event) => event.author === AGENT_NAME)
    .flatMap((event) =>
      (event.content?.parts ?? []).map((part) => (part as { text?: string }).text ?? ''),
    )
    .join('')
    .trim()

const collectAllEvents = async (
  run: AsyncGenerator<AdkEvent, void, unknown>,
): Promise<AdkEvent[]> => {
  const collected: AdkEvent[] = []
  for await (const event of run) {
    collected.push(event)
  }
  return collected
}

const runFirstTurn = async (
  runner: Runner,
  userId: string,
  sessionId: string,
): Promise<AdkEvent[]> =>
  collectAllEvents(
    runner.runAsync({
      userId,
      sessionId,
      newMessage: { role: 'user', parts: [{ text: USER_REQUEST }] },
    }),
  )

/**
 * Appends the client's tool result to the session log as a
 * FunctionResponse event — the wire act that answers a pending
 * functionCall. The response is the client's (it executed the tool);
 * the model produces nothing in this step. `author` is the appended
 * event's author field, chosen by the caller — owning agent or the
 * tool's name (verified behavior 3 pins that authorship does not gate
 * continuation).
 */
const appendClientFunctionResponse = async (
  runner: Runner,
  userId: string,
  sessionId: string,
  callId: string,
  author: string,
): Promise<void> => {
  const session = await getLearningSession(runner, userId, sessionId)
  if (!session) throw new Error('session disappeared')
  await runner.sessionService.appendEvent({
    session,
    event: createEvent({
      author,
      content: {
        role: 'tool',
        parts: [
          {
            functionResponse: {
              id: callId,
              name: TOOL_NAME,
              response: TOOL_RESULT,
            },
          },
        ],
      },
    }),
  })
}

/**
 * Re-invokes the runner with an empty-text user turn after the
 * client's FunctionResponse is already in the log. Why newMessage is
 * present but empty: runAsync only executes the agent when the call
 * carries a newMessage — a bare re-invocation with none is a silent
 * no-op on pinned adk-js (verified behavior 2). The turn must send something,
 * but the instruction it carries is the empty string: the model's
 * continuation is driven by the appended FunctionResponse already in
 * the session log, not by any new request.
 */
const runContinuationTurn = async (
  runner: Runner,
  userId: string,
  sessionId: string,
): Promise<AdkEvent[]> =>
  collectAllEvents(
    runner.runAsync({
      userId,
      sessionId,
      newMessage: { role: 'user', parts: [{ text: '' }] },
    }),
  )

const requireCallId = (events: AdkEvent[]): string => {
  const callId = colorCallIds(events)[0]
  if (!callId) throw new Error(`expected a ${TOOL_NAME} functionCall id`)
  return callId
}

describe('Client-proxied tool round trip (real Gemini)', () => {
  test(
    'Given a real Gemini agent exposing a client-proxied set_button_color tool declared long-running with a no-op server executor - ' +
      'When the user asks to turn the button red - ' +
      'Then the run ends with exactly one functionCall event for set_button_color and no final model text',
    async () => {
      const runner = await createProbe(AGENT_NAME, {
        instruction: CALL_INSTRUCTION,
        tools: [setButtonColor],
      })
      const sessionId = await createLearningSession(runner, 'learning-user')

      const events = await runFirstTurn(runner, 'learning-user', sessionId)

      const callIds = colorCallIds(events)
      expect(callIds).toHaveLength(1)
      const [callId] = callIds
      expect(callId).toBeTruthy()

      const callIndex = events.findIndex((event) =>
        (event.content?.parts ?? []).some(isColorCallPart),
      )
      expect(modelTextAfter(events, callIndex)).toBe('')
    },
    PROBE_TIMEOUT_MS,
  )

  test(
    'Given that pending functionCall - ' +
      'When the client result is appended as a FunctionResponse authored by the owning agent carrying the exact call id and the runner is re-invoked with an empty-text continuation turn - ' +
      'Then the follow-up completes with a final model text and no new functionCall',
    async () => {
      const runner = await createProbe(AGENT_NAME, {
        instruction: CALL_INSTRUCTION,
        tools: [setButtonColor],
      })
      const sessionId = await createLearningSession(runner, 'learning-user')

      const firstRun = await runFirstTurn(runner, 'learning-user', sessionId)
      const callId = requireCallId(firstRun)

      await appendClientFunctionResponse(runner, 'learning-user', sessionId, callId, AGENT_NAME)

      const session = await getLearningSession(runner, 'learning-user', sessionId)
      if (!session) throw new Error('session disappeared')
      const appendedPart = session.events
        .flatMap((event) => event.content?.parts ?? [])
        .find(
          (part) =>
            (part as { functionResponse?: { id?: string } }).functionResponse?.id === callId,
        )?.functionResponse
      if (!appendedPart) throw new Error('appended FunctionResponse missing from the session log')
      expect(appendedPart.response).toEqual(TOOL_RESULT)

      const followUp = await runContinuationTurn(runner, 'learning-user', sessionId)

      expect(colorCallIds(followUp)).toHaveLength(0)
      expect(agentTextOf(followUp).length).toBeGreaterThan(0)
    },
    PROBE_TIMEOUT_MS,
  )

  test(
    'Given the client result appended into the session - ' +
      'When the session event log is opened between the two runs - ' +
      'Then the log contains the appended FunctionResponse carrying the client value, proving the model continuation came from that entry and not from the model inventing an answer over an unanswered call (the hallucination failure mode)',
    async () => {
      const runner = await createProbe(AGENT_NAME, {
        instruction: CALL_INSTRUCTION,
        tools: [setButtonColor],
      })
      const sessionId = await createLearningSession(runner, 'learning-user')

      const firstRun = await runFirstTurn(runner, 'learning-user', sessionId)
      const callId = requireCallId(firstRun)

      await appendClientFunctionResponse(runner, 'learning-user', sessionId, callId, AGENT_NAME)

      const session = await getLearningSession(runner, 'learning-user', sessionId)
      if (!session) throw new Error('session disappeared')
      const logPart = session.events
        .flatMap((event) => event.content?.parts ?? [])
        .find(
          (part) =>
            (part as { functionResponse?: { id?: string } }).functionResponse?.id === callId,
        )?.functionResponse
      if (!logPart) throw new Error('appended FunctionResponse missing from the session log')

      expect(logPart.response).toEqual(TOOL_RESULT)
      expect(logPart.name).toBe(TOOL_NAME)
    },
    PROBE_TIMEOUT_MS,
  )

  test(
    'Given the client result appended under the tool name instead of the owning agent name - ' +
      'When the follow-up runs - ' +
      'Then it still completes with final model text and no new functionCall (the label does not matter on pinned adk-js)',
    async () => {
      const runner = await createProbe(AGENT_NAME, {
        instruction: CALL_INSTRUCTION,
        tools: [setButtonColor],
      })
      const sessionId = await createLearningSession(runner, 'learning-user')

      const firstRun = await runFirstTurn(runner, 'learning-user', sessionId)
      const callId = requireCallId(firstRun)

      await appendClientFunctionResponse(runner, 'learning-user', sessionId, callId, TOOL_NAME)

      const followUp = await runContinuationTurn(runner, 'learning-user', sessionId)

      expect(agentTextOf(followUp).length).toBeGreaterThan(0)
      expect(colorCallIds(followUp)).toHaveLength(0)
    },
    PROBE_TIMEOUT_MS,
  )

  test(
    'Given the client result appended under a MISMATCHED id - When the follow-up runs - ' +
      'Then the runner throws at request-build time and no model call is made (verified behavior 5, negative axis)',
    async () => {
      const runner = await createProbe(AGENT_NAME, {
        instruction: CALL_INSTRUCTION,
        tools: [setButtonColor],
      })
      const sessionId = await createLearningSession(runner, 'learning-user')

      const firstRun = await runFirstTurn(runner, 'learning-user', sessionId)
      const callId = requireCallId(firstRun)

      await appendClientFunctionResponse(
        runner,
        'learning-user',
        sessionId,
        callId + '-typo',
        AGENT_NAME,
      )

      await expect(runContinuationTurn(runner, 'learning-user', sessionId)).rejects.toThrow(
        /No function call event found/i,
      )
    },
    PROBE_TIMEOUT_MS,
  )
})
