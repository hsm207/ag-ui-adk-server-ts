import { describe, expect, test } from 'vitest'

import { createEvent } from '@google/adk'

import { stitchToolResults } from '../../src/run/tool-results.ts'

/*
 * Evidenced shape (real Gemini, 2026-09-30, the application llm
 * probe): under StreamingMode.SSE with pauseOnToolCalls, adk-js
 * closes the paused run with a trailing event authored by the agent
 * whose content carries NO parts at all (the flow's metadata event).
 * A naive `parts[0]` scan over such an event throws TypeError — the
 * first real-tool-call follow-up crashed before any frame was
 * emitted.
 */

const sessionWithEmptyPartsTrailer = () => ({
  id: 'thread-scan',
  state: {},
  events: [
    createEvent({
      author: 'user',
      content: { role: 'user', parts: [{ text: 'Please turn the button red.' }] },
    }),
    createEvent({
      author: 'widget_agent',
      content: {
        role: 'model',
        parts: [
          { functionCall: { id: 'call_scan', name: 'set_button_color', args: { color: 'red' } } },
        ],
      },
    }),
    createEvent({ author: 'widget_agent', content: { role: 'model', parts: [] } }),
  ],
})

describe('ToolResultStitcher', () => {
  test(
    'Given a session log holding a pending call and a trailing event with no parts - ' +
      'When the client result for that call is stitched - Then exactly one FunctionResponse is appended (the scan survives empty-parts events)',
    async () => {
      const session = sessionWithEmptyPartsTrailer()
      const appended: unknown[] = []

      const count = await stitchToolResults(
        {
          appendEvent: async (input: { event: unknown }) => {
            appended.push(input.event)
          },
        },
        session,
        'widget_agent',
        [
          {
            role: 'tool',
            toolCallId: 'call_scan',
            content: JSON.stringify({ status: 'done', color: 'red' }),
          },
        ],
      )

      expect(count).toBe(1)
      expect(appended).toHaveLength(1)
      const response = (
        appended[0] as {
          content?: { parts?: Array<{ functionResponse?: { id?: string; name?: string } }> }
        }
      ).content?.parts?.[0]?.functionResponse
      expect(response?.id).toBe('call_scan')
      expect(response?.name).toBe('set_button_color')
    },
  )

  test(
    'Given a tool result whose content is a JSON object - When stitched - ' +
      'Then the FunctionResponse carries that object verbatim as the model-facing result',
    async () => {
      const session = sessionWithEmptyPartsTrailer()
      const appended: unknown[] = []

      await stitchToolResults(
        {
          appendEvent: async (input: { event: unknown }) => {
            appended.push(input.event)
          },
        },
        session,
        'widget_agent',
        [
          {
            role: 'tool',
            toolCallId: 'call_scan',
            content: JSON.stringify({ status: 'done', color: 'red' }),
          },
        ],
      )

      const response = (
        appended[0] as {
          content?: { parts?: Array<{ functionResponse?: { response?: unknown } }> }
        }
      ).content?.parts?.[0]?.functionResponse?.response
      expect(response).toEqual({ status: 'done', color: 'red' })
    },
  )

  test(
    'Given the same tool result delivered TWICE inside one POST - When stitched - ' +
      'Then exactly one FunctionResponse is appended (answered-once holds within the batch, not just across runs)',
    async () => {
      const session = sessionWithEmptyPartsTrailer()
      const appended: unknown[] = []

      const count = await stitchToolResults(
        {
          appendEvent: async (input: { event: unknown }) => {
            appended.push(input.event)
          },
        },
        session,
        'widget_agent',
        [
          {
            role: 'tool',
            toolCallId: 'call_scan',
            content: JSON.stringify({ status: 'done', color: 'red' }),
          },
          {
            role: 'tool',
            toolCallId: 'call_scan',
            content: JSON.stringify({ status: 'done', color: 'red' }),
          },
        ],
      )

      expect(count).toBe(1)
      expect(appended).toHaveLength(1)
    },
  )
})
