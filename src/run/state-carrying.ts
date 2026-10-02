/**
 * The state-carrying port: each run hands the RunAgentInput's state
 * to the runner as a stateDelta under the reserved root key, so the
 * client's on-screen state is ground truth for the next model call.
 * The runner owns the session-state write; the wrapper only computes
 * the delta.
 */

/**
 * The stateDelta carrying the client state under the reserved root
 * key ([]-free: undefined when there is nothing to carry). This run's
 * payload replaces the previous one wholesale under the key — no
 * merge with stale client state.
 */
export const clientStateDelta = (
  rootKey: string,
  state: unknown,
): Record<string, unknown> | undefined => {
  if (state === undefined || state === null) return undefined
  if (typeof state !== 'object') return undefined
  return { [rootKey]: state }
}
