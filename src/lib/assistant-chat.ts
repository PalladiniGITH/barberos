import 'server-only'

import type { AiChatMessage, AiChatRoleScope, AiChatThread } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { AuthorizationError } from '@/lib/auth'
import {
  buildAssistantFailureResult,
  buildAssistantValidationReply,
  validateAssistantQuestion,
} from '@/lib/assistant-chat-guards'
import { resolveAssistantScreenContext } from '@/lib/assistant-screen-context'
import {
  buildAiAssistantContext,
  buildAiAssistantThreadTitle,
  resolveAssistantScopeForSession,
} from '@/lib/assistant-chat-context'
import type {
  AiAssistantSendResult,
  AiAssistantWorkspaceView,
  AiChatMessageView,
  AiChatThreadDetailView,
  AiChatThreadSummaryView,
} from '@/lib/ai/assistant-chat-types'
import { generateInternalAssistantAnswer } from '@/lib/ai/internal-assistant'
import { recordAiUsage } from '@/lib/ai/usage-log'
import { prisma } from '@/lib/prisma'
import { formatDateTimeInTimezone, resolveBusinessTimezone } from '@/lib/timezone'

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

function logAssistantWidgetEvent(stage: string, input: Record<string, unknown>) {
  console.info(`[assistant-widget] ${stage}`, input)
}

function logAssistantWidgetError(stage: string, input: Record<string, unknown>, error: unknown) {
  const details = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    : {
        name: 'UnknownError',
        message: String(error),
        stack: null,
      }

  console.error(`[assistant-widget] ${stage}`, {
    ...input,
    error: details,
  })
}

function buildUnauthorizedResponse(scope: AiChatRoleScope) {
  if (scope === 'PROFESSIONAL') {
    return 'Eu posso ajudar apenas com sua agenda, meta, atendimentos, comissao e clientes ligados ao seu trabalho. Dados globais da barbearia e da equipe ficam fora do seu escopo.'
  }

  if (scope === 'FINANCIAL') {
    return 'Neste perfil eu fico restrito a leitura financeira e indicadores globais permitidos. Dados operacionais sensiveis da equipe ou clientes nominais nao entram neste escopo.'
  }

  return 'Nao posso atender esse pedido com o escopo atual.'
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
    return 'Nao posso expor regras internas, prompts, segredos ou payloads do sistema.'
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
      'agenda amanha',
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

function serializeMessage(
  message: Pick<
    AiChatMessage,
    'id' | 'role' | 'content' | 'createdAt' | 'model' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'metadataJson'
  >,
  timezone: string
): AiChatMessageView {
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
    messages: Array<
      Pick<
        AiChatMessage,
        'id' | 'role' | 'content' | 'createdAt' | 'model' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'metadataJson'
      >
    >
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

function buildThreadSummaryFromHydratedThread(
  thread: Awaited<ReturnType<typeof getThreadForUser>>,
  timezone: string
) {
  if (!thread) {
    return null
  }

  return serializeThreadSummary(
    {
      ...thread,
      messages: thread.messages.slice(-1).map((message) => ({
        content: message.content,
        createdAt: message.createdAt,
      })),
    },
    timezone
  )
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
    throw new AuthorizationError('Conversa nao encontrada para este usuario.')
  }

  return serializeThreadDetail(thread, timezone)
}

export async function sendAiAssistantPrompt(input: {
  session: AssistantSessionIdentity
  threadId?: string | null
  question: string
  pathname?: string | null
}): Promise<AiAssistantSendResult> {
  const validation = validateAssistantQuestion(input.question, MAX_QUESTION_LENGTH)
  const logContext = {
    userId: input.session.userId,
    barbershopId: input.session.barbershopId,
    role: input.session.role ?? null,
    threadId: input.threadId ?? null,
    pathname: input.pathname ?? null,
    questionLength: validation.normalizedQuestion.length,
  }

  logAssistantWidgetEvent('send started', logContext)

  let thread: Pick<AiChatThread, 'id' | 'title' | 'roleScope'> | null = null

  try {
    const contextEnvelope = await buildAiAssistantContext(input.session)
    const scope = contextEnvelope.scope
    const screenContext = resolveAssistantScreenContext(input.pathname, scope.roleScope)
    const barbershop = await prisma.barbershop.findUnique({
      where: { id: input.session.barbershopId },
      select: { timezone: true },
    })
    const timezone = resolveBusinessTimezone(barbershop?.timezone)

    logAssistantWidgetEvent('context resolved', {
      ...logContext,
      scope: scope.roleScope,
      screenContextKey: screenContext.key,
      screenContextLabel: screenContext.label,
      validationReason: validation.reason,
    })

    thread = input.threadId
      ? await prisma.aiChatThread.findFirst({
          where: {
            id: input.threadId,
            userId: input.session.userId,
            barbershopId: input.session.barbershopId,
          },
          select: {
            id: true,
            title: true,
            roleScope: true,
          },
        })
      : null

    if (!thread) {
      thread = await prisma.aiChatThread.create({
        data: {
          barbershopId: input.session.barbershopId,
          userId: input.session.userId,
          roleScope: scope.roleScope,
          title: buildAiAssistantThreadTitle(validation.normalizedQuestion || 'Nova conversa'),
        },
        select: {
          id: true,
          title: true,
          roleScope: true,
        },
      })
    }

    logAssistantWidgetEvent('thread resolved', {
      ...logContext,
      threadId: thread.id,
      createdThread: input.threadId !== thread.id,
    })

    const userMessageRecord = validation.normalizedQuestion
      ? await prisma.aiChatMessage.create({
          data: {
            threadId: thread.id,
            role: 'USER',
            content: validation.normalizedQuestion,
            metadataJson: {
              scopeLabel: scope.scopeLabel,
              screenContextKey: screenContext.key,
              screenContextLabel: screenContext.label,
              screenPathname: screenContext.pathname,
            },
          },
        })
      : null

    if (userMessageRecord) {
      logAssistantWidgetEvent('user message persisted', {
        ...logContext,
        threadId: thread.id,
        messageId: userMessageRecord.id,
      })
    }

    if (validation.shouldSkipOpenAi) {
      const validationReason = validation.reason === 'NORMAL' ? 'SHORT_INPUT' : validation.reason
      const assistantValidationMessage = await prisma.aiChatMessage.create({
        data: {
          threadId: thread.id,
          role: 'ASSISTANT',
          content: buildAssistantValidationReply({
            originalQuestion: validation.normalizedQuestion || input.question,
            reason: validationReason,
            suggestions: contextEnvelope.suggestions,
          }),
          metadataJson: {
            scopeLabel: scope.scopeLabel,
            statusNote: 'Orientacao inicial sem chamada de IA',
            dataFreshnessLabel: contextEnvelope.dataFreshnessLabel,
            screenContextKey: screenContext.key,
            screenContextLabel: screenContext.label,
            screenPathname: screenContext.pathname,
          },
        },
      })

      logAssistantWidgetEvent('short input handled', {
        ...logContext,
        threadId: thread.id,
        validationReason,
      })

      await prisma.aiChatThread.update({
        where: { id: thread.id },
        data: {
          title: thread.title || buildAiAssistantThreadTitle(validation.normalizedQuestion || 'Nova conversa'),
        },
      })

      const hydratedThread = await getThreadForUser({
        threadId: thread.id,
        userId: input.session.userId,
        barbershopId: input.session.barbershopId,
      })
      const threadSummary = buildThreadSummaryFromHydratedThread(hydratedThread, timezone)

      if (!hydratedThread || !threadSummary) {
        return buildAssistantFailureResult(undefined, thread.id)
      }

      return {
        ok: true,
        thread: serializeThreadDetail(hydratedThread, timezone),
        threadSummary,
        userMessage: userMessageRecord ? serializeMessage(userMessageRecord, timezone) : null,
        assistantMessage: serializeMessage(assistantValidationMessage, timezone),
        skippedOpenAi: true,
        reason: validationReason,
      }
    }

    const blockedResponse = detectProtectedQuestion(scope.roleScope, validation.normalizedQuestion)

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

    if (!blockedResponse) {
      logAssistantWidgetEvent('openai started', {
        ...logContext,
        threadId: thread.id,
        scope: scope.roleScope,
        screenContextKey: screenContext.key,
      })
    }

    const aiAttempt = blockedResponse
      ? {
          answer: blockedResponse,
          failureReason: 'disabled' as const,
          model: null,
          promptVersion: 'scope-block.v1',
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          totalTokens: null,
        }
      : await generateInternalAssistantAnswer({
          scopeLabel: scope.scopeLabel,
          context: contextEnvelope.compactContext,
          history,
          question: validation.normalizedQuestion,
          screenContext: {
            key: screenContext.key,
            label: screenContext.label,
            subtitle: screenContext.subtitle,
            pathname: screenContext.pathname,
          },
        })

    logAssistantWidgetEvent('openai completed', {
      ...logContext,
      threadId: thread.id,
      skippedOpenAi: Boolean(blockedResponse),
      failureReason: aiAttempt.failureReason,
      model: aiAttempt.model,
      totalTokens: aiAttempt.totalTokens,
    })

    const answer = aiAttempt.answer?.trim() || contextEnvelope.fallbackAnswer
    const statusNote = blockedResponse
      ? 'Pedido fora do escopo liberado para este perfil'
      : aiAttempt.answer
        ? 'Resposta baseada no contexto atual do sistema'
        : 'Analise automatica temporariamente indisponivel'

    const assistantMessageRecord = await prisma.aiChatMessage.create({
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
          screenContextKey: screenContext.key,
          screenContextLabel: screenContext.label,
          screenPathname: screenContext.pathname,
        },
      },
    })

    if (!blockedResponse) {
      await recordAiUsage({
        barbershopId: input.session.barbershopId,
        userId: input.session.userId,
        threadId: thread.id,
        source: 'INTERNAL_ASSISTANT',
        model: aiAttempt.model,
        inputTokens: aiAttempt.inputTokens,
        cachedInputTokens: aiAttempt.cachedInputTokens,
        outputTokens: aiAttempt.outputTokens,
        totalTokens: aiAttempt.totalTokens,
        status: aiAttempt.answer ? 'SUCCESS' : 'FALLBACK',
        errorMessage: aiAttempt.failureReason,
        metadataJson: {
          threadId: thread.id,
          promptVersion: aiAttempt.promptVersion,
          scope: scope.roleScope,
          screenContextKey: screenContext.key,
          screenContextLabel: screenContext.label,
        },
      })

      logAssistantWidgetEvent('usage logged', {
        ...logContext,
        threadId: thread.id,
        model: aiAttempt.model,
        totalTokens: aiAttempt.totalTokens,
      })
    }

    await prisma.aiChatThread.update({
      where: { id: thread.id },
      data: {
        title: thread.title || buildAiAssistantThreadTitle(validation.normalizedQuestion),
      },
    })

    const hydratedThread = await getThreadForUser({
      threadId: thread.id,
      userId: input.session.userId,
      barbershopId: input.session.barbershopId,
    })
    const threadSummary = buildThreadSummaryFromHydratedThread(hydratedThread, timezone)

    if (!hydratedThread || !threadSummary) {
      return buildAssistantFailureResult(undefined, thread.id)
    }

    return {
      ok: true,
      thread: serializeThreadDetail(hydratedThread, timezone),
      threadSummary,
      userMessage: userMessageRecord ? serializeMessage(userMessageRecord, timezone) : null,
      assistantMessage: serializeMessage(assistantMessageRecord, timezone),
      skippedOpenAi: Boolean(blockedResponse),
      reason: 'NORMAL',
    }
  } catch (error) {
    logAssistantWidgetError(
      'send failed',
      {
        ...logContext,
        threadId: thread?.id ?? input.threadId ?? null,
      },
      error
    )

    return buildAssistantFailureResult(undefined, thread?.id ?? input.threadId ?? null)
  }
}
