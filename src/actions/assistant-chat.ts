'use server'

import { buildAssistantFailureResult } from '@/lib/assistant-chat-guards'
import type { AiAssistantSendResult } from '@/lib/ai/assistant-chat-types'
import { loadAiAssistantWorkspace, loadAiChatThread, sendAiAssistantPrompt } from '@/lib/assistant-chat'
import { requireAuthenticatedUser } from '@/lib/security/guards'
import { safeLog } from '@/lib/security/safe-logger'

export async function loadAssistantWorkspace() {
  const session = await requireAuthenticatedUser()

  return loadAiAssistantWorkspace({
    userId: session.userId,
    barbershopId: session.barbershopId,
    role: session.role,
    name: session.session.user.name,
    email: session.session.user.email,
  })
}

export async function loadAssistantThread(threadId: string) {
  const session = await requireAuthenticatedUser()

  return loadAiChatThread(
    {
      userId: session.userId,
      barbershopId: session.barbershopId,
      role: session.role,
      name: session.session.user.name,
      email: session.session.user.email,
    },
    threadId
  )
}

export async function askAssistant(input: {
  threadId?: string | null
  question: string
  pathname?: string | null
}): Promise<AiAssistantSendResult> {
  const session = await requireAuthenticatedUser()

  try {
    const result = await sendAiAssistantPrompt({
      session: {
        userId: session.userId,
        barbershopId: session.barbershopId,
        role: session.role,
        name: session.session.user.name,
        email: session.session.user.email,
      },
      threadId: input.threadId ?? null,
      question: input.question,
      pathname: input.pathname ?? null,
    })

    return result
  } catch (error) {
    safeLog('error', '[assistant-widget] action failed', {
      userId: session.userId,
      barbershopId: session.barbershopId,
      role: session.role,
      threadId: input.threadId ?? null,
      pathname: input.pathname ?? null,
      error,
    })

    return buildAssistantFailureResult(undefined, input.threadId ?? null)
  }
}
