/**
 * The tool-result stitching port: this file serves the
 * pending-call ledger — client-proxied tool calls left pending, and
 * the client's result appended as an ADK FunctionResponse authored by
 * the owning agent, carrying the exact call id.
 *
 * Rules implemented here:
 * - A FunctionResponse id that does not echo a pending FunctionCall
 *   is rejected by the model layer at request-build time, so only
 *   ids actually PENDING in this thread's log are accepted.
 * - An id is answered once: a re-delivered follow-up must not append
 *   a duplicate response.
 * - The appended event's author must be the owning agent's real
 *   name: the ADK runner resolves appended-event authors against its
 *   agent tree, and a phantom author logs 'Event from an unknown
 *   agent' and mis-routes resumption in multi-agent trees.
 *   Authorship does not gate continuation, but it does route it.
 */

import { createEvent } from '@google/adk'

import type { AppendEventPort, SessionLike } from './contracts.js'

interface ToolResultMessage {
  readonly role: 'tool'
  readonly toolCallId?: string
  readonly content?: string
}

/** The call/response shape the pending-id scan reads off a part. */
interface PartScan {
  functionCall?: { id?: string; name?: string }
  functionResponse?: { id?: string }
}

/**
 * Append each acceptable tool result as a FunctionResponse event:
 * exact id echo, owning-agent authorship, name from the original
 * call. Returns how many responses were appended.
 */
export const stitchToolResults = async (
  service: AppendEventPort,
  session: SessionLike,
  owningAgent: string,
  toolResults: readonly ToolResultMessage[],
): Promise<number> => {
  const pending = pendingCallIds(session)
  const responded = respondedCallIds(session)
  let appended = 0
  for (const toolResult of toolResults) {
    const toolCallId = toolResult.toolCallId
    if (toolCallId === undefined) continue
    if (!pending.has(toolCallId) || responded.has(toolCallId)) continue
    // An id is answered ONCE per delivery too: a batch carrying the
    // same id twice must not double-append before the session log
    // refreshes between runs.
    responded.add(toolCallId)
    await service.appendEvent({ session, event: responseEvent(session, owningAgent, toolResult) })
    appended += 1
  }
  return appended
}

/** The call ids pending in the session log (functionCall parts seen so far). */
const pendingCallIds = (session: SessionLike): Set<string> => {
  const ids = new Set<string>()
  for (const event of session.events) {
    const call = firstPartOf(event).functionCall
    if (call?.id !== undefined) ids.add(call.id)
  }
  return ids
}

/** The call ids already answered (functionResponse parts seen so far). */
const respondedCallIds = (session: SessionLike): Set<string> => {
  const ids = new Set<string>()
  for (const event of session.events) {
    const response = firstPartOf(event).functionResponse
    if (response?.id !== undefined) ids.add(response.id)
  }
  return ids
}

/** The model-facing name when the session log holds no matching call. */
const UNKNOWN_TOOL_NAME = 'unknown_tool'

/** The FunctionResponse event for one accepted tool result. */
const responseEvent = (
  session: SessionLike,
  owningAgent: string,
  toolResult: ToolResultMessage,
): unknown =>
  createEvent({
    author: owningAgent,
    content: {
      role: 'tool',
      parts: [
        {
          functionResponse: {
            id: toolResult.toolCallId ?? '',
            name: toolNameOf(session, toolResult.toolCallId ?? ''),
            response: parseResultContent(toolResult.content),
          },
        },
      ],
    },
  })

const toolNameOf = (session: SessionLike, callId: string): string => {
  for (const event of session.events) {
    const call = firstPartOf(event).functionCall
    if (call?.id === callId && call.name !== undefined) return call.name
  }
  return UNKNOWN_TOOL_NAME
}

/**
 * Parse the client's result content: JSON object rides as-is; other
 * JSON values and plain strings wrap in a result envelope.
 */
const parseResultContent = (raw: string | undefined): Record<string, unknown> => {
  if (raw === undefined) return { status: 'completed' }
  try {
    const maybe = JSON.parse(raw) as unknown
    if (typeof maybe === 'object' && maybe !== null) return maybe as Record<string, unknown>
    return { result: maybe }
  } catch {
    return { status: 'completed', result: raw }
  }
}

/**
 * The event's first part, or an empty scan when it carries none:
 * under SSE with pauseOnToolCalls, @google/adk closes a paused run
 * with a trailing agent event whose content has NO parts — the scan
 * must treat it as carrying nothing, not crash on it.
 */
const firstPartOf = (event: unknown): PartScan => {
  const parts = (event as { content?: { parts?: ReadonlyArray<PartScan> } }).content?.parts ?? []
  return parts[0] ?? {}
}
