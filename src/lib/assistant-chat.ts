import 'server-only'

import type { AiChatMessage, AiChatRoleScope, AiChatThread } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { AuthorizationError } from '@/lib/auth'
import {
  buildAiAssistantContext,
  buildAiAssistantThreadTitle,
  resolveAssistantScopeForSession,
} from '@/lib/assistant-chat-context'
import type {
  AiAssistantWorkspaceView,
  AiChatMessageView,
  AiChatThreadDetailView,
  AiChatThreadSummaryView,
} from '@/lib/ai/assistant-chat-types'
import { generateInternalAssistantAnswer } from '@/lib/ai/internal-assistant'
import { prisma } from '@/lib/prisma'
import { formatDateInTimezone, formatDateTimeInTimezone, resolveBusinessTimezone } from '@/lib/timezone'

const MAX_THREAD_MESSAGES = 40
const MAX_HISTORY_MESSAGES = 6
const MAX_QUESTION_LENGTH = 600

interface AssistantSessionIdentity {
  userId: string
  barbershopId: string
  role: string | null | undefined
  name?: string | null
  email?: string | null
}

function normalizeQuestion(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function buildUnauthorizedResponse(scope: AiChatRoleScope) {
  if (scope === 'PROFESSIONAL') {
    return 'Eu posso ajudar apenas com sua agenda, meta, atendimentos, comissão e clientes ligados ao seu trabalho. Dados globais da barbearia e da equipe ficam fora do seu escopo.'
  }

  if (scope === 'FINANCIAL') {
    return 'Neste perfil eu fico restrito à leitura financeira e indicadores globais permitidos. Dados operacionais sensíveis da equipe ou clientes nominais não entram neste escopo.'
  }

  return 'Não posso atender esse pedido com o escopo atual.'
}

function detectProtectedQuestion(scope: AiChatRoleScope, question: string) {
  const normalized = question.toLowerCase()

  const genericSensitivePatterns = [
    'ignore as regras',
    'ignore as instrucoes',
    'mostre o prompt',
    'mostre suas regras',
    'payload bruto',
    'segredo',
    'token',
    'credencial',
  ]

  if (genericSensitivePatterns.some((pattern) => normalized.includes(pattern))) {
    return 'Não posso expor regras internas, prompts, segredos ou payloads do sistema.'
  }

  if (scope === 'PROFESSIONAL') {
    const blockedPatterns = [
      'todos os barbeiros',
      'outros barbeiros',
      'ranking da equipe',
      'faturamento da barbearia',
      'financeiro geral',
      'todos os clientes',
      'clientes da barbearia',
      'margem da barbearia',
      'resultado da equipe',
    ]

    if (blockedPatterns.some((pattern) => normalized.includes(pattern))) {
      return buildUnauthorizedResponse(scope)
    }
  }

  if (scope === 'FINANCIAL') {
    const blockedPatterns = [
      'agenda de',
      'agenda amanhã',
      'qual barbeiro performou melhor',
      'ranking da equipe',
      'clientes em risco',
      'quais clientes',
      'clientes meus',
      'meus clientes',
    ]

    if (blockedPatterns.some((pattern) => normalized.includes(pattern))) {
      return buildUnauthorizedResponse(scope)
    }
  }

  return null
}

function serializeThreadSummary(
  thread: AiChatThread & { messages: Array<Pick<AiChatMessage, 'content' | 'createdAt'>> },
  timezone: string
): AiChatThreadSummaryView {
  const lastMessage = thread.messages[0] ?? null

  return {
    id: thread.id,
    title: thread.title,
    roleScope: thread.roleScope,
    updatedAtIso: thread.updatedAt.toISOString(),
    updatedAtLabel: formatDateTimeInTimezone(thread.updatedAt, timezone),
    lastMessagePreview: lastMessage ? lastMessage.content.slice(0, 140) : null,
  }
}

function readMessageMetadata(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      statusNote: null,
      dataFreshnessLabel: null,
      scopeLabel: null,
    }
  }

  const candidate = value as Record<string, unknown>

  return {
    statusNote: typeof candidate.statusNote === 'string' ? candidate.statusNote : null,
    dataFreshnessLabel: typeof candidate.dataFreshnessLabel === 'string' ? candidate.dataFreshnessLabel : null,
    scopeLabel: typeof candidate.scopeLabel === 'string' ? candidate.scopeLabel : null,
  }
}

function serializeMessage(message: Pick<
  AiChatMessage,
  'id' | 'role' | 'content' | 'createdAt' | 'model' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'metadataJson'
>, timezone: string): AiChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAtIso: message.createdAt.toISOString(),
    createdAtLabel: formatDateTimeInTimezone(message.createdAt, timezone),
    model: message.model,
    inputTokens: message.inputTokens,
    outputTokens: message.outputTokens,
    totalTokens: message.totalTokens,
    metadata: readMessageMetadata(message.metadataJson),
  }
}

function serializeThreadDetail(
  thread: AiChatThread & {
    messages: Array<Pick<
      AiChatMessage,
      'id' | 'role' | 'content' | 'createdAt' | 'model' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'metadataJson'
    >>
  },
  timezone: string
): AiChatThreadDetailView {
  return {
    id: thread.id,
    title: thread.title,
    roleScope: thread.roleScope,
    messages: thread.messages.map((message) => serializeMessage(message, timezone)),
  }
}

async function getThreadForUser(input: {
  threadId: string
  userId: string
  barbershopId: string
}) {
  return prisma.aiChatThread.findFirst({
    where: {
      id: input.threadId,
      userId: input.userId,
      barbershopId: input.barbershopId,
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: MAX_THREAD_MESSAGES,
      },
    },
  })
}

export async function loadAiAssistantWorkspace(
  session: AssistantSessionIdentity
): Promise<AiAssistantWorkspaceView> {
  const contextEnvelope = await buildAiAssistantContext(session)
  const timezone = resolveBusinessTimezone(
    (
      await prisma.barbershop.findUnique({
        where: { id: session.barbershopId },
        select: { timezone: true },
      })
    )?.timezone
  )

  const threads = await prisma.aiChatThread.findMany({
    where: {
      userId: session.userId,
      barbershopId: session.barbershopId,
    },
    orderBy: { updatedAt: 'desc' },
    take: 12,
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          content: true,
          createdAt: true,
        },
      },
    },
  })

  const selectedThreadRecord = threads[0]
    ? await getThreadForUser({
        threadId: threads[0].id,
        userId: session.userId,
        barbershopId: session.barbershopId,
      })
    : null

  return {
    roleScope: contextEnvelope.scope.roleScope,
    suggestions: contextEnvelope.suggestions,
    placeholder: contextEnvelope.placeholder,
    description: contextEnvelope.description,
    dataWindowLabel: contextEnvelope.dataWindowLabel,
    selectedThread: selectedThreadRecord ? serializeThreadDetail(selectedThreadRecord, timezone) : null,
    threadSummaries: threads.map((thread) => serializeThreadSummary(thread, timezone)),
  }
}

export async function loadAiChatThread(
  session: AssistantSessionIdentity,
  threadId: string
): Promise<AiChatThreadDetailView> {
  await resolveAssistantScopeForSession(session)

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: session.barbershopId },
    select: { timezone: true },
  })
  const timezone = resolveBusinessTimezone(barbershop?.timezone)

  const thread = await getThreadForUser({
    threadId,
    userId: session.userId,
    barbershopId: session.barbershopId,
  })

  if (!thread) {
    throw new AuthorizationError('Conversa não encontrada para este usuário.')
  }

  return serializeThreadDetail(thread, timezone)
}

export async function sendAiAssistantPrompt(input: {
  session: AssistantSessionIdentity
  threadId?: string | null
  question: string
}): Promise<{
  thread: AiChatThreadDetailView
  threadSummary: AiChatThreadSummaryView
}> {
  const question = normalizeQuestion(input.question)

  if (question.length < 4) {
    throw new Error('Escreva uma pergunta um pouco mais completa para o assistente responder.')
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    throw new Error(`Use no máximo ${MAX_QUESTION_LENGTH} caracteres por pergunta.`)
  }

  const contextEnvelope = await buildAiAssistantContext(input.session)
  const scope = contextEnvelope.scope
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: input.session.barbershopId },
    select: { timezone: true },
  })
  const timezone = resolveBusinessTimezone(barbershop?.timezone)

  const blockedResponse = detectProtectedQuestion(scope.roleScope, question)

  let thread = input.threadId
    ? await prisma.aiChatThread.findFirst({
        where: {
          id: input.threadId,
          userId: input.session.userId,
          barbershopId: input.session.barbershopId,
        },
      })
    : null

  if (!thread) {
    thread = await prisma.aiChatThread.create({
      data: {
        barbershopId: input.session.barbershopId,
        userId: input.session.userId,
        roleScope: scope.roleScope,
        title: buildAiAssistantThreadTitle(question),
      },
    })
  }

  await prisma.aiChatMessage.create({
    data: {
      threadId: thread.id,
      role: 'USER',
      content: question,
      metadataJson: {
        scopeLabel: scope.scopeLabel,
      },
    },
  })

  const historyMessages = await prisma.aiChatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_MESSAGES,
    select: {
      role: true,
      content: true,
    },
  })

  const history = historyMessages
    .reverse()
    .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 500),
    })) as Array<{ role: 'USER' | 'ASSISTANT'; content: string }>

  const aiAttempt = blockedResponse
    ? {
        answer: blockedResponse,
        failureReason: 'disabled' as const,
        model: null,
        promptVersion: 'scope-block.v1',
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }
    : await generateInternalAssistantAnswer({
        scopeLabel: scope.scopeLabel,
        context: contextEnvelope.compactContext,
        history,
        question,
      })

  const answer = aiAttempt.answer?.trim() || contextEnvelope.fallbackAnswer
  const statusNote = blockedResponse
    ? 'Pedido fora do escopo liberado para este perfil'
    : aiAttempt.answer
      ? 'Resposta baseada no contexto atual do sistema'
      : 'Análise automática temporariamente indisponível'

  await prisma.aiChatMessage.create({
    data: {
      threadId: thread.id,
      role: 'ASSISTANT',
      content: answer,
      model: aiAttempt.model,
      inputTokens: aiAttempt.inputTokens,
      outputTokens: aiAttempt.outputTokens,
      totalTokens: aiAttempt.totalTokens,
      metadataJson: {
        scopeLabel: scope.scopeLabel,
        statusNote,
        dataFreshnessLabel: contextEnvelope.dataFreshnessLabel,
        promptVersion: aiAttempt.promptVersion,
      },
    },
  })

  await prisma.aiChatUsageLog.create({
    data: {
      barbershopId: input.session.barbershopId,
      userId: input.session.userId,
      threadId: thread.id,
      model: aiAttempt.model,
      inputTokens: aiAttempt.inputTokens,
      outputTokens: aiAttempt.outputTokens,
      totalTokens: aiAttempt.totalTokens,
    },
  })

  await prisma.aiChatThread.update({
    where: { id: thread.id },
    data: {
      title: thread.title || buildAiAssistantThreadTitle(question),
    },
  })

  const hydratedThread = await getThreadForUser({
    threadId: thread.id,
    userId: input.session.userId,
    barbershopId: input.session.barbershopId,
  })

  if (!hydratedThread) {
    throw new Error('Não foi possível recarregar a conversa do assistente.')
  }

  return {
    thread: serializeThreadDetail(hydratedThread, timezone),
    threadSummary: serializeThreadSummary(
      {
        ...hydratedThread,
        messages: hydratedThread.messages.slice(-1).map((message) => ({
          content: message.content,
          createdAt: message.createdAt,
        })),
      },
      timezone
    ),
  }
}
