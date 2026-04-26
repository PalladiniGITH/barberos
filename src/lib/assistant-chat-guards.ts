import type { AiAssistantSendFailureResult, AiAssistantSendReason } from '@/lib/ai/assistant-chat-types'

const LOW_SIGNAL_PATTERNS = [
  /^o+i+$/i,
  /^ol[aa]$/i,
  /^opa+$/i,
  /^ei+$/i,
  /^e ai$/i,
  /^e ai\??$/i,
  /^e ai[!]?$|^e ai[?]?$/i,
  /^ok(?:ay)?$/i,
  /^ok+$/i,
  /^blz$/i,
  /^beleza$/i,
  /^teste(?:ando)?$/i,
  /^hello$/i,
  /^bom dia$/i,
  /^boa tarde$/i,
  /^boa noite$/i,
  /^ajuda$/i,
]

const DEFAULT_ASSISTANT_FAILURE_MESSAGE = 'Nao consegui responder agora. Tente novamente em instantes.'
const DEFAULT_ASSISTANT_GUIDANCE =
  'Me diga o que voce quer analisar na barbearia. Por exemplo: faturamento da semana, clientes para reativar, agenda de amanha ou margem dos servicos.'

export interface AssistantQuestionValidationResult {
  normalizedQuestion: string
  reason: AiAssistantSendReason
  shouldSkipOpenAi: boolean
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function isLowSignalQuestion(value: string) {
  const normalized = normalizeWhitespace(value).toLowerCase()

  return LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function validateAssistantQuestion(rawQuestion: string, maxQuestionLength: number): AssistantQuestionValidationResult {
  const normalizedQuestion = normalizeWhitespace(rawQuestion)

  if (!normalizedQuestion) {
    return {
      normalizedQuestion,
      reason: 'EMPTY_INPUT',
      shouldSkipOpenAi: true,
    }
  }

  if (normalizedQuestion.length > maxQuestionLength) {
    return {
      normalizedQuestion,
      reason: 'TOO_LONG',
      shouldSkipOpenAi: true,
    }
  }

  if (normalizedQuestion.length < 4 || isLowSignalQuestion(normalizedQuestion)) {
    return {
      normalizedQuestion,
      reason: 'SHORT_INPUT',
      shouldSkipOpenAi: true,
    }
  }

  return {
    normalizedQuestion,
    reason: 'NORMAL',
    shouldSkipOpenAi: false,
  }
}

export function buildAssistantValidationReply(input: {
  originalQuestion: string
  reason: Exclude<AiAssistantSendReason, 'NORMAL'>
  suggestions?: string[]
}) {
  const examples = (input.suggestions ?? [])
    .map((suggestion) => suggestion.trim())
    .filter((suggestion) => suggestion.length > 0)
    .slice(0, 4)

  const examplesLabel = examples.length > 0 ? ` Exemplos: ${examples.join('; ')}.` : ''
  const normalized = normalizeWhitespace(input.originalQuestion).toLowerCase()
  const looksLikeGreeting = normalized.length > 0 && LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized))

  if (input.reason === 'TOO_LONG') {
    return `Pode me mandar uma pergunta mais direta, com ate 600 caracteres?${examplesLabel || ` ${DEFAULT_ASSISTANT_GUIDANCE}`}`
  }

  if (looksLikeGreeting) {
    return `Oi! Me diga o que voce quer analisar: agenda, clientes, faturamento, equipe ou margem dos servicos.${examplesLabel}`
  }

  return `${DEFAULT_ASSISTANT_GUIDANCE}${examplesLabel}`
}

export function buildAssistantFailureResult(
  message = DEFAULT_ASSISTANT_FAILURE_MESSAGE,
  threadId: string | null = null
): AiAssistantSendFailureResult {
  return {
    ok: false,
    errorCode: 'ASSISTANT_FAILED',
    message,
    threadId,
  }
}
