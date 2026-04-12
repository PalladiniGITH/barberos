import 'server-only'

import { z } from 'zod'

const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'
const DEFAULT_TIMEOUT_MS = 15000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 20000
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  terça: 2,
  'terca-feira': 2,
  'terça-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
  sábado: 6,
}

const IntentSchema = z.object({
  intent: z.enum(['BOOK_APPOINTMENT', 'CONFIRM', 'DECLINE', 'CHANGE_REQUEST', 'UNKNOWN']),
  serviceName: z.string().min(1).max(120).nullable(),
  mentionedName: z.string().min(1).max(120).nullable(),
  allowAnyProfessional: z.boolean(),
  requestedDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  timePreference: z.enum(['NONE', 'EXACT', 'MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING']),
  exactTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  selectedOptionNumber: z.number().int().min(1).max(6).nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(240),
})

const INTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['BOOK_APPOINTMENT', 'CONFIRM', 'DECLINE', 'CHANGE_REQUEST', 'UNKNOWN'],
    },
    serviceName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    mentionedName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    allowAnyProfessional: { type: 'boolean' },
    requestedDateIso: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    timePreference: {
      type: 'string',
      enum: ['NONE', 'EXACT', 'MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'],
    },
    exactTime: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    selectedOptionNumber: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 6 }, { type: 'null' }],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
  },
  required: [
    'intent',
    'serviceName',
    'mentionedName',
    'allowAnyProfessional',
    'requestedDateIso',
    'timePreference',
    'exactTime',
    'selectedOptionNumber',
    'confidence',
    'reasoning',
  ],
} as const

interface OpenAIConfig {
  apiKey: string
  model: string
  timeoutMs: number
}

export interface WhatsAppInterpreterInput {
  message: string
  barbershopName: string
  conversationState: string
  offeredSlotCount: number
  services: Array<{ name: string }>
  professionals: Array<{ name: string }>
  todayIsoDate: string
}

export type WhatsAppIntent = z.infer<typeof IntentSchema> & {
  source: 'openai' | 'fallback'
}

function readEnv(name: 'OPENAI_API_KEY' | 'OPENAI_MODEL' | 'OPENAI_TIMEOUT_MS') {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTimeoutMs(rawTimeout: string) {
  if (!rawTimeout) {
    return DEFAULT_TIMEOUT_MS
  }

  const parsed = Number(rawTimeout)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS
  }

  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(parsed)))
}

function getOpenAIConfig(): OpenAIConfig | null {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) {
    return null
  }

  return {
    apiKey,
    model: readEnv('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
    timeoutMs: normalizeTimeoutMs(readEnv('OPENAI_TIMEOUT_MS')),
  }
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const response = payload as {
    output_text?: unknown
    output?: Array<{ content?: Array<{ text?: unknown }> }>
  }

  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text
  }

  const chunks: string[] = []
  const output = Array.isArray(response.output) ? response.output : []

  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : []
    content.forEach((part) => {
      if (typeof part?.text === 'string' && part.text.trim()) {
        chunks.push(part.text)
      }
    })
  })

  return chunks.join('\n').trim()
}

function nextWeekdayDate(base: Date, weekday: number) {
  const candidate = new Date(base)
  candidate.setHours(0, 0, 0, 0)
  const currentWeekday = candidate.getDay()
  let delta = weekday - currentWeekday
  if (delta <= 0) {
    delta += 7
  }
  candidate.setDate(candidate.getDate() + delta)
  return candidate
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatIsoTime(hours: number, minutes: number) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseExplicitTime(message: string) {
  const exactMatch = message.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/)
  if (exactMatch) {
    return formatIsoTime(Number(exactMatch[1]), Number(exactMatch[2]))
  }

  const hourOnlyMatch = message.match(/\b([01]?\d|2[0-3])\s*(?:h|horas?)\b/)
  if (hourOnlyMatch) {
    return formatIsoTime(Number(hourOnlyMatch[1]), 0)
  }

  return null
}

function extractMentionedName(message: string) {
  const directMatch = message.match(/\b(?:com|do|da)\s+([a-zA-ZÀ-ÿ]+(?:\s+[a-zA-ZÀ-ÿ]+){0,2})/i)
  const fallbackMatch = message.match(/\b([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,2})\b/)
  const rawName = directMatch?.[1] ?? fallbackMatch?.[1] ?? null

  if (!rawName) {
    return null
  }

  const normalized = normalizeText(rawName)
  if (
    normalized.includes('qualquer')
    || normalized.includes('barbeiro')
    || normalized.includes('horario')
    || normalized.includes('horario')
  ) {
    return null
  }

  return rawName.trim()
}

function parseRelativeDate(message: string, today: Date) {
  const normalized = normalizeText(message)

  if (normalized.includes('amanha')) {
    const date = new Date(today)
    date.setDate(date.getDate() + 1)
    return formatIsoDate(date)
  }

  if (normalized.includes('hoje')) {
    return formatIsoDate(today)
  }

  const explicitDate = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)
  if (explicitDate) {
    const day = Number(explicitDate[1])
    const month = Number(explicitDate[2])
    const yearRaw = explicitDate[3] ? Number(explicitDate[3]) : today.getFullYear()
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const weekdayName = Object.keys(WEEKDAY_INDEX).find((name) => normalized.includes(name))
  if (weekdayName) {
    return formatIsoDate(nextWeekdayDate(today, WEEKDAY_INDEX[weekdayName]))
  }

  return null
}

function inferTimePreference(message: string) {
  const normalized = normalizeText(message)

  const afterHourMatch = normalized.match(/depois\s+das?\s+([01]?\d|2[0-3])/)
  if (afterHourMatch) {
    const hour = Number(afterHourMatch[1])

    if (hour >= 18) {
      return {
        timePreference: 'EVENING' as const,
        exactTime: null,
      }
    }

    if (hour >= 17) {
      return {
        timePreference: 'LATE_AFTERNOON' as const,
        exactTime: null,
      }
    }

    if (hour >= 12) {
      return {
        timePreference: 'AFTERNOON' as const,
        exactTime: null,
      }
    }

    return {
      timePreference: 'MORNING' as const,
      exactTime: null,
    }
  }

  const exactTime = parseExplicitTime(normalized)
  if (exactTime) {
    return {
      timePreference: 'EXACT' as const,
      exactTime,
    }
  }

  if (normalized.includes('fim da tarde')) {
    return {
      timePreference: 'LATE_AFTERNOON' as const,
      exactTime: null,
    }
  }

  if (normalized.includes('manha')) {
    return {
      timePreference: 'MORNING' as const,
      exactTime: null,
    }
  }

  if (normalized.includes('tarde')) {
    return {
      timePreference: 'AFTERNOON' as const,
      exactTime: null,
    }
  }

  if (normalized.includes('noite')) {
    return {
      timePreference: 'EVENING' as const,
      exactTime: null,
    }
  }

  return {
    timePreference: 'NONE' as const,
    exactTime: null,
  }
}

function findBestNamedMatch(options: Array<{ name: string }>, message: string) {
  const normalizedMessage = normalizeText(message)
  const messageTokens = normalizedMessage.split(/[^a-z0-9]+/).filter(Boolean)

  const exactMatch = options.find((option) => normalizeText(option.name) === normalizedMessage)
  if (exactMatch) {
    return exactMatch.name
  }

  const includedMatch = options.find((option) => normalizedMessage.includes(normalizeText(option.name)))
  if (includedMatch) {
    return includedMatch.name
  }

  const tokenMatch = options.find((option) =>
    normalizeText(option.name)
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .some((token) => {
        if (token.length > 2 && normalizedMessage.includes(token)) {
          return true
        }

        const tokenStem = token.slice(0, 4)
        return tokenStem.length >= 4 && messageTokens.some((messageToken) => messageToken.startsWith(tokenStem))
      })
  )

  return tokenMatch?.name ?? null
}

function inferIntent(message: string, conversationState: string) {
  const normalized = normalizeText(message)

  if (/\b(sim|confirmo|confirmar|fechado|pode ser|perfeito|ok|beleza)\b/.test(normalized)) {
    return 'CONFIRM' as const
  }

  if (/\b(nao|não|cancelar|cancela|mudar|trocar|outro horario|outro horario)\b/.test(normalized)) {
    return conversationState === 'WAITING_CONFIRMATION'
      ? 'DECLINE' as const
      : 'CHANGE_REQUEST' as const
  }

  if (/\b(agendar|marcar|agendamento|horario|horário|corte|barba|quero cortar|quero marcar)\b/.test(normalized)) {
    return 'BOOK_APPOINTMENT' as const
  }

  return 'UNKNOWN' as const
}

function inferSelectedOptionNumber(message: string, offeredSlotCount: number) {
  const normalized = normalizeText(message)
  const directNumber = normalized.match(/\b([1-6])\b/)
  if (directNumber) {
    const selected = Number(directNumber[1])
    return selected >= 1 && selected <= Math.max(offeredSlotCount, 1) ? selected : null
  }

  const optionNumber = normalized.match(/\b([1-6])[oa]?\s*(?:opcao|opção)\b/)
  if (optionNumber) {
    const selected = Number(optionNumber[1])
    return selected >= 1 && selected <= Math.max(offeredSlotCount, 1) ? selected : null
  }

  return null
}

function buildFallbackIntent(input: WhatsAppInterpreterInput): WhatsAppIntent {
  const today = new Date(`${input.todayIsoDate}T09:00:00`)
  const timePreference = inferTimePreference(input.message)

  return {
    intent: inferIntent(input.message, input.conversationState),
    serviceName: findBestNamedMatch(input.services, input.message),
    mentionedName: extractMentionedName(input.message),
    allowAnyProfessional: /\b(qualquer um|qualquer barbeiro|tanto faz|sem preferencia|sem preferência)\b/.test(
      normalizeText(input.message)
    ),
    requestedDateIso: parseRelativeDate(input.message, today),
    timePreference: timePreference.timePreference,
    exactTime: timePreference.exactTime,
    selectedOptionNumber: inferSelectedOptionNumber(input.message, input.offeredSlotCount),
    confidence: 0.48,
    reasoning: 'Fallback deterministico local.',
    source: 'fallback',
  }
}

function buildInterpreterPrompt(input: WhatsAppInterpreterInput) {
  return [
    'Voce interpreta mensagens de WhatsApp para um fluxo guiado de agendamento da BarberOS.',
    'Nao crie agendamento. Nao invente disponibilidade. Apenas extraia intencao estruturada.',
    `Barbearia: ${input.barbershopName}.`,
    `Data atual local: ${input.todayIsoDate}.`,
    `Estado atual da conversa: ${input.conversationState}.`,
    `Servicos validos: ${input.services.map((service) => service.name).join(', ') || 'nenhum'}.`,
    `Profissionais validos: ${input.professionals.map((professional) => professional.name).join(', ') || 'nenhum'}.`,
    `Quantidade de opcoes de horario atualmente oferecidas ao cliente: ${input.offeredSlotCount}.`,
    'Regras obrigatorias:',
    '- serviceName deve ser exatamente um dos servicos validos, ou null.',
    '- mentionedName deve conter apenas o nome da pessoa citada pelo cliente, ou null.',
    '- Nao assuma que o nome citado e um barbeiro. Apenas extraia o nome mencionado.',
    '- requestedDateIso deve ser yyyy-mm-dd apenas quando a data estiver clara. Para "amanha", converta para a data absoluta.',
    '- timePreference deve ser EXACT, MORNING, AFTERNOON, LATE_AFTERNOON, EVENING ou NONE.',
    '- exactTime so deve ser preenchido se o horario exato estiver explicito.',
    '- selectedOptionNumber so deve ser preenchido quando o cliente escolher uma das opcoes oferecidas.',
    '- Se o cliente disser "qualquer um" ou equivalente, marque allowAnyProfessional=true.',
    '- intent deve ser BOOK_APPOINTMENT, CONFIRM, DECLINE, CHANGE_REQUEST ou UNKNOWN.',
    `Mensagem do cliente: """${input.message}"""`,
  ].join('\n')
}

export async function interpretWhatsAppMessage(input: WhatsAppInterpreterInput): Promise<WhatsAppIntent> {
  const config = getOpenAIConfig()
  if (!config) {
    return buildFallbackIntent(input)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        store: false,
        max_output_tokens: 280,
        input: [
          {
            role: 'user',
            content: buildInterpreterPrompt(input),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'barberos_whatsapp_intent',
            strict: true,
            schema: INTENT_JSON_SCHEMA,
          },
        },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn('[whatsapp-interpreter/openai] fallback bad_status', { status: response.status })
      return buildFallbackIntent(input)
    }

    const payload = await response.json()
    const outputText = extractResponseText(payload)
    if (!outputText) {
      console.warn('[whatsapp-interpreter/openai] fallback empty_output')
      return buildFallbackIntent(input)
    }

    const parsedJson = JSON.parse(outputText)
    const parsed = IntentSchema.safeParse(parsedJson)

    if (!parsed.success) {
      console.warn('[whatsapp-interpreter/openai] fallback invalid_schema', {
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}:${issue.message}`),
      })
      return buildFallbackIntent(input)
    }

    return {
      ...parsed.data,
      source: 'openai',
    }
  } catch (error) {
    console.warn('[whatsapp-interpreter/openai] fallback request_failed', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    return buildFallbackIntent(input)
  } finally {
    clearTimeout(timeout)
  }
}
