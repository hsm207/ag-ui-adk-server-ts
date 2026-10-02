/**
 * The protocol surface: this file serves the wire contract boundary —
 * the curated slice of @ag-ui/core this package supports in v0.1, re-exported so consumers depend on the protocol
 * types without reaching into the dependency directly. Nothing here is
 * hand-rolled: the dialect is @ag-ui/core's, always.
 *
 * This is also the package's SINGLE dependency edge to @ag-ui/core:
 * every module imports its protocol symbols from here (http/ → run/ →
 * translation/ → protocol.ts → @ag-ui/core), so the
 * curated slice is enforced in one place instead of documented and
 * ignored.
 */

export type {
  BaseEvent,
  RunAgentInput,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
} from '@ag-ui/core'

export { EventType } from '@ag-ui/core'

/**
 * The input contract's validation schema — the protocol's own
 * artifact (zod ships with @ag-ui/core's schemas entry, not a
 * separate dependency). The HTTP face validates at the boundary with
 * it; consumers may reuse it to validate client-posted input.
 */
export { RunAgentInputSchema } from '@ag-ui/core/schemas'
