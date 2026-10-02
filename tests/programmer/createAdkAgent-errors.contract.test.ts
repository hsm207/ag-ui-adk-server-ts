import { describe, expect, test } from 'vitest'

import { EventSchema } from '@ag-ui/core/schemas'

import { executeRun } from '../../src/run/run.ts'
import type { RunDeps } from '../../src/run/contracts.ts'
import { createEventTranslator } from '../../src/translation/event-translator.ts'

/*
 * The defect this pins (real Gemini, 2026-09-30): a throw from the
 * run orchestration surfaced as a swallowed generator error — the
 * handler's finally closed the stream, the client got a 200 with an
 * empty SSE body and no RUN_ERROR. The run orchestration owns the
 * error boundary: the translator's error path exists for exactly
 * this, and the terminal guarantee (exactly one closing frame, always
 * a schema-valid one) must hold when the runner itself fails.
 */

const deps = (runner: RunDeps['runner']): RunDeps => ({
  sessionService: {
    getOrCreateSession: async () => ({ id: 'thread-err', state: {}, events: [] }),
    appendEvent: async () => undefined,
  },
  runner,
  owningAgent: 'widget_agent',
  appName: 'app-test',
  userId: 'u',
  stateRootKey: '_ag_ui_state',
})

const input = {
  threadId: 'thread-err',
  runId: 'run-err',
  messages: [{ role: 'user', content: 'Please turn the button red.' }],
}

describe('ExecuteRunErrorBoundary', () => {
  test(
    'Given a runner that throws on invocation - When the run is executed - ' +
      'Then the stream is RUN_STARTED then RUN_ERROR with a top-level message (never a thrown error)',
    async () => {
      const frames = []
      for await (const frame of executeRun(
        deps({
          runAsync: () => {
            throw new Error('Session not found: thread-err')
          },
        }),
        input,
        createEventTranslator,
      )) {
        frames.push(frame)
      }

      expect(frames.map((frame) => frame.type)).toEqual(['RUN_STARTED', 'RUN_ERROR'])
      expect(frames[1]).toMatchObject({ message: 'Session not found: thread-err' })
      for (const tryFrame of frames) {
        expect(EventSchema.parse(tryFrame)).toBeDefined()
      }
    },
  )

  test(
    'Given a runner whose stream throws mid-flight - When the run is executed - ' +
      'Then the frames already streamed stand and RUN_ERROR closes the run exactly once',
    async () => {
      const frames = []
      for await (const frame of executeRun(
        deps({
          runAsync: () =>
            (async function* () {
              yield {
                author: 'widget_agent',
                content: { parts: [{ text: 'partial ans' }] },
                partial: true,
              }
              throw new Error('mid-stream model failure')
            })(),
        }),
        input,
        createEventTranslator,
      )) {
        frames.push(frame)
      }

      expect(frames[0]).toMatchObject({ type: 'RUN_STARTED' })
      expect(frames.at(-1)).toMatchObject({
        type: 'RUN_ERROR',
        message: 'mid-stream model failure',
      })
      const errorCount = frames.filter((frame) => frame.type === 'RUN_ERROR').length
      expect(errorCount).toBe(1)
      for (const tryFrame of frames) {
        expect(EventSchema.parse(tryFrame)).toBeDefined()
      }
    },
  )
})
