/**
 * The run orchestration: resolve the thread's session, stitch the
 * POST's tool results into the session log, then refuse the POST or
 * hand the runner one turn — a new user utterance, or the empty-text
 * continuation after tool results — yielding the translated AG-UI
 * event stream.
 *
 * Error boundary: a failure at the runner invocation or inside the
 * ADK stream surfaces as the translator's RUN_ERROR terminal, never
 * as a thrown generator error. Terminal guarantee: the translator's
 * finish() always fires after the ADK stream is exhausted, so a
 * consumer never sees a run without a closing frame.
 */

import type { BaseEvent } from '../protocol.js'

import type { RunTranslator } from '../translation/contracts.js'
import type { RunDeps, SessionLike } from './contracts.js'
import { getOrCreateThreadSession } from './adk-sessions.js'
import { clientStateDelta } from './state-carrying.js'
import { stitchToolResults } from './tool-results.js'

interface RunAgentInputLike {
  readonly threadId: string
  readonly runId: string
  readonly state?: unknown
  readonly messages: ReadonlyArray<{ role: string; content?: unknown; toolCallId?: string }>
}

/** The runner inputs one POST resolves to: its session, the turn text, the client state. */
interface RunnerInvocation {
  readonly session: SessionLike
  /** The new utterance, or '' for the tool-result continuation turn. */
  readonly messageText: string
  readonly state: unknown
}

/**
 * Execute one run end to end: the POST's tool results stitched into
 * the session, then the runner turn translated frame by frame — or
 * the RUN_ERROR refusal when the POST carries no work.
 */
export const executeRun = async function* (
  deps: RunDeps,
  input: RunAgentInputLike,
  createTranslator: (threadId: string, runId: string) => RunTranslator,
): AsyncGenerator<BaseEvent, void, unknown> {
  const session = await getOrCreateThreadSession(deps.sessionService, {
    appName: deps.appName,
    userId: deps.userId,
    sessionId: input.threadId,
  })
  const appended = await stitchToolResults(
    deps.sessionService,
    session,
    deps.owningAgent,
    toolResultsOf(input.messages),
  )

  const translator = createTranslator(input.threadId, input.runId)
  const utterance = newTurnUtterance(session, input.messages)
  if (utterance === undefined && appended === 0) {
    yield* translator.translate(refusal())
    return
  }

  yield* runInvocation(
    deps,
    { session, messageText: utterance ?? '', state: input.state },
    translator,
  )
}

/**
 * Hand one invocation to the runner and yield the translated frames.
 * Both failure points — the invocation call and the ADK stream —
 * close the run with the translator's RUN_ERROR instead of throwing
 * out of the generator; once the stream is exhausted, finish() fires
 * the run's closing frame.
 */
const runInvocation = async function* (
  deps: RunDeps,
  invocation: RunnerInvocation,
  translator: RunTranslator,
): AsyncGenerator<BaseEvent, void, unknown> {
  let stream: AsyncIterable<unknown>
  try {
    stream = deps.runner.runAsync(runnerRequest(deps, invocation))
  } catch (error) {
    yield* translator.translate(errorFrame(error))
    return
  }
  try {
    for await (const adkEvent of stream) {
      yield* translator.translate(adkEvent)
    }
  } catch (error) {
    yield* translator.translate(errorFrame(error))
    return
  }
  yield* translator.finish()
}

/**
 * The RunnerLike request for one invocation: identity, the turn's
 * message, the client state delta under the reserved root key
 * (omitted when the POST carries none), and the consumer's verbatim
 * runConfig (omitted when unset).
 */
const runnerRequest = (deps: RunDeps, invocation: RunnerInvocation) => {
  const stateDelta = clientStateDelta(deps.stateRootKey, invocation.state)
  return {
    userId: deps.userId,
    sessionId: invocation.session.id,
    newMessage: { role: 'user' as const, parts: [{ text: invocation.messageText }] },
    ...(stateDelta !== undefined ? { stateDelta } : {}),
    ...(deps.runConfig !== undefined ? { runConfig: deps.runConfig } : {}),
  }
}

/** The translator's error-terminal event for a thrown runner failure. */
const errorFrame = (error: unknown): { errorCode: string; errorMessage: string } => ({
  errorCode: 'RUN_FAILURE',
  errorMessage: error instanceof Error ? error.message : 'runner failure',
})

/** The refusal for a POST with no new user turn and no pending tool result. */
const refusal = (): { errorCode: string; errorMessage: string } => ({
  errorCode: 'NOTHING_TO_RUN',
  errorMessage: 'nothing to run: no new user turn and no pending tool result on this POST',
})

/** The POST's tool-result messages: role 'tool' carrying the call id they answer. */
const toolResultsOf = (
  messages: RunAgentInputLike['messages'],
): Array<{ role: 'tool'; toolCallId: string; content?: string }> =>
  messages.filter(
    (message): message is { role: 'tool'; toolCallId: string; content?: string } =>
      message.role === 'tool' && typeof message.toolCallId === 'string',
  )

/**
 * The utterance opening a new turn, or undefined when the POST opens
 * none. An empty text is not a turn. Nor is text the session log
 * already holds: the client sends full history every run while ADK
 * sessions accumulate, so a blind append would duplicate the turn on
 * every follow-up. Compared by text, not parts JSON — a user turn
 * carrying non-text parts would never byte-match.
 */
const newTurnUtterance = (session: SessionLike, messages: RunAgentInputLike['messages']) => {
  const utterance = lastTextOf(messages)
  if (utterance === undefined || utterance === '') return undefined
  return sessionAlreadyHasUtterance(session, utterance) ? undefined : utterance
}

/** The latest user utterance in the posted history ([]-safe, string or {text}). */
const lastTextOf = (messages: RunAgentInputLike['messages']): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const content = message.content
    if (typeof content === 'string') return content
    const parts = content as { text?: string } | undefined
    if (typeof parts?.text === 'string') return parts.text
  }
  return undefined
}

const eventTextOf = (event: unknown): string => {
  const parts =
    (event as { content?: { parts?: ReadonlyArray<{ text?: string }> } }).content?.parts ?? []
  return parts.map((part) => part.text ?? '').join('')
}

/** Whether the session log already holds this utterance (author 'user', same text). */
const sessionAlreadyHasUtterance = (session: { events: unknown[] }, text: string): boolean =>
  session.events.some(
    (event) => (event as { author?: string }).author === 'user' && eventTextOf(event) === text,
  )
