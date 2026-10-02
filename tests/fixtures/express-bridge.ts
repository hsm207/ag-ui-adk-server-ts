/**
 * The documented glue recipe as a fixture: Express hosting the
 * web-standard handler (the README's documented adapter), plus the
 * SSE `data:`-line reader both application suites consume. Extracted
 * because the bridge is the thing under test's DOCUMENTED deployment
 * shape, not per-suite noise — and because two copies of it had
 * already drifted once.
 */

import express from 'express'

import type { AdkHttpHandler } from '../../src/http/createAdkHttpHandler.ts'

/** Hosts the handler the way a consumer would (binding is `listen`'s job). */
export const bridgeToExpress = (handler: AdkHttpHandler): express.Express => {
  const app = express()
  app.use(express.json())
  app.post('/agent', (req, res) => {
    void handler(
      new Request('http://localhost/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      }),
    ).then((webRes) => {
      res.status(webRes.status)
      webRes.headers.forEach((value, key) => res.setHeader(key, value))
      if (webRes.body === null) {
        res.end()
        return
      }
      const reader = webRes.body.getReader()
      void (async () => {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
        res.end()
      })()
    })
  })
  return app
}

/**
 * POSTs the body and returns the raw SSE `data:` lines (prefix
 * intact — `parseFrame` owns the stripping) plus the response for
 * header/status assertions.
 */
export const postSse = async (
  port: number,
  body: object,
): Promise<{ readonly status: number; readonly contentType: string; readonly lines: string[] }> => {
  const response = await fetch(`http://localhost:${port}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  const lines = raw.split('\n').filter((line) => line.startsWith('data: '))
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    lines,
  }
}

/** Boots the app on the port and returns its closer. */
export const listen = (app: express.Express, port: number): (() => Promise<void>) => {
  const server = app.listen(port)
  return () => new Promise((resolve) => server.close(() => resolve(undefined)))
}

/**
 * Parses one `data:` line into the caller's frame shape ([] on junk:
 * non-JSON, non-object, or a missing `type`). The full wire object is
 * returned — never a reduction — so schema assertions see exactly
 * what rode the stream.
 */
export const parseFrame = <T>(line: string): T | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(line.slice('data: '.length))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  if (!('type' in parsed) || typeof parsed.type !== 'string') return undefined
  return parsed as T
}
