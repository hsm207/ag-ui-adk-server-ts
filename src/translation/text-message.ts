/**
 * The text-message mapping: ADK model text (including partial chunks)
 * maps to TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END
 * with delta fragments between a single START/END pair per message.
 */

import { randomUUID } from 'node:crypto'

import { EventType, type BaseEvent } from '../protocol.js'

import type { TranslationState } from './contracts.js'

const newMessageId = (): string => `msg_${randomUUID()}`

/**
 * Append one chunk to the open stream: opens the message on the first
 * chunk, then CONTENT per chunk. The replay decision (skip vs emit)
 * belongs to the translator, which compares against `streamedText`.
 */
export const streamTextChunk = (state: TranslationState, delta: string): BaseEvent[] => {
  const frames: BaseEvent[] = []
  if (!state.open) {
    state.open = true
    state.messageId = newMessageId()
    state.streamedText = ''
    frames.push({
      type: EventType.TEXT_MESSAGE_START,
      messageId: state.messageId,
      role: 'assistant',
    })
  }
  state.streamedText += delta
  frames.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: state.messageId, delta })
  return frames
}

/** Close the open stream: TEXT_MESSAGE_END ([] when nothing is open). */
export const closeTextStream = (state: TranslationState): BaseEvent[] => {
  if (!state.open) return []
  state.open = false
  return [{ type: EventType.TEXT_MESSAGE_END, messageId: state.messageId }]
}

/** Whether a stream is open and carries the given trailing text. */
export const isStreamReplay = (state: TranslationState, text: string): boolean =>
  state.open && text !== '' && state.streamedText.endsWith(text)
