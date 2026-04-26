'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth'
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
}) {
  const session = await requireSession()

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

  revalidatePath('/assistente')

  return result
}
