/**
 * The session port implementation: get-or-create over the session
 * service, keyed by the AG-UI threadId. Sessions are resolved per
 * thread, never minted per request, so conversation history
 * accumulates exactly once per thread.
 */

import type { SessionLike, SessionServicePort } from './contracts.js'

/**
 * Resolves the thread's session; the same threadId always yields the
 * same session. The identity triple is the port's own request shape —
 * the AG-UI threadId plays the sessionId role, visible here at the
 * call boundary.
 */
export const getOrCreateThreadSession = (
  service: SessionServicePort,
  identity: { readonly appName: string; readonly userId: string; readonly sessionId: string },
): Promise<SessionLike> => service.getOrCreateSession(identity)
