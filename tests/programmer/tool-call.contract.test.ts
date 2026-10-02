import { describe, expect, test } from 'vitest'

import { EventType, type BaseEvent } from '../../src/protocol.ts'
import { EventSchema } from '@ag-ui/core/schemas'

import { partialTextEvent, toolCallEvent, THREAD_ID } from '../fixtures/adk-events.ts'
import { createEventTranslator } from '../../src/translation/event-translator.ts'

/*
 * Schema source (read, not tested): generated/schemas.ts —
 * TOOL_CALL_START requires toolCallId + toolCallName (z.string()),
 * parentMessageId is string().optional(); ARGS requires toolCallId +
 * delta; END requires toolCallId.
 */

const THREAD = THREAD_ID
const RUN = 'run-tool'

describe('ToolCallTranslator', () => {
  test(
    'Given a scripted ADK functionCall - When translated - ' +
      'Then TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END appear in that order, each frame schema-valid',
    () => {
      const { translate, finish } = createEventTranslator(THREAD, RUN)

      const frames = [
        ...translate(toolCallEvent('call_1', 'set_button_color', { color: 'red' }) as never),
        ...finish(),
      ]

      const kinds: BaseEvent['type'][] = frames.map((frame) => frame.type)
      const startIdx = kinds.indexOf(EventType.TOOL_CALL_START)
      const argsIdx = kinds.indexOf(EventType.TOOL_CALL_ARGS)
      const endIdx = kinds.indexOf(EventType.TOOL_CALL_END)
      expect(startIdx).toBeGreaterThan(-1)
      expect(argsIdx).toBe(startIdx + 1)
      expect(endIdx).toBe(argsIdx + 1)

      const [start] = frames.slice(startIdx, startIdx + 1)
      expect(start).toMatchObject({
        type: 'TOOL_CALL_START',
        toolCallId: 'call_1',
        toolCallName: 'set_button_color',
      })
      expect(frames[argsIdx]).toEqual({
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'call_1',
        delta: JSON.stringify({ color: 'red' }),
      })
      expect(frames[endIdx]).toEqual({ type: 'TOOL_CALL_END', toolCallId: 'call_1' })

      for (const frame of frames) {
        expect(EventSchema.parse(frame)).toBeDefined()
      }
    },
  )

  test(
    'Given an open text message from partial chunks - When a functionCall arrives mid-run - ' +
      'Then TEXT_MESSAGE_END precedes TOOL_CALL_START (the AG-UI protocol ordering the reference middleware enforces)',
    () => {
      const { translate } = createEventTranslator(THREAD, RUN)

      const frames = [
        ...translate(partialTextEvent('Let me set that') as never),
        ...translate(toolCallEvent('call_mid', 'set_button_color', { color: 'red' }) as never),
      ]

      const kinds: BaseEvent['type'][] = frames.map((frame) => frame.type)
      const endIdx = kinds.indexOf(EventType.TEXT_MESSAGE_END)
      const startIdx = kinds.indexOf(EventType.TOOL_CALL_START)
      expect(endIdx).toBeGreaterThan(-1)
      expect(startIdx).toBe(endIdx + 1)
      for (const frame of frames) {
        expect(EventSchema.parse(frame)).toBeDefined()
      }
    },
  )
})
