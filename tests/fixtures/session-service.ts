/**
 * In-memory session-service fake for the programmer tier: the
 * get-or-create + appendEvent + state semantics the wrapper depends
 * on, backed by Maps. Modeled on the documented BaseSessionService
 * surface (runner owns appName/userId/sessionId; state rides session
 * state; events accumulate in order).
 */

import { createEvent, type Event as AdkEvent } from '@google/adk'

import type { RunAgentInput } from '../../src/protocol.ts'

export interface FakeSession {
  readonly id: string
  state: Record<string, unknown>
  events: AdkEvent[]
}

export class InMemorySessions {
  private readonly sessions = new Map<string, FakeSession>()
  createdCount = 0

  async getOrCreateSession(input: {
    appName: string
    userId: string
    sessionId: string
  }): Promise<FakeSession> {
    const existing = this.sessions.get(input.sessionId)
    if (existing) return existing
    this.createdCount += 1
    const created: FakeSession = { id: input.sessionId, state: {}, events: [] }
    this.sessions.set(input.sessionId, created)
    return created
  }

  async appendEvent(input: { session: FakeSession; event: AdkEvent }): Promise<void> {
    input.session.events.push(input.event)
  }

  /**
   * What the REAL Runner does on runAsync: appends the newMessage as a
   * user event and applies stateDelta to session state. The scripted
   * runner in tests calls this so the log/state evolve faithfully.
   * The message shape mirrors the real runner's calling convention:
   * newMessage is required and its parts are a mutable array.
   */
  async invokeRunnerEffects(
    session: FakeSession,
    input: {
      newMessage: { parts: Array<{ text?: string }> }
      stateDelta?: Record<string, unknown>
    },
    scriptedEvent: AdkEvent,
  ): Promise<void> {
    const text = input.newMessage.parts.map((part) => part.text ?? '').join('')
    if (text !== '') {
      session.events.push(
        createEvent({ author: 'user', content: { role: 'user', parts: [{ text }] } }),
      )
    }
    if (input.stateDelta !== undefined) Object.assign(session.state, input.stateDelta)
    session.events.push(scriptedEvent)
  }

  functionCallIds(session: FakeSession): string[] {
    return session.events
      .flatMap((event) => event.content?.parts ?? [])
      .map((part) => (part as { functionCall?: { id?: string } }).functionCall?.id)
      .filter((id): id is string => id !== undefined)
  }

  functionResponseIds(session: FakeSession): string[] {
    return session.events
      .flatMap((event) => event.content?.parts ?? [])
      .map((part) => (part as { functionResponse?: { id?: string } }).functionResponse?.id)
      .filter((id): id is string => id !== undefined)
  }
}

/**
 * An AG-UI RunAgentInput-shaped user turn: content is a plain string
 * (the common wire case); every message carries an id, and the
 * SDK-materialized input requires tools and context arrays.
 */
export const userTurn = (text: string): RunAgentInput['messages'][number] => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  role: 'user',
  content: text,
})
