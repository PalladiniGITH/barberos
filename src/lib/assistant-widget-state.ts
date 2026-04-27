import type { AiChatMessageView } from '@/lib/ai/assistant-chat-types'

export type AssistantDisplayedMessageStatus = 'sent' | 'pending' | 'error'

export interface AssistantDisplayedMessage extends AiChatMessageView {
  status: AssistantDisplayedMessageStatus
}

interface BuildAssistantDisplayedMessagesInput {
  persistedMessages?: AiChatMessageView[] | null
  optimisticMessages?: AiChatMessageView[] | null
  pendingAssistantMessage?: AiChatMessageView | null
  errorAssistantMessage?: AiChatMessageView | null
}

export function buildAssistantDisplayedMessages(
  input: BuildAssistantDisplayedMessagesInput
): AssistantDisplayedMessage[] {
  const persistedMessages = input.persistedMessages ?? []
  const optimisticMessages = input.optimisticMessages ?? []

  const baseMessages: AssistantDisplayedMessage[] = [
    ...persistedMessages.map((message) => ({ ...message, status: 'sent' as const })),
    ...optimisticMessages.map((message) => ({ ...message, status: 'sent' as const })),
  ]

  if (input.pendingAssistantMessage) {
    baseMessages.push({
      ...input.pendingAssistantMessage,
      status: 'pending',
    })
  }

  if (input.errorAssistantMessage) {
    baseMessages.push({
      ...input.errorAssistantMessage,
      status: 'error',
    })
  }

  return baseMessages
}
