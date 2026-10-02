/**
 * The translation seam: one ADK event in, zero or more AG-UI events
 * out, one mapping module beside it (run-lifecycle, text-message,
 * tool-call). A translator instance is created per run: it owns the
 * run's translation state and the terminal guarantee.
 *
 * Schema facts read off the AG-UI event schemas (read, not tested):
 * RUN_STARTED / RUN_FINISHED require threadId + runId; RUN_FINISHED
 * carries the outcome union; RUN_ERROR takes a top-level message and
 * no thread/run fields. @ag-ui/core's event factories are
 * deliberately unexported from its main entry (which must stay
 * zod-free), so events are built as typed literals and validated in
 * the contract tests.
 */

import type { BaseEvent } from '../protocol.js'

import type { RunTranslator, TranslationState } from './contracts.js'
import { finishRun, runError, runStarted } from './run-lifecycle.js'
import { closeTextStream, isStreamReplay, streamTextChunk } from './text-message.js'
import { closeStaleToolCall, emitToolCall } from './tool-call.js'

/** The ADK event surface the translation reads; anything else on the event is ignored. */
interface AdkEventLike {
  readonly partial?: boolean
  readonly turnComplete?: boolean
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly content?: {
    readonly parts?: ReadonlyArray<{
      readonly text?: string
      readonly functionCall?: { id?: string; name?: string; args?: unknown }
    }>
  }
}

/**
 * Compose the mapping modules into a run translator. Terminal
 * guarantee: RUN_STARTED is emitted lazily on the first translated
 * event, and RUN_FINISHED (or RUN_ERROR, once an error has fired)
 * exactly once — by turnComplete, or by finish() when the ADK stream
 * ends silently.
 */
export const createEventTranslator = (threadId: string, runId: string): RunTranslator => {
  const state: TranslationState = {
    threadId,
    runId,
    started: false,
    finished: false,
    lastToolCallId: null,
    open: false,
    messageId: '',
    streamedText: '',
  }

  const translate = (adkEvent: unknown): BaseEvent[] => {
    const event = adkEvent as AdkEventLike
    if (event.errorCode !== undefined) return errorFrames(state, event)
    return [...ensureStarted(state), ...normalFrames(state, event)]
  }

  return {
    translate,
    finish: () => [...closeTextStream(state), ...finishRun(state)],
  }
}

/**
 * The error terminal, fired once: the failure event translated to
 * RUN_ERROR after the frames the run still owes — RUN_STARTED (a run
 * the server accepted is a run the client saw start, so the error is
 * bracketed even when it fired before any other frame) and the close
 * of any open text stream.
 */
const errorFrames = (state: TranslationState, event: AdkEventLike): BaseEvent[] => {
  if (state.finished) return []
  state.finished = true
  return [
    ...ensureStarted(state),
    ...closeTextStream(state),
    runError(event.errorMessage ?? 'model error', event.errorCode),
  ]
}

/** The frames for a non-failure event, in emission order. */
const normalFrames = (state: TranslationState, event: AdkEventLike): BaseEvent[] => [
  ...closeTextBeforeToolCalls(state, event),
  ...toolCallFrames(state, event),
  ...textFrames(state, event),
  ...turnCompleteFrames(state, event),
]

/**
 * The close of an open text stream when the event carries a function
 * call: per the AG-UI protocol, TEXT_MESSAGE_END must be sent before
 * TOOL_CALL_START.
 */
const closeTextBeforeToolCalls = (state: TranslationState, event: AdkEventLike): BaseEvent[] =>
  (event.content?.parts?.some((part) => part.functionCall !== undefined) ?? false)
    ? closeTextStream(state)
    : []

/** The functionCall parts as TOOL_CALL_START → ARGS → END trios. */
const toolCallFrames = (state: TranslationState, event: AdkEventLike): BaseEvent[] =>
  (event.content?.parts ?? []).flatMap((part) =>
    part.functionCall !== undefined ? emitToolCall(state, part.functionCall) : [],
  )

/**
 * The event's text as CONTENT deltas on the open stream. Skipped when
 * the event carries no text, or when it is ADK's consolidated replay
 * (partial unset after a partial stream) repeating text already
 * streamed — a consumer never sees the same delta twice.
 */
const textFrames = (state: TranslationState, event: AdkEventLike): BaseEvent[] => {
  const text = textOf(event)
  const isReplay = event.partial !== true && isStreamReplay(state, text)
  if (text === '' || isReplay) return []
  return streamTextChunk(state, text)
}

/**
 * The terminal sequence on turnComplete: the text stream closed, the
 * stale-tool-call seam advanced, RUN_FINISHED exactly once.
 */
const turnCompleteFrames = (state: TranslationState, event: AdkEventLike): BaseEvent[] => {
  if (event.turnComplete !== true) return []
  return [...closeTextStream(state), ...closeStaleToolCall(state), ...finishRun(state)]
}

/** Emit RUN_STARTED once; the run's first frame is always RUN_STARTED. */
const ensureStarted = (state: TranslationState): BaseEvent[] => {
  if (state.started) return []
  state.started = true
  return [runStarted(state)]
}

const textOf = (event: AdkEventLike): string =>
  (event.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
