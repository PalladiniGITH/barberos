import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

const DEFAULT_EVOLUTION_WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] as const

type EvolutionConfig = {
  apiUrl: string
  apiKey: string
  instance: string
  webhookSecret: string
  publicAppUrl: string
}

type EvolutionRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

type UnknownRecord = Record<string, unknown>

export type EvolutionWebhookEvent =
  | 'MESSAGES_UPSERT'
  | 'CONNECTION_UPDATE'
  | (string & {})

export interface EvolutionConnectionStatus {
  instanceName: string
  state: string | null
  raw: unknown
}

export interface EvolutionSendTextInput {
  number: string
  text: string
  delay?: number
  instance?: string
}

export interface EvolutionWebhookConfigResult {
  instanceName: string
  webhookUrl: string
  events: string[]
  raw: unknown
}

export interface EvolutionNormalizedWebhookPayload {
  originalEvent: string
  event: string
  instanceName: string | null
  messageId: string | null
  remoteJid: string | null
  remotePhone: string | null
  contactName: string | null
  text: string | null
  messageType: string | null
  timestamp: Date | null
  fromMe: boolean
  isGroup: boolean
  isStatusBroadcast: boolean
  shouldProcessInboundMessage: boolean
  ignoreReason: string | null
  dedupeKey: string
  raw: unknown
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as UnknownRecord
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asBoolean(value: unknown) {
  return value === true
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    const normalized = asString(value)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function pickObject(...values: unknown[]) {
  for (const value of values) {
    const normalized = asRecord(value)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function pickPrimaryRecord(...values: unknown[]) {
  for (const value of values) {
    const directRecord = asRecord(value)
    if (directRecord) {
      return directRecord
    }

    const arrayRecord = asRecord(asArray(value)[0])
    if (arrayRecord) {
      return arrayRecord
    }
  }

  return null
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function normalizeEvolutionEventName(value: string | null) {
  if (!value) {
    return 'UNKNOWN'
  }

  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()

  return normalized || 'UNKNOWN'
}

function getPublicAppUrl() {
  const resolved =
    process.env.PUBLIC_APP_URL
    ?? process.env.NEXTAUTH_URL
    ?? process.env.NEXT_PUBLIC_APP_URL

  if (!resolved) {
    throw new Error('PUBLIC_APP_URL nao configurada para a integracao Evolution.')
  }

  return normalizeBaseUrl(resolved)
}

function getEvolutionConfig(): EvolutionConfig {
  const apiUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET

  if (!apiUrl) {
    throw new Error('EVOLUTION_API_URL nao configurada.')
  }

  if (!apiKey) {
    throw new Error('EVOLUTION_API_KEY nao configurada.')
  }

  if (!instance) {
    throw new Error('EVOLUTION_INSTANCE nao configurada.')
  }

  if (!webhookSecret) {
    throw new Error('EVOLUTION_WEBHOOK_SECRET nao configurada.')
  }

  return {
    apiUrl: normalizeBaseUrl(apiUrl),
    apiKey,
    instance,
    webhookSecret,
    publicAppUrl: getPublicAppUrl(),
  }
}

function buildEvolutionUrl(pathname: string) {
  return `${getEvolutionConfig().apiUrl}${pathname}`
}

async function evolutionRequest<T = unknown>(pathname: string, init: EvolutionRequestInit = {}) {
  const config = getEvolutionConfig()
  const response = await fetch(`${config.apiUrl}${pathname}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      apikey: config.apiKey,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })

  const text = await response.text()
  let data: unknown = null

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    throw new Error(
      `Evolution API ${response.status}: ${typeof data === 'object' && data && 'message' in data ? String((data as UnknownRecord).message) : typeof data === 'string' && data ? data : response.statusText}`
    )
  }

  return data as T
}

function safeCompare(left: string | null, right: string | null) {
  if (!left || !right) {
    return false
  }

  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeRemotePhone(value: string | null) {
  if (!value) {
    return null
  }

  const digits = value.replace(/\D/g, '')
  return digits || null
}

function extractMessageText(messageRecord: UnknownRecord | null): string | null {
  if (!messageRecord) {
    return null
  }

  return pickString(
    messageRecord.conversation,
    pickObject(messageRecord.extendedTextMessage)?.text,
    pickObject(messageRecord.imageMessage)?.caption,
    pickObject(messageRecord.videoMessage)?.caption,
    pickObject(messageRecord.documentMessage)?.caption,
    pickObject(messageRecord.buttonsResponseMessage)?.selectedDisplayText,
    pickObject(messageRecord.templateButtonReplyMessage)?.selectedDisplayText,
    pickObject(messageRecord.listResponseMessage)?.title,
    pickObject(messageRecord.listResponseMessage)?.singleSelectReply && pickObject(messageRecord.listResponseMessage)?.singleSelectReply
      ? pickObject(pickObject(messageRecord.listResponseMessage)?.singleSelectReply)?.selectedRowId
      : null
  )
}

function extractMessageType(messageRecord: UnknownRecord | null) {
  if (!messageRecord) {
    return null
  }

  const [messageType] = Object.keys(messageRecord)
  return messageType ?? null
}

function extractMessageTimestamp(value: unknown) {
  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'number') {
    return new Date(value > 10_000_000_000 ? value : value * 1000)
  }

  if (typeof value === 'string') {
    const numeric = Number(value)

    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    }

    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return null
}

function buildDedupeKey(input: {
  event: string
  instanceName: string | null
  messageId: string | null
  remoteJid: string | null
  timestamp: Date | null
  text: string | null
}) {
  const rawKey = input.messageId
    ? `${input.event}:${input.instanceName ?? 'unknown'}:${input.messageId}`
    : `${input.event}:${input.instanceName ?? 'unknown'}:${input.remoteJid ?? 'unknown'}:${input.timestamp?.toISOString() ?? 'no-ts'}:${input.text ?? 'no-text'}`

  return createHash('sha256').update(rawKey).digest('hex')
}

export function getEvolutionInstanceName() {
  return getEvolutionConfig().instance
}

export function getEvolutionWebhookUrl() {
  const config = getEvolutionConfig()
  const url = new URL('/api/webhooks/evolution', config.publicAppUrl)
  url.searchParams.set('secret', config.webhookSecret)
  return url.toString()
}

export function isEvolutionWebhookRequestAuthorized(request: Request) {
  const config = getEvolutionConfig()
  const requestUrl = new URL(request.url)
  const providedSecret =
    requestUrl.searchParams.get('secret')
    ?? request.headers.get('x-webhook-secret')
    ?? request.headers.get('x-evolution-secret')

  return safeCompare(providedSecret, config.webhookSecret)
}

export async function sendEvolutionTextMessage(input: EvolutionSendTextInput) {
  const normalizedNumber = normalizeRemotePhone(input.number)

  if (!normalizedNumber) {
    throw new Error('Numero invalido para envio Evolution.')
  }

  return evolutionRequest(`/message/sendText/${input.instance ?? getEvolutionInstanceName()}`, {
    method: 'POST',
    body: {
      number: normalizedNumber,
      text: input.text,
      delay: input.delay ?? 0,
    },
  })
}

export async function sendTextMessage(input: EvolutionSendTextInput) {
  return sendEvolutionTextMessage(input)
}

export async function getEvolutionInstanceConnectionStatus(instance = getEvolutionInstanceName()): Promise<EvolutionConnectionStatus> {
  const data = await evolutionRequest<{
    instance?: {
      instanceName?: string
      state?: string
    }
  }>(`/instance/connectionState/${instance}`)

  return {
    instanceName: data.instance?.instanceName ?? instance,
    state: data.instance?.state ?? null,
    raw: data,
  }
}

export async function getInstanceStatus(instance = getEvolutionInstanceName()) {
  return getEvolutionInstanceConnectionStatus(instance)
}

export async function configureEvolutionInstanceWebhook(input?: {
  instance?: string
  events?: EvolutionWebhookEvent[]
}) {
  const instance = input?.instance ?? getEvolutionInstanceName()
  const webhookUrl = getEvolutionWebhookUrl()
  const events = Array.from(
    new Set((input?.events ?? [...DEFAULT_EVOLUTION_WEBHOOK_EVENTS]).map((event) => normalizeEvolutionEventName(event)))
  )

  const data = await evolutionRequest(`/webhook/set/${instance}`, {
    method: 'POST',
    body: {
      enabled: true,
      url: webhookUrl,
      webhook_by_events: false,
      webhook_base64: false,
      events,
    },
  })

  return {
    instanceName: instance,
    webhookUrl,
    events,
    raw: data,
  } satisfies EvolutionWebhookConfigResult
}

export async function configureWebhook(input?: {
  instance?: string
  events?: EvolutionWebhookEvent[]
}) {
  return configureEvolutionInstanceWebhook(input)
}

export function normalizeEvolutionWebhookPayload(payload: unknown): EvolutionNormalizedWebhookPayload {
  const root = asRecord(payload) ?? {}
  const originalEvent = pickString(root.event, root.eventType, root.type) ?? 'UNKNOWN'
  const eventNormalized = normalizeEvolutionEventName(originalEvent)
  const data = pickPrimaryRecord(root.data, root.payload, root.body) ?? root
  const keyRecord = pickObject(data.key, root.key)
  const messageRecord = pickPrimaryRecord(
    data.message,
    root.message,
    pickObject(data.messages)?.message,
    asArray(data.messages)[0] && pickPrimaryRecord(asArray(data.messages)[0], pickObject(asArray(data.messages)[0])?.message)
  )
  const instanceName = pickString(
    root.instance,
    root.instanceName,
    pickObject(root.instance)?.instanceName,
    data.instance,
    data.instanceName,
    pickObject(data.instance)?.instanceName
  )
  const remoteJid = pickString(
    keyRecord?.remoteJid,
    data.remoteJid,
    data.key && pickObject(data.key)?.remoteJid,
    data.jid,
    root.remoteJid
  )
  const remotePhone = normalizeRemotePhone(remoteJid)
  const messageId = pickString(keyRecord?.id, data.id, root.id)
  const contactName = pickString(data.pushName, root.pushName, data.participantPushName, data.senderName)
  const text = extractMessageText(messageRecord)
  const messageType = extractMessageType(messageRecord)
  const timestamp = extractMessageTimestamp(
    pickString(data.messageTimestamp, root.messageTimestamp, data.timestamp, root.timestamp) ?? data.messageTimestamp ?? root.messageTimestamp
  )
  const fromMe = asBoolean(keyRecord?.fromMe) || asBoolean(data.fromMe) || asBoolean(root.fromMe)
  const isGroup = Boolean(remoteJid?.endsWith('@g.us'))
  const isStatusBroadcast = Boolean(remoteJid?.includes('status@broadcast'))

  let ignoreReason: string | null = null
  if (eventNormalized !== 'MESSAGES_UPSERT') {
    ignoreReason = `evento_${eventNormalized.toLowerCase()}`
  } else if (fromMe) {
    ignoreReason = 'from_me'
  } else if (isGroup) {
    ignoreReason = 'group_message'
  } else if (isStatusBroadcast) {
    ignoreReason = 'status_broadcast'
  } else if (!remotePhone) {
    ignoreReason = 'missing_phone'
  }

  return {
    originalEvent,
    event: eventNormalized,
    instanceName,
    messageId,
    remoteJid,
    remotePhone,
    contactName,
    text,
    messageType,
    timestamp,
    fromMe,
    isGroup,
    isStatusBroadcast,
    shouldProcessInboundMessage: ignoreReason === null,
    ignoreReason,
    dedupeKey: buildDedupeKey({
      event: eventNormalized,
      instanceName,
      messageId,
      remoteJid,
      timestamp,
      text,
    }),
    raw: payload,
  }
}

export async function pingEvolutionInstance() {
  return getEvolutionInstanceConnectionStatus()
}

export const EVOLUTION_WEBHOOK_EVENTS = [...DEFAULT_EVOLUTION_WEBHOOK_EVENTS]
export const evolutionWebhookDocumentation = {
  sendText: 'https://doc.evolution-api.com/v2/api-reference/message-controller/send-text',
  connectionState: 'https://doc.evolution-api.com/v1/api-reference/instance-controller/connection-state',
  setWebhook: 'https://doc.evolution-api.com/v2/api-reference/webhook/set',
} as const
