/**
 * Scripted real-ADK-event fixtures. Every shape here was observed on
 * the wire, never invented; the doc-comment cites where.
 *
 * Evidence:
 * - Model text rides content.parts[].text; streaming marks partial:
 *   true and a consolidated replay repeats the full text with partial
 *   unset/false. Observed against real Gemini (2026-09-30); the
 *   Python reference translates the same duality at
 *   event_translator.py lines 640-729.
 * - A model tool request rides content.parts[].functionCall with an
 *   id, name, args; a completed run signals turnComplete on the final
 *   event. Observed in the round-trip probes
 *   (tests/learning/client-proxied-tool-roundtrip.llm.test.ts, green
 *   against real Gemini 2026-09-30; helpers count call parts, not
 *   events).
 * - Model errors surface on the event as errorCode/errorMessage and
 *   turn completion may be absent on some terminal shapes. Observed
 *   against real Gemini in the translator's error/finish handling
 *   (2026-09-30).
 *
 * AdkEvent is structural here on purpose: these fixtures pin the
 * fields the translator reads, keeping the programmer tier runnable
 * without deep-importing the dependency.
 */

export interface AdkPartFixture {
  readonly text?: string
  readonly functionCall?: { readonly id?: string; readonly name?: string; readonly args?: unknown }
}

export interface AdkEventFixture {
  readonly author?: string
  readonly partial?: boolean
  readonly turnComplete?: boolean
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly content?: { readonly parts?: readonly AdkPartFixture[] }
}

export const WIDGET_AGENT = 'widget_agent'
export const THREAD_ID = 'thread-fixture'

/** A streaming text chunk from the agent (partial: true). */
export const partialTextEvent = (text: string): AdkEventFixture => ({
  author: WIDGET_AGENT,
  partial: true,
  content: { parts: [{ text }] },
})

/** The consolidated replay carrying the full text (partial unset). */
export const consolidatedTextEvent = (fullText: string): AdkEventFixture => ({
  author: WIDGET_AGENT,
  content: { parts: [{ text: fullText }] },
})

/** A completed run: the terminal event signals turnComplete. */
export const turnCompleteEvent = (): AdkEventFixture => ({
  author: WIDGET_AGENT,
  turnComplete: true,
})

/** A model tool request: rides inside parts as a functionCall. */
export const toolCallEvent = (callId: string, name: string, args: unknown): AdkEventFixture => ({
  author: WIDGET_AGENT,
  content: { parts: [{ functionCall: { id: callId, name, args } }] },
})

/** A model error: surfaces on the event itself. */
export const errorEvent = (code: string, message: string): AdkEventFixture => ({
  author: WIDGET_AGENT,
  errorCode: code,
  errorMessage: message,
})

/** A silent terminal shape: no text, no turnComplete (observed on the wire). */
export const silentTerminalEvent = (): AdkEventFixture => ({
  author: WIDGET_AGENT,
  content: { parts: [] },
})
