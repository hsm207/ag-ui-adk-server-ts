import { describe, expect, test } from 'vitest'

import { EventSchema, RunErrorEventSchema } from '@ag-ui/core/schemas'

import {
  errorEvent,
  silentTerminalEvent,
  turnCompleteEvent,
  THREAD_ID,
} from '../fixtures/adk-events.ts'
import { createEventTranslator } from '../../src/translation/event-translator.ts'

/*
 * Schema source (read, not tested): generated/schemas.ts —
 * RunStarted/RunFinished require threadId + runId (z.string());
 * RunFinished carries the outcome union (success | interrupt |
 * cancelled); RunError takes a top-level message string and optional
 * code, and no thread/run fields. Those field facts are cited here,
 * never asserted against the dependency.
 */

const THREAD = THREAD_ID
const RUN = 'run-lifecycle'

describe('RunLifecycleTranslator', () => {
  test(
    'Given a scripted completed ADK run - When the stream is translated - ' +
      'Then RUN_STARTED and RUN_FINISHED bracket it, each frame schema-valid, RUN_FINISHED carrying the structured outcome union',
    () => {
      const { translate, finish } = createEventTranslator(THREAD, RUN)

      const frames = [...translate(turnCompleteEvent() as never), ...finish()]

      expect(frames).toHaveLength(2)
      const [first, last] = frames
      expect(first).toMatchObject({ type: 'RUN_STARTED', threadId: THREAD, runId: RUN })
      expect(last).toMatchObject({
        type: 'RUN_FINISHED',
        threadId: THREAD,
        runId: RUN,
        outcome: { type: 'success' },
      })
      for (const frame of frames) {
        expect(EventSchema.parse(frame)).toBeDefined()
      }
    },
  )

  test(
    'Given a scripted run whose terminal shape carries no turnComplete - When the stream ends - ' +
      'Then the translator still emits RUN_FINISHED exactly once (the silent-terminal guarantee)',
    () => {
      const { translate, finish } = createEventTranslator(THREAD, RUN)

      const frames = [...translate(silentTerminalEvent() as never), ...finish()]
      const again = finish()

      const finished = frames.filter((frame) => frame.type === 'RUN_FINISHED')
      expect(finished).toHaveLength(1)
      expect(again).toHaveLength(0)
      for (const frame of frames) {
        expect(EventSchema.parse(frame)).toBeDefined()
      }
    },
  )

  test(
    'Given a scripted failing ADK run - When the stream is translated - ' +
      'Then the final frame is RUN_ERROR carrying a top-level message',
    () => {
      const { translate } = createEventTranslator(THREAD, RUN)

      const frames = translate(errorEvent('MODEL_ERROR', 'the model failed') as never)

      // An accepted run is one the client saw start: the error
      // terminal is bracketed by the lazily-emitted RUN_STARTED when
      // the failure fires before any other frame.
      const [frame] = frames.slice(-1)
      expect(frame).toMatchObject({ type: 'RUN_ERROR', message: 'the model failed' })
      expect(RunErrorEventSchema.parse(frame)).toBeDefined()
    },
  )
})
