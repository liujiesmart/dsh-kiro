/**
 * Refusal recovery contract: what the adapter does when Kiro bills a request
 * and answers with no content.
 *
 * The service refuses the exact bytes it was sent, so the only recovery a
 * client owns is a strictly smaller request — and the order the request is made
 * smaller in decides whether the user still has a conversation afterwards.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { TransportRequest, TransportResponse } from '../src/transport.ts'
import type { WireRequest } from '../src/types.ts'

const posted: TransportRequest[] = []
const queue: (() => TransportResponse)[] = []
let fallback: () => TransportResponse

vi.mock('../src/transport.ts', () => ({
  post: (options: TransportRequest) => {
    posted.push(options)
    const next = queue.shift() ?? fallback
    return Promise.resolve(next())
  },
}))

const { KiroAdapter } = await import('../src/adapter.ts')
const { clipSystem, narrowLadder, narrowRequest, NARROWING_LADDER } = await import('../src/refusal.ts')
const { frame, join, metadataFrame, textFrame } = await import('./frames.ts')
const { MODEL_REFUSED_CODE } = await import('../src/translate.ts')
type KiroConnectionOptions = import('../src/adapter.ts').KiroConnectionOptions

const SOURCE = { kind: 'plugin' as const, plugin: 'test' }
/** A system prompt long enough that every rung of the ladder has to cut it. */
const LONG_SYSTEM = `${'S'.repeat(200)}\n`.repeat(200)

function user(text: string): Message {
  return createUserMessage({ content: [{ type: 'text', text }], source: SOURCE })
}

function assistant(text: string): Message {
  return createAssistantMessage({
    content: [{ type: 'text' as const, text }],
    source: { provider: 'dsh-kiro', model: 'claude-opus-5' },
  })
}

/** One successful response body: text plus exact token buckets. */
function okResponse(...frames: Uint8Array[]): TransportResponse {
  const buffer = join(...frames)
  return {
    status: 200,
    headers: {},
    body: (async function* body() {
      yield buffer
    })(),
  }
}

/** A billed request with no assistant event and no stop reason. */
function refusalResponse(percentage = 6.41): TransportResponse {
  return okResponse(
    frame(
      { ':event-type': 'contextUsageEvent', ':message-type': 'event' },
      JSON.stringify({ contextUsagePercentage: percentage }),
    ),
    frame(
      { ':event-type': 'meteringEvent', ':message-type': 'event' },
      JSON.stringify({ unit: 'credit', unitPlural: 'credits', usage: 1 }),
    ),
  )
}

/** One accepted turn. */
function answerResponse(text = 'recovered'): TransportResponse {
  return okResponse(
    textFrame(text),
    metadataFrame({ uncachedInputTokens: 7, outputTokens: 5, totalTokens: 12 }),
  )
}

function connection(extra: Partial<KiroConnectionOptions> = {}): KiroConnectionOptions {
  return {
    region: 'us-east-1',
    defaults: {},
    defaultContextWindow: 200_000,
    models: [{ id: 'claude-opus-5', name: 'Claude Opus 5', thinking: false, inputModalities: ['text', 'image'] }],
    streamIdleTimeoutMs: 300_000,
    tokenExpiryBufferMs: 300_000,
    retryPolicy: {},
    ...extra,
  } as KiroConnectionOptions
}

function adapter(options = connection(), reported: string[][] = []): InstanceType<typeof KiroAdapter> {
  return new KiroAdapter({
    options: () => options,
    resolveToken: () => Promise.resolve({
      accessToken: 'access',
      region: 'us-east-1',
      expiresAt: Date.now() + 60_000,
      authMethod: 'builder-id' as const,
    }),
    onRefusalRecovery: trail => reported.push([...trail]),
  } as never)
}

/** A conversation with real alternation, so history is not empty. */
function conversation(): Message[] {
  return [
    user('m1'), assistant('a1'),
    user('m2'), assistant('a2'),
    user('m3'), assistant('a3'),
    user('m4'), assistant('a4'),
    user('m5'), assistant('a5'),
  ]
}

async function collect(
  instance: InstanceType<typeof KiroAdapter>,
  extra: Partial<GenerateOptions> = {},
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of instance.stream({
    provider: 'dsh-kiro',
    model: 'claude-opus-5',
    system: LONG_SYSTEM,
    messages: [...conversation(), user('current question')],
    ...extra,
  } as GenerateOptions)) {
    chunks.push(chunk)
  }
  return chunks
}

function body(index: number): WireRequest {
  const request = posted[index]
  if (request === undefined) throw new Error(`no request ${index} was posted`)
  return JSON.parse(request.body) as WireRequest
}

function finishOf(chunks: readonly StreamChunk[]): StreamChunk | undefined {
  return chunks.at(-1)
}

describe('refusal narrowing ladder', () => {
  it('clips a system prompt at a paragraph boundary', () => {
    expect(clipSystem(LONG_SYSTEM, 0)).toBe('')
    expect(clipSystem(undefined, 100)).toBe('')
    expect(clipSystem('short', 100)).toBe('short')
    const clipped = clipSystem(LONG_SYSTEM, 1_000)
    expect(clipped.length).toBeLessThanOrEqual(1_000)
    // The cut backs off to a line boundary, so the surviving prompt is a prefix
    // of the original that never ends mid-sentence.
    expect(LONG_SYSTEM.startsWith(clipped)).toBe(true)
    expect(clipped.length % 201).toBe(200)
  })

  it('leaves the conversation alone unless a rung asks for it', () => {
    const options = {
      provider: 'dsh-kiro',
      model: 'claude-opus-5',
      system: LONG_SYSTEM,
      messages: conversation(),
    } as GenerateOptions
    // Rungs 1 and 2 exist to keep the thread: only the system text shrinks.
    const keepsThread = narrowRequest(options, { systemBudget: 0, label: 'rung' })
    expect(keepsThread.messages).toHaveLength(10)
    expect(keepsThread.system).toBe('')
    const trimsThread = narrowRequest(options, { keepHistory: 2, systemBudget: 0, label: 'rung' })
    expect(trimsThread.messages).toHaveLength(2)
    expect(options.messages).toHaveLength(10)
    expect(options.system).toBe(LONG_SYSTEM)
  })

  it('sheds the system prompt before it sheds the conversation', () => {
    const kept = NARROWING_LADDER.map(rung => rung.keepHistory ?? Infinity)
    expect(kept[0]).toBe(Infinity)
    expect(kept[1]).toBe(Infinity)
    // Only the last rung reduces history, and it still keeps recent turns.
    expect(kept.at(-1)).toBe(6)
  })

  it('uses no rungs when recovery is off and honors the attempt bound', () => {
    expect(narrowLadder('off', 3)).toEqual([])
    expect(narrowLadder('narrow', 1)).toHaveLength(1)
    expect(narrowLadder('narrow', 99)).toHaveLength(NARROWING_LADDER.length)
    expect(narrowLadder('narrow', 0)).toEqual([])
  })
})

describe('KiroAdapter refusal recovery', () => {
  beforeEach(() => {
    posted.length = 0
    queue.length = 0
    fallback = () => answerResponse()
  })

  it('retries the refusal and streams the answer', async () => {
    queue.push(() => refusalResponse(), () => answerResponse('recovered'))
    const reported: string[][] = []
    const chunks = await collect(adapter(connection(), reported))

    expect(posted).toHaveLength(2)
    const text = chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
    expect(text).toBe('recovered')
    expect(reported).toEqual([[NARROWING_LADDER[0]?.label]])
    expect(finishOf(chunks)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('keeps the conversation intact when a retry answers', async () => {
    // Multi-turn is the point of the ordering: the retry must still be the same
    // conversation, or the model answers the last message knowing nothing.
    queue.push(() => refusalResponse(), () => answerResponse())
    await collect(adapter())

    const original = body(0).conversationState
    const narrowed = body(1).conversationState
    expect(narrowed.history).toHaveLength(original.history?.length ?? 0)
    expect(narrowed.currentMessage).toEqual(original.currentMessage)
    expect(narrowed.history?.at(-1)).toEqual(original.history?.at(-1))
    expect(narrowed.conversationId).toBe(original.conversationId)
  })

  it('never leaks usage from an attempt it replaced', async () => {
    queue.push(() => refusalResponse(6.41), () => answerResponse())
    const chunks = await collect(adapter())
    const usage = chunks.filter(chunk => chunk.type === 'usage')
    // One price for one call: the refused attempt is not billed to the consumer.
    expect(usage).toHaveLength(1)
    expect(usage[0]).toEqual({ type: 'usage', usage: { inputTokens: 7, outputTokens: 5 } })
  })

  it('climbs the whole ladder before reporting the refusal', async () => {
    // A refusal that survives every rung is a refusal of the smallest request
    // the adapter is willing to send, so the ladder is spent exactly once.
    fallback = () => refusalResponse()
    const chunks = await collect(adapter())
    expect(chunks.length).toBeGreaterThan(0)
    expect(posted).toHaveLength(1 + NARROWING_LADDER.length)
    // The last rung keeps recent turns and carries no system prompt at all.
    const last = body(posted.length - 1)
    expect(JSON.stringify(last)).not.toContain('S'.repeat(200))
    expect(last.conversationState.history?.length ?? 0).toBeLessThanOrEqual(6)
  })

  it('names every retry on the terminal refusal', async () => {
    fallback = () => refusalResponse()
    const chunks = await collect(adapter())
    const finish = finishOf(chunks)
    expect(finish?.type === 'finish' ? finish.reason : undefined).toMatchObject({
      kind: 'error',
      failure: { code: MODEL_REFUSED_CODE },
    })
    const message = finish?.type === 'finish' && finish.reason.kind === 'error'
      ? finish.reason.failure.message
      : ''
    expect(message).toContain('6.41% of the context window')
    expect(message).toContain('recovery attempted:')
    expect(message).toContain('trimmed the system prompt')
    expect(message).toContain('dropped the system prompt')
    expect(message).toContain('last 6 messages')
  })

  it('reports the first refusal unchanged when recovery is off', async () => {
    fallback = () => refusalResponse()
    const chunks = await collect(adapter(connection({ refusalRecovery: 'off' })))
    expect(posted).toHaveLength(1)
    const failure = chunks.at(-1)?.type === 'finish' && chunks.at(-1)?.reason.kind === 'error'
      ? (chunks.at(-1) as { reason: { failure: { message: string, code: string } } }).reason.failure
      : undefined
    expect(failure?.code).toBe(MODEL_REFUSED_CODE)
    expect(failure?.message).not.toContain('recovery attempted:')
  })

  it('stops at the configured attempt bound', async () => {
    fallback = () => refusalResponse()
    await collect(adapter(connection({ refusalRecoveryAttempts: 1 })))
    expect(posted).toHaveLength(2)
  })

  it('starts the next turn of a session where the last one was answered', async () => {
    // Each refused attempt is billed, and a session re-sends the same system
    // prompt and model every turn, so paying the same refusals again is waste.
    queue.push(() => refusalResponse(), () => answerResponse())
    const instance = adapter()
    await collect(instance, { sessionId: 'session-a' } as Partial<GenerateOptions>)
    expect(posted).toHaveLength(2)

    posted.length = 0
    await collect(instance, { sessionId: 'session-a' } as Partial<GenerateOptions>)
    expect(posted).toHaveLength(1)
    // The remembered rung is the one that answered: same conversation, and the
    // system prompt arrives already clipped instead of being sent whole again.
    const second = body(0)
    expect(second.conversationState.history).toHaveLength(10)
    const systemCharacters = (JSON.stringify(second).match(/S/gu) ?? []).length
    expect(systemCharacters).toBeLessThanOrEqual(8_100)
  })
})