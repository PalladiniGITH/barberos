'use server'

import { requireSession } from '@/lib/auth'
import { buildAssistantFailureResult } from '@/lib/assistant-chat-guards'
import type { AiAssistantSendResult } from '@/lib/ai/assistant-chat-types'
import { loadAiAssistantWorkspace, loadAiChatThread, sendAiAssistantPrompt } from '@/lib/assistant-chat'

export async function loadAssistantWorkspace() {
  const session = await requireSession()

  return loadAiAssistantWorkspace({
    userId: session.user.id,
    barbershopId: session.user.barbershopId,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
  })
}

export async function loadAssistantThread(threadId: string) {
  const session = await requireSession()

  return loadAiChatThread(
    {
      userId: session.user.id,
      barbershopId: session.user.barbershopId,
      role: session.user.role,
      name: session.user.name,
      email: session.user.email,
    },
    threadId
  )
}

export async function askAssistant(input: {
  threadId?: string | null
  question: string
  pathname?: string | null
}): Promise<AiAssistantSendResult> {
  const session = await requireSession()

  try {
    const result = await sendAiAssistantPrompt({
      session: {
        userId: session.user.id,
        barbershopId: session.user.barbershopId,
        role: session.user.role,
        name: session.user.name,
        email: session.user.email,
      },
      threadId: input.threadId ?? null,
      question: input.question,
      pathname: input.pathname ?? null,
    })

    return result
  } catch (error) {
    console.error('[assistant-widget] action failed', {
      userId: session.user.id,
      barbershopId: session.user.barbershopId,
      role: session.user.role,
      threadId: input.threadId ?? null,
      pathname: input.pathname ?? null,
      error: error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : {
            name: 'UnknownError',
            message: String(error),
            stack: null,
          },
    })

    return buildAssistantFailureResult(undefined, input.threadId ?? null)
  }
}
