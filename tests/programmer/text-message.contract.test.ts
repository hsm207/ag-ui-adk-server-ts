import { describe, expect, test } from 'vitest'

import { EventSchema } from '@ag-ui/core/schemas'

import { consolidatedTextEvent, partialTextEvent, THREAD_ID } from '../fixtures/adk-events.ts'
import { createEventTranslator } from '../../src/translation/event-translator.ts'

/*
 * Schema source (read, not tested): generated/schemas.ts —
 * TEXT_MESSAGE_START requires messageId (z.string()), role is the
 * optional role enum; CONTENT requires messageId + delta; END requires
 * messageId. parentMessageId on tool calls is string().optional() —
 * never null. The schema gate itself is armed by the package's own
 * negative checks and by @ag-ui/core's suite; these tests pin OUR
 * translator's output against it.
 */

const THREAD = THREAD_ID
const RUN = 'run-text'

describe('TextMessageTranslator', () => {
  test(
    'Given a scripted ADK text stream with partial chunks - When translated - ' +
      'Then deltas flow between a single TEXT_MESSAGE_START and TEXT_MESSAGE_END',
    () => {
      const { translate, finish } = createEventTranslator(THREAD, RUN)

      const frames = [...translate(partialTextEvent('Hello') as never), ...finish()]
      const starts = frames.filter((frame) => frame.type === 'TEXT_MESSAGE_START')
      const ends = frames.filter((frame) => frame.type === 'TEXT_MESSAGE_END')

      expect(starts).toHaveLength(1)
      expect(starts[0]).toMatchObject({ type: 'TEXT_MESSAGE_START', role: 'assistant' })
      expect(ends).toHaveLength(1)
      expect(ends[0]).toMatchObject({
        type: 'TEXT_MESSAGE_END',
        messageId: (starts[0] as unknown as { messageId: string }).messageId,
      })
      for (const frame of frames) {
        expect(EventSchema.parse(frame)).toBeDefined()
      }
    },
  )

  test(
    'Given the streamed partial chunks - When the CONTENT deltas are joined - ' +
      'Then they reassemble to the full agent utterance in order',
    () => {
      const { translate } = createEventTranslator(THREAD, RUN)

      const frames = [
        ...translate(partialTextEvent('Hello') as never),
        ...translate(partialTextEvent(' there') as never),
      ]
      const streamedText = frames
        .filter((frame) => frame.type === 'TEXT_MESSAGE_CONTENT')
        .map((frame) => (frame as unknown as { delta: string }).delta)
        .join('')

      expect(streamedText).toBe('Hello there')
    },
  )

  test(
    'Given a consolidated replay after a partial stream - When translated - ' +
      'Then the full text is skipped and no frame duplicates it',
    () => {
      const { translate } = createEventTranslator(THREAD, RUN)

      translate(partialTextEvent('Hello') as never)
      const replay = translate(consolidatedTextEvent('Hello') as never)

      expect(replay).toHaveLength(0)
    },
  )
})
