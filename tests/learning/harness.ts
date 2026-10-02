import { InMemorySessionService, LlmAgent, Runner, type Event } from '@google/adk'
import { z } from 'zod'

/**
 * The instrument for this package's real-model learning tier: ADC-only
 * Vertex access, no API keys; credentials resolve through the
 * environment's metadata server. Ported from the verified learning
 * harness that first proved the client-proxied tool round trip (the
 * verified behaviors recorded in this tier's tests).
 *
 * Runbook:
 *   npm run test:learning:llm
 *   # overrides when needed:
 *   GOOGLE_CLOUD_PROJECT=<project> LEARNING_MODEL=gemini-2.5-flash npm run test:learning:llm
 */

const LEARNING_PROJECT = process.env['GOOGLE_CLOUD_PROJECT'] ?? 'compute-cluster-492317'
const DEFAULT_LEARNING_MODEL = 'gemini-3.8-flash'

type LearningRegion = 'us-central1' | 'global'
type AdkModel = InstanceType<(typeof import('@google/adk'))['Gemini']>
type AgentConfig = ConstructorParameters<typeof LlmAgent>[0]

/**
 * One probe: an agent and its runner, built and wired in a single
 * call over ADC-only Vertex. Without options the probe is a brief
 * assistant on the default model; the options re-point it at a tool,
 * a region, a named app, or a caller-owned session service (pass the
 * SAME instance to any wrapper under test — see `sessionService`).
 */
export async function createProbe(
  name: string,
  options: {
    /** Static instruction text or a live provider (ADK accepts both). */
    instruction?: AgentConfig['instruction']
    tools?: NonNullable<AgentConfig['tools']>
    region?: LearningRegion
    appName?: string
    /**
     * The session service the Runner is built over. Pass the SAME
     * instance to any wrapper under test — the Runner resolves sessions
     * in its own service and throws 'Session not found' otherwise.
     */
    sessionService?: InstanceType<(typeof import('@google/adk'))['InMemorySessionService']>
  } = {},
): Promise<Runner> {
  const agentConfig: AgentConfig = {
    name,
    model: await createAdcModel(learningModelName(), options.region),
    instruction: options.instruction ?? BRIEF_ASSISTANT_INSTRUCTION,
  }
  if (options.tools !== undefined) agentConfig.tools = options.tools

  const agent = new LlmAgent(agentConfig)
  return createLearningRunner(agent, options.appName, options.sessionService)
}

function createLearningRunner(
  agent: LlmAgent,
  appName = 'learning_tests',
  sessionService = new InMemorySessionService(),
): Runner {
  return new Runner({ appName, agent, sessionService })
}

async function createAdcModel(
  modelName: string,
  region: LearningRegion = 'global',
): Promise<AdkModel> {
  const { Gemini } = await import('@google/adk')
  return new Gemini({
    model: modelName,
    vertexai: true,
    project: LEARNING_PROJECT,
    location: region,
  })
}

function learningModelName(): string {
  return process.env['LEARNING_MODEL'] ?? DEFAULT_LEARNING_MODEL
}

/** Creates a persistent session on the runner's session service and returns its id. */
export async function createLearningSession(runner: Runner, userId: string): Promise<string> {
  const session = await runner.sessionService.createSession({
    appName: runner.appName,
    userId,
  })
  return session.id
}

/** Fetches the session so tests can assert on its accumulated events. */
export async function getLearningSession(runner: Runner, userId: string, sessionId: string) {
  return runner.sessionService.getSession({
    appName: runner.appName,
    userId,
    sessionId,
  })
}

/** The shared instruction for probes that test plumbing, not persona. */
export const BRIEF_ASSISTANT_INSTRUCTION =
  'You are a friendly assistant. Answer in one short sentence.'

export type { Event as AdkEvent }
export { z }
