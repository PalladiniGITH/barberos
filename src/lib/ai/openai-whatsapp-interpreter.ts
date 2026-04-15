import 'server-only'

import { z } from 'zod'
import { nextWeekdayIsoDate, shiftIsoDate } from '@/lib/timezone'

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'
const DEFAULT_TIMEOUT_MS = 15000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 20000
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

const NAME_STOPWORDS = [
  'quero',
  'preciso',
  'marcar',
  'agendar',
  'hoje',
  'amanha',
  'amanhã',
  'tarde',
  'manha',
  'manhã',
  'noite',
  'depois',
  'horario',
  'horário',
  'qualquer',
  'barbeiro',
  'servico',
  'serviço',
  'outro',
]

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  'terca-feira': 2,
  terça: 2,
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
  intent: z.enum(['BOOK_APPOINTMENT', 'CHECK_EXISTING_BOOKING', 'ACKNOWLEDGEMENT', 'CONFIRM', 'DECLINE', 'CHANGE_REQUEST', 'UNKNOWN']),
  serviceName: z.string().min(1).max(120).nullable(),
  mentionedName: z.string().min(1).max(120).nullable(),
  preferredPeriod: z.enum(['MORNING', 'AFTERNOON', 'EVENING']).nullable(),
  allowAnyProfessional: z.boolean(),
  requestedDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  timePreference: z.enum(['NONE', 'EXACT', 'MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING']),
  exactTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  selectedOptionNumber: z.number().int().min(1).max(6).nullable(),
  correctionTarget: z.enum(['NONE', 'SERVICE', 'PROFESSIONAL', 'DATE', 'PERIOD', 'TIME', 'FLOW']),
  greetingOnly: z.boolean(),
  restartConversation: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
})

const INTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['BOOK_APPOINTMENT', 'CHECK_EXISTING_BOOKING', 'ACKNOWLEDGEMENT', 'CONFIRM', 'DECLINE', 'CHANGE_REQUEST', 'UNKNOWN'],
    },
    serviceName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    mentionedName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    preferredPeriod: {
      anyOf: [{ type: 'string', enum: ['MORNING', 'AFTERNOON', 'EVENING'] }, { type: 'null' }],
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
    correctionTarget: {
      type: 'string',
      enum: ['NONE', 'SERVICE', 'PROFESSIONAL', 'DATE', 'PERIOD', 'TIME', 'FLOW'],
    },
    greetingOnly: { type: 'boolean' },
    restartConversation: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string', maxLength: 500 },
  },
  required: [
    'intent',
    'serviceName',
    'mentionedName',
    'preferredPeriod',
    'allowAnyProfessional',
    'requestedDateIso',
    'timePreference',
    'exactTime',
    'selectedOptionNumber',
    'correctionTarget',
    'greetingOnly',
    'restartConversation',
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
  barbershopTimezone: string
  conversationState: string
  offeredSlotCount: number
  services: Array<{ name: string }>
  professionals: Array<{ name: string }>
  todayIsoDate: string
  currentLocalDateTime: string
  conversationSummary: {
    selectedServiceName?: string | null
    selectedProfessionalName?: string | null
    requestedDateIso?: string | null
    requestedTimeLabel?: string | null
    allowAnyProfessional?: boolean
    lastCustomerMessage?: string | null
    lastAssistantMessage?: string | null
  }
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
    .trim()
}

const NORMALIZED_NAME_STOPWORDS = new Set(NAME_STOPWORDS.map((term) => normalizeText(term)))

function tokenizeNormalized(value: string) {
  return normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean)
}

function isNameStopwordToken(token: string) {
  return NORMALIZED_NAME_STOPWORDS.has(token)
}

function derivePreferredPeriod(timePreference: z.infer<typeof IntentSchema>['timePreference']) {
  if (timePreference === 'MORNING') return 'MORNING' as const
  if (timePreference === 'AFTERNOON' || timePreference === 'LATE_AFTERNOON') return 'AFTERNOON' as const
  if (timePreference === 'EVENING') return 'EVENING' as const
  return null
}

function scoreProfessionalNameSimilarity(rawName: string, professionalName: string) {
  const normalizedRaw = normalizeText(rawName)
  const normalizedProfessional = normalizeText(professionalName)

  if (!normalizedRaw || !normalizedProfessional) {
    return 0
  }

  if (normalizedRaw === normalizedProfessional) {
    return 1
  }

  if (
    normalizedRaw.length >= 4
    && (normalizedProfessional.includes(normalizedRaw) || normalizedRaw.includes(normalizedProfessional))
  ) {
    return 0.94
  }

  const rawTokens = tokenizeNormalized(rawName).filter((token) => !isNameStopwordToken(token))
  const professionalTokens = tokenizeNormalized(professionalName)

  if (rawTokens.length === 0 || professionalTokens.length === 0) {
    return 0
  }

  let exactMatches = 0
  let prefixMatches = 0

  for (const rawToken of rawTokens) {
    if (professionalTokens.some((professionalToken) => professionalToken === rawToken)) {
      exactMatches += 1
      continue
    }

    if (
      rawToken.length >= 4
      && professionalTokens.some((professionalToken) => professionalToken.startsWith(rawToken))
    ) {
      prefixMatches += 1
      continue
    }

    return 0
  }

  const coverage = (exactMatches + prefixMatches) / rawTokens.length
  const exactBonus = exactMatches / rawTokens.length * 0.1
  return 0.72 + coverage * 0.12 + exactBonus
}

function isPlausibleHumanNameCandidate(rawName: string) {
  const normalized = normalizeText(rawName)
  if (!normalized) {
    return false
  }

  const tokens = tokenizeNormalized(rawName)
  if (tokens.length === 0 || tokens.some((token) => token.length < 3)) {
    return false
  }

  if (tokens.every((token) => isNameStopwordToken(token))) {
    return false
  }

  return /^[a-zA-ZÀ-ÿ\s]+$/.test(rawName.trim())
}

function sanitizeMentionedNameCandidate(
  rawName: string | null,
  professionals: Array<{ name: string }>,
  allowLooseFallback: boolean
) {
  if (!rawName) {
    return null
  }

  const trimmed = rawName.trim()
  const normalizedTokens = tokenizeNormalized(trimmed)

  if (normalizedTokens.length === 0 || normalizedTokens.every((token) => isNameStopwordToken(token))) {
    return null
  }

  const exactMatch = professionals.find((professional) => normalizeText(professional.name) === normalizeText(trimmed))
  if (exactMatch) {
    return exactMatch.name
  }

  const scoredMatches = professionals
    .map((professional) => ({
      name: professional.name,
      score: scoreProfessionalNameSimilarity(trimmed, professional.name),
    }))
    .filter((match) => match.score >= 0.84)
    .sort((left, right) => right.score - left.score)

  if (scoredMatches.length > 0) {
    if (scoredMatches.length === 1 || scoredMatches[0].score - scoredMatches[1].score >= 0.08) {
      return scoredMatches[0].name
    }

    return null
  }

  if (!allowLooseFallback || !isPlausibleHumanNameCandidate(trimmed)) {
    return null
  }

  return trimmed
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

function formatIsoTime(hours: number, minutes: number) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function extractExplicitTimeFromMessage(message: string) {
  const normalized = normalizeText(message)

  const exactMatch = normalized.match(/\b([01]?\d|2[0-3])(?:[:h]|hr|hrs)([0-5]\d)\b/)
  if (exactMatch) {
    return formatIsoTime(Number(exactMatch[1]), Number(exactMatch[2]))
  }

  const meridiemMatch = normalized.match(/\b([1-9]|1[0-2])(?::([0-5]\d))?\s*(?:da|de)\s+(manha|tarde|noite)\b/)
  if (meridiemMatch) {
    const rawHour = Number(meridiemMatch[1])
    const minutes = Number(meridiemMatch[2] ?? '0')
    const period = meridiemMatch[3]
    let hours = rawHour

    if (period === 'tarde' && rawHour < 12) {
      hours = rawHour + 12
    } else if (period === 'noite' && rawHour < 12) {
      hours = rawHour === 12 ? 0 : rawHour + 12
    } else if (period === 'manha' && rawHour === 12) {
      hours = 0
    }

    return formatIsoTime(hours, minutes)
  }

  const hourOnlyMatch = normalized.match(/\b([01]?\d|2[0-3])\s*(?:h|hr|hrs|hora|horas)\b/)
  if (hourOnlyMatch) {
    return formatIsoTime(Number(hourOnlyMatch[1]), 0)
  }

  const explicitHourRequest = normalized.match(/\b(?:as)\s*([01]?\d|2[0-3])\b/)
  if (explicitHourRequest) {
    return formatIsoTime(Number(explicitHourRequest[1]), 0)
  }

  return null
}

function extractMentionedName(message: string, professionals: Array<{ name: string }>) {
  const directMatch = message.match(/\b(?:com|do|da)\s+([a-zA-ZÀ-ÿ]+(?:\s+[a-zA-ZÀ-ÿ]+){0,2})/i)
  const fallbackMatch = message.match(/\b([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,2})\b/)
  const normalizedMessage = normalizeText(message)
  const rawName = directMatch?.[1] ?? fallbackMatch?.[1] ?? null

  if (!rawName) {
    const exactCandidates = professionals.filter((professional) => {
      const normalizedProfessional = normalizeText(professional.name)
      const normalizedFirstName = normalizeText(professional.name.split(/\s+/)[0] ?? '')
      return normalizedMessage === normalizedProfessional || normalizedMessage === normalizedFirstName
    })

    if (exactCandidates.length === 1 && !isNameStopwordToken(normalizedMessage)) {
      return exactCandidates[0].name
    }
  }

  return sanitizeMentionedNameCandidate(rawName, professionals, Boolean(directMatch))
}

function parseRelativeDate(message: string, todayIsoDate: string) {
  const normalized = normalizeText(message)

  if (normalized.includes('depois de amanha')) {
    return shiftIsoDate(todayIsoDate, 2)
  }

  if (normalized.includes('amanha')) {
    return shiftIsoDate(todayIsoDate, 1)
  }

  if (normalized.includes('hoje')) {
    return todayIsoDate
  }

  const explicitDate = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)
  if (explicitDate) {
    const day = Number(explicitDate[1])
    const month = Number(explicitDate[2])
    const currentYear = Number(todayIsoDate.slice(0, 4))
    const yearRaw = explicitDate[3] ? Number(explicitDate[3]) : currentYear
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const weekdayName = Object.keys(WEEKDAY_INDEX).find((name) => normalized.includes(name))
  if (weekdayName) {
    return nextWeekdayIsoDate(todayIsoDate, WEEKDAY_INDEX[weekdayName])
  }

  return null
}

function inferTimePreference(message: string) {
  const normalized = normalizeText(message)

  const afterHourMatch = normalized.match(/depois\s+das?\s+([01]?\d|2[0-3])/)
  if (afterHourMatch) {
    const hour = Number(afterHourMatch[1])

    if (hour >= 18) {
      return { timePreference: 'EVENING' as const, exactTime: null }
    }

    if (hour >= 17) {
      return { timePreference: 'LATE_AFTERNOON' as const, exactTime: null }
    }

    if (hour >= 12) {
      return { timePreference: 'AFTERNOON' as const, exactTime: null }
    }

    return { timePreference: 'MORNING' as const, exactTime: null }
  }

  const exactTime = extractExplicitTimeFromMessage(normalized)
  if (exactTime) {
    return { timePreference: 'EXACT' as const, exactTime }
  }

  if (normalized.includes('fim da tarde')) {
    return { timePreference: 'LATE_AFTERNOON' as const, exactTime: null }
  }

  if (normalized.includes('manha')) {
    return { timePreference: 'MORNING' as const, exactTime: null }
  }

  if (normalized.includes('tarde')) {
    return { timePreference: 'AFTERNOON' as const, exactTime: null }
  }

  if (normalized.includes('noite')) {
    return { timePreference: 'EVENING' as const, exactTime: null }
  }

  return { timePreference: 'NONE' as const, exactTime: null }
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

function isGreetingOnly(message: string) {
  const normalized = normalizeText(message)
  if (!normalized) {
    return false
  }

  const pureGreetingPattern = /^(oi+|ola+|ol[aá]|bom dia|boa tarde|boa noite|e ai|opa|hey+|fala)(\s+.+)?$/
  const bookingSignals = /\b(agendar|marcar|horario|horario|corte|barba|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/

  return pureGreetingPattern.test(normalized) && !bookingSignals.test(normalized)
}

function shouldRestartConversation(message: string) {
  const normalized = normalizeText(message)
  return /\b(recomeca|recomeca|comeca de novo|comeca do zero|do zero|esquece tudo|novo atendimento)\b/.test(normalized)
}

const DIRECT_EXISTING_BOOKING_QUERY_PHRASES = [
  'quais horarios eu tenho',
  'quais horarios eu tenho essa semana',
  'quais horarios tenho',
  'que horas eu tenho',
  'que horas eu tenho essa semana',
  'que horas tenho',
  'que horas eu marquei',
  'que horas eu marquei essa semana',
  'que horas marquei',
  'o que eu marquei',
  'o que eu marquei essa semana',
  'o que marquei',
  'eu tenho horario',
  'tenho horario',
  'eu tenho algo',
  'tenho algo',
  'tenho algo essa semana',
  'meus horarios dessa semana',
  'meus horarios da semana',
  'com quem eu estou marcado essa semana',
  'com quem estou marcado essa semana',
  'amanha eu tenho horario',
  'hoje eu tenho horario',
  'amanha eu tenho algo',
  'hoje eu tenho algo',
  'com quem eu estou marcado',
  'com quem estou marcado',
  'com quem eu to marcado',
  'com quem to marcado',
  'com quem eu marquei',
  'qual meu proximo horario',
  'meu proximo horario',
  'qual e meu proximo horario',
  'qual meu horario de amanha',
  'qual meu horario de hoje',
  'qual horario eu tenho amanha',
  'qual horario eu tenho hoje',
  'qual horario eu marquei',
  'que horario ficou',
  'que horario ficou amanha',
  'meu horario de amanha',
  'o que eu tenho amanha',
  'tem algo pra mim amanha',
  'confirmar meu horario de amanha',
  'que servico eu marquei',
  'qual servico eu marquei',
  'qual servico esta marcado',
  'qual servico ta marcado',
]

const EXISTING_BOOKING_TEMPORAL_HINTS = [
  'hoje',
  'amanha',
  'depois de amanha',
  'proximo',
  'essa semana',
  'dessa semana',
]

const EXISTING_BOOKING_CONTEXT_PHRASES = [
  'proximo horario',
  'horario confirmado',
  'ja ficou marcado',
  'voce tem um horario',
  'voce nao tem nenhum agendamento',
  'voce nao tem nenhum horario',
  'seus proximos horarios',
  'voce esta marcado',
]

const EXISTING_BOOKING_FOLLOW_UP_PATTERN =
  /^(que horas|qual horario|com quem|qual servico|o que ficou marcado|o que eu marquei|me lembra|me confirma)\??$/

const ACKNOWLEDGEMENT_PHRASES = [
  'ok',
  'ok obrigado',
  'obrigado',
  'obg',
  'valeu',
  'blz',
  'beleza',
  'fechou',
  'show',
  'nenhum',
  'nao quero',
  'não quero',
  'nada',
  'so isso',
  'só isso',
  'era so isso',
  'era só isso',
  'por enquanto nao',
  'por enquanto não',
  'tranquilo',
  'deixa assim',
]

function includesAnyPhrase(normalized: string, phrases: string[]) {
  return phrases.some((phrase) => normalized.includes(phrase))
}

export function detectAcknowledgementMessage(message: string) {
  const normalized = normalizeText(message)

  if (!normalized) {
    return false
  }

  if (includesAnyPhrase(normalized, ACKNOWLEDGEMENT_PHRASES)) {
    return true
  }

  return /^(ok|obrigado|obg|valeu|blz|beleza|fechou|show|nenhum|nada|tranquilo)[!.\s]*$/.test(normalized)
}

export function detectExistingBookingQuestion(input: {
  message: string
  conversationSummary: WhatsAppInterpreterInput['conversationSummary']
}) {
  const normalized = normalizeText(input.message)
  const lastCustomer = normalizeText(input.conversationSummary.lastCustomerMessage ?? '')
  const lastAssistant = normalizeText(input.conversationSummary.lastAssistantMessage ?? '')
  const hasDirectQueryPhrase = includesAnyPhrase(normalized, DIRECT_EXISTING_BOOKING_QUERY_PHRASES)
  const hasTemporalHint = includesAnyPhrase(normalized, EXISTING_BOOKING_TEMPORAL_HINTS)
  const asksAboutConfirmedBooking =
    hasDirectQueryPhrase
    && (
      hasTemporalHint
      || normalized.includes('marcado')
      || normalized.includes('confirmado')
    )
  const asksAboutNextBooking =
    normalized.includes('proximo horario')
    || normalized.includes('proximo agendamento')
  const hasBookingSubject =
    /\b(horario|horarios|agendamento|agendamentos|marcado|marcada|marquei|confirmado|confirmada|ficou)\b/.test(normalized)
  const hasQueryCue =
    /\b(qual|quais|que|com quem|meu|minha|pra mim|para mim|eu tenho|tenho|confirmar|me confirma|me lembra|o que)\b/.test(normalized)
  const hasStrongTemporalCue =
    /\b(hoje|amanha|depois de amanha|essa semana|dessa semana|proximo)\b/.test(normalized)
  const fuzzyExistingBookingQuery =
    hasBookingSubject
    && hasQueryCue
    && (
      hasStrongTemporalCue
      || normalized.includes('meu')
      || normalized.includes('tenho')
      || normalized.includes('confirmar')
    )
  const heuristicExistingBookingFallback =
    /\b(horario|horarios|agendamento|agendamentos|marcado|marcada|marquei|confirmado|confirmada|ficou)\b/.test(normalized)
    && /\b(amanha|hoje|essa semana|dessa semana|proximo|meu|minha|tenho|confirmar|pra mim|para mim)\b/.test(normalized)
  const followUpToExistingBookingContext =
    EXISTING_BOOKING_FOLLOW_UP_PATTERN.test(normalized)
    && (
      includesAnyPhrase(lastAssistant, EXISTING_BOOKING_CONTEXT_PHRASES)
      || includesAnyPhrase(lastCustomer, EXISTING_BOOKING_CONTEXT_PHRASES)
    )

  return (
    asksAboutConfirmedBooking
    || asksAboutNextBooking
    || fuzzyExistingBookingQuery
    || heuristicExistingBookingFallback
    || followUpToExistingBookingContext
  )
}

function inferIntent(
  message: string,
  conversationState: string,
  conversationSummary: WhatsAppInterpreterInput['conversationSummary'],
  exactTime?: string | null
) {
  const normalized = normalizeText(message)
  const confirmationPattern = /\b(sim|desejo|quero|confirmo|confirmar|confirmado|confirma|fechado|pode ser|perfeito|ok|beleza|pode marcar|pode agendar)\b/

  if (detectExistingBookingQuestion({
    message,
    conversationSummary,
  })) {
    return 'CHECK_EXISTING_BOOKING' as const
  }

  if (conversationState !== 'WAITING_CONFIRMATION' && detectAcknowledgementMessage(message)) {
    return 'ACKNOWLEDGEMENT' as const
  }

  if (exactTime && confirmationPattern.test(normalized)) {
    return conversationState === 'WAITING_CONFIRMATION'
      ? 'CHANGE_REQUEST' as const
      : 'BOOK_APPOINTMENT' as const
  }

  if (
    conversationState === 'WAITING_CONFIRMATION'
    && confirmationPattern.test(normalized)
  ) {
    return 'CONFIRM' as const
  }

  if (/\b(sim|confirmo|confirmar|fechado|pode ser|perfeito|ok|beleza|confirmado|confirma)\b/.test(normalized)) {
    return 'CONFIRM' as const
  }

  if (/\b(nao|cancelar|cancela|mudar|trocar|outro horario|outro barbeiro|na verdade|quis dizer)\b/.test(normalized)) {
    return conversationState === 'WAITING_CONFIRMATION'
      ? 'DECLINE' as const
      : 'CHANGE_REQUEST' as const
  }

  if (/\b(agendar|marcar|agendamento|horario|corte|barba|quero cortar|quero marcar)\b/.test(normalized)) {
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

  const optionNumber = normalized.match(/\b([1-6])[oa]?\s*(?:opcao|opcao)\b/)
  if (optionNumber) {
    const selected = Number(optionNumber[1])
    return selected >= 1 && selected <= Math.max(offeredSlotCount, 1) ? selected : null
  }

  return null
}

function inferCorrectionTarget(input: {
  message: string
  serviceName: string | null
  mentionedName: string | null
  requestedDateIso: string | null
  timePreference: string
  exactTime: string | null
  allowAnyProfessional: boolean
  conversationSummary: WhatsAppInterpreterInput['conversationSummary']
}) {
  const normalized = normalizeText(input.message)

  if (shouldRestartConversation(input.message)) {
    return 'FLOW' as const
  }

  const hasCorrectionCue = /\b(mas|nao|na verdade|quis dizer|corrig|melhor|troca|trocar|outro|ajusta)\b/.test(
    normalized
  )

  if (
    input.requestedDateIso
    && input.conversationSummary.requestedDateIso
    && input.requestedDateIso !== input.conversationSummary.requestedDateIso
  ) {
    return 'DATE' as const
  }

  if (
    input.exactTime
    && input.conversationSummary.requestedTimeLabel
    && input.exactTime !== input.conversationSummary.requestedTimeLabel
  ) {
    return 'TIME' as const
  }

  if (
    input.timePreference !== 'NONE'
    && input.timePreference !== 'EXACT'
    && input.conversationSummary.requestedTimeLabel
    && input.timePreference !== input.conversationSummary.requestedTimeLabel
  ) {
    return 'PERIOD' as const
  }

  if (
    input.serviceName
    && input.conversationSummary.selectedServiceName
    && normalizeText(input.serviceName) !== normalizeText(input.conversationSummary.selectedServiceName)
  ) {
    return 'SERVICE' as const
  }

  if (input.allowAnyProfessional && input.conversationSummary.selectedProfessionalName) {
    return 'PROFESSIONAL' as const
  }

  if (
    input.mentionedName
    && input.conversationSummary.selectedProfessionalName
    && normalizeText(input.mentionedName) !== normalizeText(input.conversationSummary.selectedProfessionalName)
  ) {
    return 'PROFESSIONAL' as const
  }

  if (hasCorrectionCue) {
    if (/(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}[\/\-]\d{1,2})/.test(normalized)) {
      return 'DATE' as const
    }

    if (/(manha|tarde|noite|fim da tarde|depois das?)/.test(normalized)) {
      return input.exactTime ? 'TIME' as const : 'PERIOD' as const
    }

    if (/(outro barbeiro|com outro|nao com ele|nao com esse|qualquer um|sem preferencia)/.test(normalized)) {
      return 'PROFESSIONAL' as const
    }

    if (input.serviceName) {
      return 'SERVICE' as const
    }

    return 'FLOW' as const
  }

  return 'NONE' as const
}

function prioritizeExplicitTimeOverConfirmation(input: {
  interpreted: WhatsAppIntent
  conversationState: string
  conversationSummary: WhatsAppInterpreterInput['conversationSummary']
}) {
  if (!input.interpreted.exactTime) {
    return input.interpreted
  }

  if (
    input.interpreted.intent !== 'CONFIRM'
    && input.interpreted.intent !== 'ACKNOWLEDGEMENT'
  ) {
    return input.interpreted
  }

  const shouldTreatAsTimeCorrection =
    input.conversationState === 'WAITING_CONFIRMATION'
    || input.conversationState === 'WAITING_TIME'
    || Boolean(input.conversationSummary.requestedTimeLabel)

  return {
    ...input.interpreted,
    intent: shouldTreatAsTimeCorrection ? 'CHANGE_REQUEST' : 'BOOK_APPOINTMENT',
    correctionTarget: input.interpreted.correctionTarget === 'NONE'
      ? 'TIME'
      : input.interpreted.correctionTarget,
    timePreference: 'EXACT',
    preferredPeriod: null,
  } satisfies WhatsAppIntent
}

function buildFallbackIntent(input: WhatsAppInterpreterInput): WhatsAppIntent {
  const timePreference = inferTimePreference(input.message)
  const serviceName = findBestNamedMatch(input.services, input.message)
  const mentionedName = extractMentionedName(input.message, input.professionals)
  const allowAnyProfessional = /\b(qualquer um|qualquer barbeiro|tanto faz|sem preferencia)\b/.test(
    normalizeText(input.message)
  )
  const requestedDateIso = parseRelativeDate(input.message, input.todayIsoDate)
  const correctionTarget = inferCorrectionTarget({
    message: input.message,
    serviceName,
    mentionedName,
    requestedDateIso,
    timePreference: timePreference.timePreference,
    exactTime: timePreference.exactTime,
    allowAnyProfessional,
    conversationSummary: input.conversationSummary,
  })

  return {
    intent: inferIntent(
      input.message,
      input.conversationState,
      input.conversationSummary,
      timePreference.exactTime
    ),
    serviceName,
    mentionedName,
    preferredPeriod: derivePreferredPeriod(timePreference.timePreference),
    allowAnyProfessional,
    requestedDateIso,
    timePreference: timePreference.timePreference,
    exactTime: timePreference.exactTime,
    selectedOptionNumber: inferSelectedOptionNumber(input.message, input.offeredSlotCount),
    correctionTarget,
    greetingOnly: isGreetingOnly(input.message),
    restartConversation: shouldRestartConversation(input.message),
    confidence: 0.48,
    reasoning: 'Fallback deterministico local.',
    source: 'fallback',
  }
}

function buildInterpreterPrompt(input: WhatsAppInterpreterInput) {
  const summary = input.conversationSummary

  return [
    'Voce interpreta mensagens de WhatsApp para um agente guiado de agendamento da BarberOS.',
    'Voce nunca cria agendamento, nunca inventa horario e nunca decide barbeiro sozinho.',
    'Sua funcao e somente interpretar a mensagem de forma estruturada.',
    `Barbearia: ${input.barbershopName}.`,
    `Timezone local da barbearia: ${input.barbershopTimezone}.`,
    `Agora local da barbearia: ${input.currentLocalDateTime}.`,
    `Data local de referencia: ${input.todayIsoDate}.`,
    `Estado atual da conversa: ${input.conversationState}.`,
    `Servicos validos: ${input.services.map((service) => service.name).join(', ') || 'nenhum'}.`,
    `Profissionais validos: ${input.professionals.map((professional) => professional.name).join(', ') || 'nenhum'}.`,
    `Quantidade de opcoes de horario atualmente oferecidas: ${input.offeredSlotCount}.`,
    `Resumo atual do contexto: servico=${summary.selectedServiceName ?? 'none'}; barbeiro=${summary.selectedProfessionalName ?? (summary.allowAnyProfessional ? 'qualquer' : 'none')}; data=${summary.requestedDateIso ?? 'none'}; horario_ou_periodo=${summary.requestedTimeLabel ?? 'none'}.`,
    `Ultima mensagem do cliente: ${summary.lastCustomerMessage ?? 'none'}.`,
    `Ultima resposta do sistema: ${summary.lastAssistantMessage ?? 'none'}.`,
    'Regras obrigatorias:',
    '- serviceName deve ser exatamente um servico valido ou null.',
    '- mentionedName deve conter apenas o nome citado pelo cliente ou null.',
    '- Nao assuma que mentionedName e barbeiro; so extraia nomes realmente plausiveis.',
    '- Palavras como quero, marcar, agendar, hoje, amanha, manha, tarde, noite e horario nunca sao nomes.',
    '- Se a mensagem vier so com um nome valido de barbeiro, trate isso como escolha de profissional.',
    '- requestedDateIso deve ser yyyy-mm-dd apenas quando a data estiver clara.',
    '- Para "hoje", "amanha" e "depois de amanha", use a data local da barbearia.',
    '- preferredPeriod deve ser MORNING, AFTERNOON, EVENING ou null.',
    '- timePreference deve ser EXACT, MORNING, AFTERNOON, LATE_AFTERNOON, EVENING ou NONE.',
    '- exactTime so deve ser preenchido quando o horario exato estiver explicito.',
    '- selectedOptionNumber so deve ser preenchido quando o cliente escolher uma opcao oferecida.',
    '- correctionTarget deve indicar se o cliente esta corrigindo SERVICE, PROFESSIONAL, DATE, PERIOD, TIME, FLOW ou NONE.',
    '- greetingOnly=true apenas quando a mensagem for basicamente saudacao sem pedido concreto.',
    '- restartConversation=true apenas quando o cliente realmente quiser recomecar.',
    '- intent deve ser BOOK_APPOINTMENT, CHECK_EXISTING_BOOKING, ACKNOWLEDGEMENT, CONFIRM, DECLINE, CHANGE_REQUEST ou UNKNOWN.',
    `Mensagem do cliente: """${input.message}"""`,
  ].join('\n')
}

function mergeWithFallback(parsed: z.infer<typeof IntentSchema>, fallback: WhatsAppIntent): WhatsAppIntent {
  const preferredPeriod = parsed.preferredPeriod ?? fallback.preferredPeriod
  const mergedTimePreference = parsed.timePreference === 'NONE' && preferredPeriod
    ? preferredPeriod
    : parsed.timePreference

  return {
    ...parsed,
    serviceName: parsed.serviceName ?? fallback.serviceName,
    mentionedName: parsed.mentionedName ?? fallback.mentionedName,
    preferredPeriod,
    requestedDateIso: parsed.requestedDateIso ?? fallback.requestedDateIso,
    exactTime: parsed.exactTime ?? fallback.exactTime,
    timePreference: mergedTimePreference,
    selectedOptionNumber: parsed.selectedOptionNumber ?? fallback.selectedOptionNumber,
    correctionTarget: parsed.correctionTarget === 'NONE' ? fallback.correctionTarget : parsed.correctionTarget,
    greetingOnly: parsed.greetingOnly || fallback.greetingOnly,
    restartConversation: parsed.restartConversation || fallback.restartConversation,
    source: 'openai',
  }
}

function sanitizeOpenAiIntentPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  const candidate = payload as Record<string, unknown>

  return {
    ...candidate,
    serviceName: typeof candidate.serviceName === 'string' ? candidate.serviceName.trim().slice(0, 120) : candidate.serviceName,
    mentionedName: typeof candidate.mentionedName === 'string' ? candidate.mentionedName.trim().slice(0, 120) : candidate.mentionedName,
    exactTime: typeof candidate.exactTime === 'string' ? candidate.exactTime.trim().slice(0, 5) : candidate.exactTime,
    requestedDateIso: typeof candidate.requestedDateIso === 'string' ? candidate.requestedDateIso.trim().slice(0, 10) : candidate.requestedDateIso,
    reasoning: typeof candidate.reasoning === 'string' ? candidate.reasoning.trim().slice(0, 500) : 'OpenAI interpretation.',
  }
}

export async function interpretWhatsAppMessage(input: WhatsAppInterpreterInput): Promise<WhatsAppIntent> {
  const fallback = buildFallbackIntent(input)
  const config = getOpenAIConfig()

  if (!config) {
    return prioritizeExplicitTimeOverConfirmation({
      interpreted: fallback,
      conversationState: input.conversationState,
      conversationSummary: input.conversationSummary,
    })
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
        max_output_tokens: 320,
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
      return prioritizeExplicitTimeOverConfirmation({
        interpreted: fallback,
        conversationState: input.conversationState,
        conversationSummary: input.conversationSummary,
      })
    }

    const payload = await response.json()
    const outputText = extractResponseText(payload)
    if (!outputText) {
      console.warn('[whatsapp-interpreter/openai] fallback empty_output')
      return prioritizeExplicitTimeOverConfirmation({
        interpreted: fallback,
        conversationState: input.conversationState,
        conversationSummary: input.conversationSummary,
      })
    }

    const parsedJson = sanitizeOpenAiIntentPayload(JSON.parse(outputText))
    const parsed = IntentSchema.safeParse(parsedJson)

    if (!parsed.success) {
      console.warn('[whatsapp-interpreter/openai] fallback invalid_schema', {
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}:${issue.message}`),
      })
      return prioritizeExplicitTimeOverConfirmation({
        interpreted: fallback,
        conversationState: input.conversationState,
        conversationSummary: input.conversationSummary,
      })
    }

    const merged = mergeWithFallback(parsed.data, fallback)

    return prioritizeExplicitTimeOverConfirmation({
      interpreted: {
      ...merged,
      mentionedName: sanitizeMentionedNameCandidate(merged.mentionedName, input.professionals, true),
      preferredPeriod: merged.preferredPeriod ?? derivePreferredPeriod(merged.timePreference),
      },
      conversationState: input.conversationState,
      conversationSummary: input.conversationSummary,
    })
  } catch (error) {
    console.warn('[whatsapp-interpreter/openai] fallback request_failed', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    return prioritizeExplicitTimeOverConfirmation({
      interpreted: fallback,
      conversationState: input.conversationState,
      conversationSummary: input.conversationSummary,
    })
  } finally {
    clearTimeout(timeout)
  }
}
