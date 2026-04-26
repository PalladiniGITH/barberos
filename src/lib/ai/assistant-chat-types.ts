import type { AiChatRoleScope } from '@prisma/client'

export type AssistantChatScope = AiChatRoleScope

export interface AiChatThreadSummaryView {
  id: string
  title: string
  roleScope: AssistantChatScope
  updatedAtIso: string
  updatedAtLabel: string
  lastMessagePreview: string | null
}

export interface AiChatMessageView {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  createdAtIso: string
  createdAtLabel: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  metadata: {
    statusNote: string | null
    dataFreshnessLabel: string | null
    scopeLabel: string | null
  }
}

export interface AiChatThreadDetailView {
  id: string
  title: string
  roleScope: AssistantChatScope
  messages: AiChatMessageView[]
}

export interface AiAssistantWorkspaceView {
  roleScope: AssistantChatScope
  suggestions: string[]
  placeholder: string
  description: string
  dataWindowLabel: string
  selectedThread: AiChatThreadDetailView | null
  threadSummaries: AiChatThreadSummaryView[]
}
