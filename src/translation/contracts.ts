/**
 * The contracts of the translation context: the state every
 * translation module shares, and the translator face the run context
 * obeys, in one place. The factories beside it import from here; the
 * translator instance composes them over one TranslationState per
 * run.
 */

import type { BaseEvent } from '../protocol.js'

/** Open-stream bookkeeping for the text-message mapping. */
export interface TextStreamState {
  open: boolean
  messageId: string
  streamedText: string
}

/**
 * Per-run translation state shared across the mapping modules: run
 * identity, lifecycle flags, the last tool call, and the open text
 * stream's bookkeeping.
 */
export interface TranslationState extends TextStreamState {
  readonly threadId: string
  readonly runId: string
  started: boolean
  finished: boolean
  lastToolCallId: string | null
}

/** One run's translator: ADK events in, AG-UI frames out. */
export interface RunTranslator {
  /** The frames for one ADK event ([] when it translates to nothing). */
  translate: (event: unknown) => BaseEvent[]
  /** The run's closing frames; empty once the run already closed. */
  finish: () => BaseEvent[]
}
