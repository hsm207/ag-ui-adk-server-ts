/**
 * The run-lifecycle mapping: ADK run start, completion, and error map
 * to RUN_STARTED / RUN_FINISHED / RUN_ERROR, carrying threadId + runId,
 * with the structured outcome union on RUN_FINISHED (success carries
 * optional pendingToolCallIds).
 */

import { EventType, type BaseEvent } from '../protocol.js'

import type { TranslationState } from './contracts.js'

/** The run's opening frame: RUN_STARTED with the thread and run ids. */
export const runStarted = (state: TranslationState): BaseEvent => ({
  type: EventType.RUN_STARTED,
  threadId: state.threadId,
  runId: state.runId,
})

/**
 * The run's success close: the structured outcome union (schema field
 * `outcome`), not a status flag in the free-form `result` slot.
 */
export const runFinished = (state: TranslationState): BaseEvent => ({
  type: EventType.RUN_FINISHED,
  threadId: state.threadId,
  runId: state.runId,
  outcome: { type: 'success' },
})

/**
 * The run's failure close: a top-level message string (the schema has
 * no threadId/runId on RUN_ERROR — the run identity lives on the
 * stream, not the error frame).
 */
export const runError = (message: string, code?: string): BaseEvent => ({
  type: EventType.RUN_ERROR,
  message,
  ...(code !== undefined ? { code } : {}),
})

/**
 * The terminal sequence on turnComplete or stream end: RUN_FINISHED,
 * guarded by the translator's finished flag so it fires exactly once.
 */
export const finishRun = (state: TranslationState): BaseEvent[] => {
  if (state.finished) return []
  state.finished = true
  return [runFinished(state)]
}
