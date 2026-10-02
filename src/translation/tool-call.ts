/**
 * The tool-call mapping: ADK functionCall events map to
 * TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END; client-proxied
 * (long-running) calls leave the stream pending for the client's
 * result, which the wrapper stitches back as a FunctionResponse
 * carrying the exact call id.
 */

import { randomUUID } from 'node:crypto'

import { EventType, type BaseEvent } from '../protocol.js'

import type { TranslationState } from './contracts.js'

interface AdkFunctionCall {
  readonly id?: string
  readonly name?: string
  readonly args?: unknown
}

const newToolCallId = (): string => `call_${randomUUID()}`

/**
 * Whether the model's call carries args worth a ARGS delta: absent,
 * null, or empty args produce no frame (the schema requires the
 * delta to carry content).
 */
const hasEmittableArgs = (call: AdkFunctionCall): boolean => {
  if (call.args === undefined || call.args === null) return false
  return Object.keys(call.args as object).length > 0
}

/**
 * Emit one call as the START → ARGS → END trio. The args ride as one
 * JSON delta (the model's call arrives whole; chunked args would need
 * a TOOL_CALL_ARGS-per-fragment seam, built when a consumer needs
 * it). toolCallId falls back to a generated id only when ADK supplies
 * none; the wrapper's stitching requires the exact id, so the
 * fallback is a last resort, logged by absence in the contract tests.
 */
export const emitToolCall = (state: TranslationState, call: AdkFunctionCall): BaseEvent[] => {
  const toolCallId = call.id ?? newToolCallId()
  state.lastToolCallId = toolCallId
  const frames: BaseEvent[] = [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: call.name ?? 'unknown_tool',
    },
  ]
  if (hasEmittableArgs(call)) {
    frames.push({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(call.args) })
  }
  frames.push({ type: EventType.TOOL_CALL_END, toolCallId })
  return frames
}

/**
 * A pending call without END would hang consumers; the trio is atomic
 * per call, so this closes nothing today. Kept as the named seam for
 * chunked-args emission (ARGS fragments arriving across events).
 */
export const closeStaleToolCall = (_state: TranslationState): BaseEvent[] => []
