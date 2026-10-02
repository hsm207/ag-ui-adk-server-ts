/**
 * The package's only framework-coupled module: one adapter over the
 * web-standard Request/Response pair. It validates the posted input,
 * then streams the run's AG-UI events, encoded frame by frame — SSE
 * by default, the AG-UI protobuf media type when the request's
 * Accept header asks for it (both via @ag-ui/encoder).
 */

import { EventEncoder } from '@ag-ui/encoder'

import { EventType, RunAgentInputSchema, type BaseEvent, type RunAgentInput } from '../protocol.js'

import type { AdkAgent } from '../run/contracts.js'

/** One web-standard request in, the event stream as the response. */
export type AdkHttpHandler = (request: Request) => Promise<Response>

/**
 * Wire an AdkAgent to HTTP. A malformed body is a 400 and a
 * schema-invalid input a 422 — both sent before any byte of the
 * stream, while the status code can still be set. Once the stream
 * starts, the status is fixed at 200, so a mid-run failure goes out
 * as a RUN_ERROR frame instead.
 */
export const createAdkHttpHandler =
  (adkAgent: AdkAgent): AdkHttpHandler =>
  async (request) => {
    const body = await parseJsonBody(request)
    if (body === undefined) {
      return new Response('invalid JSON body', { status: 400 })
    }

    const parsed = RunAgentInputSchema.safeParse(body)
    if (!parsed.success) {
      return new Response(`invalid RunAgentInput: ${parsed.error.message}`, { status: 422 })
    }

    const encoder = eventEncoder(request.headers.get('accept'))
    const events = adkAgent.run(parsed.data as RunAgentInput)
    return new Response(toEventStream(events, encoder), {
      status: 200,
      headers: {
        'Content-Type': encoder.getContentType(),
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

/**
 * The request body parsed as JSON. Undefined means the text is not
 * JSON at all — JSON.parse never produces undefined from valid text,
 * so the sentinel is unambiguous.
 */
const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return JSON.parse(await request.text())
  } catch {
    return undefined
  }
}

/**
 * One encoder per request, keyed off the Accept header: SSE is the
 * default, the AG-UI protobuf media type when asked. Nothing is
 * shared between concurrent runs.
 */
const eventEncoder = (accept: string | null): EventEncoder =>
  new EventEncoder(accept !== null ? { accept } : undefined)

/**
 * The run as a pull-based byte stream. Each pull takes one event from
 * the generator, so a slow reader slows the model; cancelling the
 * stream returns the generator, whose finally stops generation for
 * the client that left. A self-filling queue would keep reading after
 * the reader is gone.
 */
const toEventStream = (
  events: AsyncIterable<BaseEvent>,
  encoder: EventEncoder,
): ReadableStream<Uint8Array> => {
  const iterator = events[Symbol.asyncIterator]()
  const binary = encoder.getContentType() !== 'text/event-stream'
  const encodeFrame = (event: BaseEvent): Uint8Array =>
    binary ? encoder.encodeBinary(event) : new TextEncoder().encode(encoder.encodeSSE(event))

  return new ReadableStream<Uint8Array>({
    pull: (out) => deliverNext(iterator, encodeFrame, out),
    async cancel() {
      // Returning the generator runs its finally, which stops the model.
      await iterator.return?.()
    },
  })
}

/**
 * One pull of the stream: the next event encoded into `out`, or the
 * stream closed cleanly when the run is done. A failure thrown by the
 * source is delivered as a RUN_ERROR frame instead of a broken
 * connection — the status code is already on the wire. The core
 * reports its own failures; this catch exists for one thrown outside
 * it.
 */
const deliverNext = async (
  iterator: AsyncIterator<BaseEvent>,
  encodeFrame: (event: BaseEvent) => Uint8Array,
  out: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> => {
  try {
    const next = await iterator.next()
    if (next.done) {
      out.close()
      return
    }
    out.enqueue(encodeFrame(next.value))
  } catch (error) {
    out.enqueue(encodeFrame(runErrorFrame(error)))
    out.close()
  }
}

/** The RUN_ERROR frame reporting a failure thrown outside the core. */
const runErrorFrame = (error: unknown): BaseEvent =>
  ({
    type: EventType.RUN_ERROR,
    message: error instanceof Error ? error.message : 'stream failure',
  }) as BaseEvent
