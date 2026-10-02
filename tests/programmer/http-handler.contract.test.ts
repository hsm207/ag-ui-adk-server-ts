import { describe, expect, test } from 'vitest'
import { EventSchema } from '@ag-ui/core/schemas'
import { AGUI_MEDIA_TYPE } from '@ag-ui/encoder'

import { createAdkAgent } from '../../src/run/createAdkAgent.ts'
import { createAdkHttpHandler } from '../../src/http/createAdkHttpHandler.ts'
import { InMemorySessions } from '../fixtures/session-service.ts'
import type { AdkAgentOptions } from '../../src/run/contracts.ts'

/*
 * The Humble Object boundary, tested directly: the handler is the
 * package's single framework adapter, so its own contract (status
 * codes, headers, framing, negotiation) is pinned here against plain
 * web-standard Requests — no Express between the test and the code
 * (the app tier proves the bridge; this tier proves the adapter).
 * Decoding protobuf frames back to events is the encoder's own
 * suite's job; ours ends at the negotiated content type and a
 * non-empty binary body.
 */

const makeHandler = () => {
  const agent = createAdkAgent({
    agent: {
      runAsync: (_input: unknown) =>
        (async function* () {
          yield { author: 'widget_agent', content: { parts: [{ text: 'ok.' }] } }
          yield { author: 'widget_agent', turnComplete: true }
        })(),
    },
    appName: 'app-test',
    sessionService: new InMemorySessions() as unknown as AdkAgentOptions['sessionService'],
  })
  return createAdkHttpHandler(agent)
}

const post = (handler: ReturnType<typeof makeHandler>, body: string, accept?: string) =>
  handler(
    new Request('http://localhost/agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accept !== undefined ? { Accept: accept } : {}),
      },
      body,
    }),
  )

const VALID = JSON.stringify({
  threadId: 'thread-h',
  runId: 'run-h',
  messages: [{ id: 'msg-h', role: 'user', content: 'hi' }],
})

describe('AdkHttpHandler', () => {
  test('Given a body that is not JSON - When posted - Then the response is 400 with an explanation', async () => {
    const response = await post(makeHandler(), '{not json')

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toContain('invalid JSON')
  })

  test('Given a JSON body that fails the RunAgentInput schema - When posted - Then the response is 422 naming the schema reason', async () => {
    const response = await post(makeHandler(), JSON.stringify({ messages: [] }))

    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toContain('threadId')
  })

  test('Given a valid input - When posted - Then the stream is 200 SSE and every frame schema-parses', async () => {
    const response = await post(makeHandler(), VALID)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const frames = (await response.text())
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)))
    expect(frames[0]).toMatchObject({ type: 'RUN_STARTED' })
    for (const frame of frames) {
      expect(EventSchema.parse(frame)).toBeDefined()
    }
  })

  test(
    'Given a request whose Accept header negotiates protobuf - When posted - ' +
      'Then the response is the AG-UI protobuf media type with a non-empty binary body (not silently SSE)',
    async () => {
      const response = await post(makeHandler(), VALID, AGUI_MEDIA_TYPE)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain(AGUI_MEDIA_TYPE)
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
    },
  )

  test('Given no Accept header - When posted - Then the response stays SSE (the default dialect)', async () => {
    const response = await post(makeHandler(), VALID)

    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })

  test(
    'Given a consumer that cancels mid-stream - When the response body is cancelled - ' +
      'Then the source run is abandoned (its finally runs) instead of streaming to nobody',
    async () => {
      const generatorFinishes = new Promise<void>((resolve) => {
        const agent = createAdkAgent({
          agent: {
            runAsync: () =>
              (async function* () {
                try {
                  for (let index = 0; index < 100; index++) {
                    yield { author: 'widget_agent', content: { parts: [{ text: 'x' }] } }
                  }
                } finally {
                  resolve()
                }
              })(),
          },
          appName: 'app-test',
          sessionService: new InMemorySessions() as unknown as AdkAgentOptions['sessionService'],
        })
        const handler = createAdkHttpHandler(agent)
        void handler(
          new Request('http://localhost/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: VALID,
          }),
        ).then(async (response) => {
          const reader = response.body!.getReader()
          await reader.read()
          await reader.cancel()
        })
      })

      await generatorFinishes
    },
  )
})
