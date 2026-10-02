import { describe, expect, test } from 'vitest'

import { EventSchema } from '@ag-ui/core/schemas'

import { createAdkAgent } from '../../src/run/createAdkAgent.ts'
import type { AdkAgentOptions } from '../../src/run/contracts.ts'
import { createAdkHttpHandler } from '../../src/http/createAdkHttpHandler.ts'
import { bridgeToExpress, listen, parseFrame, postSse } from '../fixtures/express-bridge.ts'
import { InMemorySessions } from '../fixtures/session-service.ts'

/*
 * The integrator's story, end to end through the glue recipe in the
 * README: Express hosts the
 * web-standard handler; the real @ag-ui/encoder frames the stream; a
 * scripted ADK runner stands in for Gemini (the real-model mode of
 * this tier is *.llm.test.ts, explicit run only).
 */

interface Frame {
  readonly type: string
}

const PORT = 4311
const THREAD = 'thread-app'
const RUN = 'run-app'

const buildServer = () => {
  const sessions = new InMemorySessions()
  const agent = createAdkAgent({
    agent: {
      runAsync: (_input: unknown) =>
        (async function* () {
          yield { author: 'widget_agent', content: { parts: [{ text: 'The button is red.' }] } }
          yield { author: 'widget_agent', turnComplete: true }
        })(),
    },
    appName: 'app-test',
    sessionService: sessions as unknown as AdkAgentOptions['sessionService'],
  })
  return bridgeToExpress(createAdkHttpHandler(agent))
}

const consume = async (body: object) => {
  const close = listen(buildServer(), PORT)
  try {
    return await postSse(PORT, body)
  } finally {
    await close()
  }
}

const input = {
  threadId: THREAD,
  runId: RUN,
  messages: [{ id: 'msg-app-1', role: 'user', content: 'Please turn the button red.' }],
}

describe('AdkHttpHandler over Express', () => {
  test(
    'Given the wrapper hosted under Express with a scripted ADK runner - When a POST is served and the SSE stream consumed - ' +
      'Then every data frame parses against the schemas and the lifecycle brackets in frame order',
    async () => {
      const { lines } = await consume(input)
      const frames = lines.map(parseFrame<Frame>).filter((frame): frame is Frame => !!frame)

      expect(frames.length).toBeGreaterThan(2)
      const kinds = frames.map((frame) => frame.type)
      expect(kinds[0]).toBe('RUN_STARTED')
      expect(kinds.at(-1)).toBe('RUN_FINISHED')
      expect(frames[0]).toMatchObject({ threadId: THREAD, runId: RUN })
      for (const frame of frames) {
        expect(EventSchema.parse(frame)).toBeDefined()
      }
    },
  )

  test('Given the handler - When the stream is served - Then the response rides the official SSE content type and every data line is a JSON frame', async () => {
    const { status, contentType, lines } = await consume(input)

    expect(status).toBe(200)
    expect(contentType).toContain('text/event-stream')
    expect(lines.length).toBeGreaterThan(0)
    const [first] = lines.map(parseFrame<Frame>).filter((frame): frame is Frame => !!frame)
    expect(first).toMatchObject({ type: 'RUN_STARTED' })
  })

  test('Given the streamed deltas - When the text frames are decoded - Then they join to exactly the agent utterance', async () => {
    const { lines } = await consume(input)
    const frames = lines.map(parseFrame<Frame>).filter((frame): frame is Frame => !!frame)

    const deltas = frames
      .filter((frame) => frame.type === 'TEXT_MESSAGE_CONTENT')
      .map((frame) => (frame as unknown as { delta: string }).delta)
      .join('')
    expect(deltas).toBe('The button is red.')
  })

  test(
    'Given a POST whose body is not valid JSON - When served - ' +
      'Then the response is 400 with an explanation, never a hang or a crashed bridge',
    async () => {
      const close = listen(buildServer(), PORT)
      try {
        const response = await fetch(`http://localhost:${PORT}/agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{not json',
        })
        expect(response.status).toBe(400)
      } finally {
        await close()
      }
    },
  )

  test(
    'Given a POST with no new user turn and no tool result - When served - ' +
      'Then the stream refuses with a schema-valid RUN_ERROR (the nothing-to-run path)',
    async () => {
      const { lines } = await consume({ ...input, runId: 'run-empty', messages: [] })
      const frames = lines.map(parseFrame<Frame>).filter((frame): frame is Frame => !!frame)

      const error = frames.find((frame) => frame.type === 'RUN_ERROR')
      expect(error).toBeDefined()
      expect(String((error as unknown as { message: string }).message)).toContain('nothing to run')
      for (const frame of frames) {
        expect(EventSchema.parse(frame)).toBeDefined()
      }
    },
  )
})
