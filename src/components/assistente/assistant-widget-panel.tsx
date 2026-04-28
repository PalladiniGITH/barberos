'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import {
  BrainCircuit,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  Minimize2,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { askAssistant, loadAssistantThread, loadAssistantWorkspace } from '@/actions/assistant-chat'
import { AssistantMessageContent } from '@/components/assistente/assistant-message-content'
import { resolveAssistantScreenContext } from '@/lib/assistant-screen-context'
import type {
  AiAssistantWorkspaceView,
  AiChatMessageView,
  AiChatThreadDetailView,
  AiChatThreadSummaryView,
} from '@/lib/ai/assistant-chat-types'
import { buildAssistantDisplayedMessages, type AssistantDisplayedMessage } from '@/lib/assistant-widget-state'
import { cn } from '@/lib/utils'
import { useAssistantWidget } from '@/components/assistente/assistant-widget-provider'

function getScopeLabel(roleScope?: AiAssistantWorkspaceView['roleScope']) {
  if (roleScope === 'PROFESSIONAL') {
    return 'Escopo: seu desempenho'
  }

  if (roleScope === 'FINANCIAL') {
    return 'Escopo: financeiro'
  }

  return 'Escopo: gestao da barbearia'
}

function formatClientMessageTime(date: Date) {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildOptimisticThreadTitle(question: string) {
  const normalized = question.replace(/\s+/g, ' ').trim()

  if (normalized.length <= 72) {
    return normalized
  }

  return `${normalized.slice(0, 69).trimEnd()}...`
}

function buildOptimisticMessage(input: {
  role: AiChatMessageView['role']
  content: string
  statusNote?: string | null
  createdAt?: Date
}) {
  const createdAt = input.createdAt ?? new Date()

  return {
    id: `optimistic-${input.role.toLowerCase()}-${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    role: input.role,
    content: input.content,
    createdAtIso: createdAt.toISOString(),
    createdAtLabel: formatClientMessageTime(createdAt),
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    metadata: {
      statusNote: input.statusNote ?? null,
      dataFreshnessLabel: null,
      scopeLabel: null,
    },
  } satisfies AiChatMessageView
}

function MessageBubble({ message }: { message: AssistantDisplayedMessage }) {
  const isUser = message.role === 'USER'
  const isPending = message.status === 'pending'
  const isError = message.status === 'error'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <article
        className={cn(
          'max-w-[90%] rounded-[1.25rem] border px-4 py-3.5 shadow-[0_18px_34px_-30px_rgba(2,6,23,0.78)]',
          isError
            ? 'border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.08)] text-slate-100'
            : isPending
              ? 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] text-muted-foreground'
            : isUser
            ? 'border-[rgba(124,92,255,0.18)] bg-[linear-gradient(180deg,rgba(124,92,255,0.18),rgba(63,53,111,0.24))] text-violet-50'
            : 'border-[rgba(255,255,255,0.05)] bg-[linear-gradient(180deg,rgba(34,34,38,0.54),rgba(19,19,22,0.9))] text-foreground'
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {isUser ? 'Voce' : 'BarberEX IA'}
          </p>
          <span className="text-[11px] text-muted-foreground">{message.createdAtLabel}</span>
        </div>
        {isUser ? (
          <p className="mt-2.5 whitespace-pre-line break-words text-sm leading-7">{message.content}</p>
        ) : (
          <AssistantMessageContent content={message.content} />
        )}
        {!isUser && (
          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {message.metadata.statusNote && <p>{message.metadata.statusNote}</p>}
            {message.metadata.dataFreshnessLabel && <p>{message.metadata.dataFreshnessLabel}</p>}
          </div>
        )}
      </article>
    </div>
  )
}

function RecentThreadsList(input: {
  threadSummaries: AiChatThreadSummaryView[]
  selectedThreadId?: string | null
  onSelect: (threadId: string) => void
  disabled?: boolean
  compact?: boolean
}) {
  const { threadSummaries, selectedThreadId, onSelect, disabled = false, compact = false } = input

  if (threadSummaries.length === 0) {
    return (
      <p className="text-xs leading-6 text-muted-foreground">
        Sua primeira pergunta abre uma nova conversa. Depois disso, o historico recente aparece aqui.
      </p>
    )
  }

  return (
    <div className={cn('space-y-2', compact && 'max-h-44 overflow-y-auto pr-1')}>
      {threadSummaries.map((thread) => {
        const isActive = selectedThreadId === thread.id

        return (
          <button
            key={thread.id}
            type="button"
            onClick={() => onSelect(thread.id)}
            className={cn(
              'w-full rounded-[1.05rem] border px-3.5 py-3 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:-translate-y-0.5',
              isActive
                ? 'border-[rgba(124,92,255,0.16)] bg-[linear-gradient(180deg,rgba(44,43,52,0.92),rgba(21,21,24,0.98))] shadow-[0_20px_40px_-32px_rgba(91,33,182,0.34)]'
                : 'border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.025)] hover:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.04)]'
            )}
            disabled={disabled}
          >
            <p className={cn('truncate text-sm font-semibold', isActive ? 'text-slate-50' : 'text-slate-100')}>
              {thread.title}
            </p>
            {thread.lastMessagePreview ? (
              <p className={cn('mt-2 line-clamp-2 text-xs leading-5', isActive ? 'text-slate-300' : 'text-slate-400')}>
                {thread.lastMessagePreview}
              </p>
            ) : (
              <p className="mt-2 text-xs leading-5 text-slate-500">Sem resposta registrada ainda.</p>
            )}
            <p className={cn('mt-3 text-[11px]', isActive ? 'text-slate-400' : 'text-slate-500')}>
              {thread.updatedAtLabel}
            </p>
          </button>
        )
      })}
    </div>
  )
}

export function AssistantWidgetPanel() {
  const pathname = usePathname() ?? '/dashboard'
  const { closeAssistant, hasOpened, isOpen, visible } = useAssistantWidget()
  const [workspace, setWorkspace] = useState<AiAssistantWorkspaceView | null>(null)
  const [threadSummaries, setThreadSummaries] = useState<AiChatThreadSummaryView[]>([])
  const [selectedThread, setSelectedThread] = useState<AiChatThreadDetailView | null>(null)
  const [draft, setDraft] = useState('')
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [showRecentThreads, setShowRecentThreads] = useState(true)
  const [optimisticMessages, setOptimisticMessages] = useState<AiChatMessageView[]>([])
  const [optimisticThreadTitle, setOptimisticThreadTitle] = useState<string | null>(null)
  const [inlineErrorMessage, setInlineErrorMessage] = useState<string | null>(null)
  const [isLoadingThread, setIsLoadingThread] = useState(false)
  const [isPending, startTransition] = useTransition()
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)

  const roleScope = workspace?.roleScope ?? 'MANAGEMENT'
  const screenContext = useMemo(
    () => resolveAssistantScreenContext(pathname, roleScope),
    [pathname, roleScope]
  )
  const latestAssistantMessage = useMemo(
    () => [...(selectedThread?.messages ?? [])].reverse().find((message) => message.role === 'ASSISTANT') ?? null,
    [selectedThread]
  )
  const persistedMessages = selectedThread?.messages ?? []
  const pendingAssistantMessage = useMemo(
    () => isPending
      ? buildOptimisticMessage({
        role: 'ASSISTANT',
        content: 'BarberEX IA esta analisando...',
        statusNote: 'A resposta entra nesta conversa assim que o processamento terminar.',
      })
      : null,
    [isPending]
  )
  const errorAssistantMessage = useMemo(
    () => inlineErrorMessage
      ? buildOptimisticMessage({
        role: 'ASSISTANT',
        content: 'Nao consegui responder agora. Tente novamente em instantes.',
        statusNote: inlineErrorMessage,
      })
      : null,
    [inlineErrorMessage]
  )
  const displayedMessages = useMemo(
    () => buildAssistantDisplayedMessages({
      persistedMessages,
      optimisticMessages,
      pendingAssistantMessage,
      errorAssistantMessage,
    }),
    [errorAssistantMessage, optimisticMessages, pendingAssistantMessage, persistedMessages]
  )

  const helperSuggestions = screenContext.suggestions.length > 0 ? screenContext.suggestions : (workspace?.suggestions ?? [])
  const helperPlaceholder = screenContext.placeholder || workspace?.placeholder || 'Pergunte sobre a operação da barbearia.'
  const hasActiveConversation = Boolean(
    selectedThread
    || optimisticThreadTitle
    || displayedMessages.length > 0
    || inlineErrorMessage
  )
  const activeConversationTitle = selectedThread?.title ?? optimisticThreadTitle ?? 'Nova conversa'
  const compactConversationView = hasActiveConversation
  const headerDescription = compactConversationView
    ? 'Agenda, clientes, metas e numeros.'
    : 'Pergunte sobre agenda, clientes, metas e numeros.'
  const compactContextLine = [
    getScopeLabel(workspace?.roleScope),
    screenContext.label,
    workspace?.dataWindowLabel ?? null,
  ].filter(Boolean).join(' / ')
  const footerNote = compactConversationView
    ? 'Baseado nos dados disponíveis do período e no seu escopo.'
    : 'Respostas baseadas nos dados disponíveis do período. O backend continua sendo a autoridade do seu escopo.'

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !isOpen) {
      return
    }

    console.debug('[assistant-widget] visual state', {
      activeThreadId: selectedThread?.id ?? null,
      currentThreadTitle: selectedThread?.title ?? optimisticThreadTitle ?? null,
      persistedMessagesCount: persistedMessages.length,
      optimisticMessagesCount: optimisticMessages.length,
      displayedMessagesCount: displayedMessages.length,
      isLoadingThread,
      isSending: isPending,
      recentListOpen: showRecentThreads,
    })
  }, [
    displayedMessages.length,
    isOpen,
    isLoadingThread,
    isPending,
    optimisticMessages.length,
    optimisticThreadTitle,
    persistedMessages.length,
    selectedThread?.id,
    selectedThread?.title,
    showRecentThreads,
  ])

  const loadWorkspace = useCallback(async () => {
    if (loadState === 'loading') {
      return
    }

    setLoadState('loading')

    try {
      const result = await loadAssistantWorkspace()
      setWorkspace(result)
      setThreadSummaries(result.threadSummaries)
      setSelectedThread(result.selectedThread)
      setShowRecentThreads(!result.selectedThread)
      setOptimisticMessages([])
      setOptimisticThreadTitle(null)
      setInlineErrorMessage(null)
      setIsLoadingThread(false)
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
      toast.error(error instanceof Error ? error.message : 'Não foi possível abrir o BarberEX IA agora.')
    }
  }, [loadState])

  useEffect(() => {
    if (visible && hasOpened && loadState === 'idle') {
      void loadWorkspace()
    }
  }, [hasOpened, loadState, loadWorkspace, visible])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    })
  }, [displayedMessages, isOpen])

  function replaceThreadSummary(nextSummary: AiChatThreadSummaryView) {
    setThreadSummaries((current) => {
      const filtered = current.filter((summary) => summary.id !== nextSummary.id)
      return [nextSummary, ...filtered]
    })
  }

  function resetTransientConversation() {
    setOptimisticMessages([])
    setOptimisticThreadTitle(null)
    setInlineErrorMessage(null)
  }

  function handleThreadSelect(threadId: string) {
    if (selectedThread?.id === threadId || isPending) {
      setShowRecentThreads(false)
      return
    }

    resetTransientConversation()
    setIsLoadingThread(true)
    setShowRecentThreads(false)
    const selectedSummary = threadSummaries.find((thread) => thread.id === threadId)

    if (selectedSummary) {
      setSelectedThread({
        id: selectedSummary.id,
        title: selectedSummary.title,
        roleScope: selectedSummary.roleScope,
        messages: [],
      })
    }

    startTransition(() => {
      void (async () => {
        try {
          const thread = await loadAssistantThread(threadId)
          setSelectedThread(thread)
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Não foi possível abrir essa conversa.')
        } finally {
          setIsLoadingThread(false)
        }
      })()
    })
  }

  function handleNewConversation() {
    setSelectedThread(null)
    setDraft('')
    setShowRecentThreads(true)
    setIsLoadingThread(false)
    resetTransientConversation()
  }

  function submitQuestion(rawQuestion: string) {
    const question = rawQuestion.trim()

    if (!question || isPending || loadState !== 'ready') {
      return
    }

    const userMessage = buildOptimisticMessage({
      role: 'USER',
      content: question,
    })

    setInlineErrorMessage(null)
    setShowRecentThreads(false)
    setDraft('')

    if (!selectedThread) {
      setOptimisticThreadTitle(buildOptimisticThreadTitle(question))
    }

    setOptimisticMessages((current) => [...current, userMessage])

    startTransition(() => {
      void (async () => {
        try {
          const result = await askAssistant({
            threadId: selectedThread?.id ?? null,
            question,
            pathname,
          })

          if (!result.ok) {
            setInlineErrorMessage(result.message)
            return
          }

          setSelectedThread(result.thread)
          replaceThreadSummary(result.threadSummary)
          resetTransientConversation()
        } catch (error) {
          setInlineErrorMessage('Não consegui responder agora. Tente novamente em instantes.')
          toast.error('Não foi possível falar com o BarberEX IA agora.')
        }
      })()
    })
  }

  if (!visible || !hasOpened) {
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={closeAssistant}
        aria-hidden={!isOpen}
        className={cn(
          'fixed inset-0 z-30 bg-[rgba(2,6,23,0.56)] backdrop-blur-sm transition-opacity duration-200 sm:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />

      <section
        aria-hidden={!isOpen}
        className={cn(
          'fixed z-40 flex flex-col overflow-hidden rounded-[1.6rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(28,28,33,0.99),rgba(14,14,17,0.995))] shadow-[0_44px_86px_-54px_rgba(2,6,23,0.94)] transition-[opacity,transform] duration-200 ease-out',
          'left-3 right-3 top-[5.25rem] bottom-3 sm:left-auto sm:top-auto sm:h-[min(720px,calc(100vh-3rem))] sm:w-[min(476px,calc(100vw-3rem))]',
          isOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0 sm:translate-y-3'
        )}
        style={{
          right: 'max(1rem, env(safe-area-inset-right))',
          bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <header className={cn(
          'shrink-0 border-b border-[rgba(255,255,255,0.06)] px-4 sm:px-5',
          compactConversationView ? 'py-2.5' : 'py-4'
        )}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <h2 className="text-lg font-semibold tracking-tight text-foreground">BarberEX IA</h2>
              </div>
              <p className={cn(
                'text-foreground',
                compactConversationView ? 'mt-1 text-[11px] leading-5 text-muted-foreground' : 'mt-2 text-sm leading-6'
              )}>
                {headerDescription}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleNewConversation}
                className={cn(
                  'inline-flex items-center justify-center rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground',
                  compactConversationView ? 'h-9 w-9' : 'h-10 w-10'
                )}
                aria-label="Nova conversa"
                title="Nova conversa"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={closeAssistant}
                className={cn(
                  'inline-flex items-center justify-center rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground',
                  compactConversationView ? 'h-9 w-9' : 'h-10 w-10'
                )}
                aria-label="Minimizar assistente"
                title="Minimizar"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className={cn(
            'text-xs text-muted-foreground',
            compactConversationView ? 'mt-1.5 truncate text-[11px] leading-5' : 'mt-3 space-y-1 leading-6'
          )}>
            {compactConversationView ? (
              <p className="truncate">
                {compactContextLine}
              </p>
            ) : (
              <>
                <p>{workspace?.dataWindowLabel ?? 'Carregando base do período...'}</p>
                <p>{getScopeLabel(workspace?.roleScope)} / {screenContext.label}</p>
                {latestAssistantMessage?.metadata.dataFreshnessLabel && (
                  <p>{latestAssistantMessage.metadata.dataFreshnessLabel}</p>
                )}
              </>
            )}
          </div>
        </header>

        <div className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden px-4 sm:px-5',
          compactConversationView ? 'py-2' : 'py-4'
        )}>
          {loadState === 'loading' && !workspace ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="rounded-[1.4rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-5 py-4 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                <p className="mt-3 text-sm font-medium text-foreground">Carregando o contexto da tela atual</p>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  Estamos montando o contexto seguro do seu perfil.
                </p>
              </div>
            </div>
          ) : loadState === 'error' && !workspace ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="max-w-sm rounded-[1.4rem] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.08)] px-5 py-4 text-center">
                <p className="text-sm font-semibold text-foreground">Não foi possível abrir o BarberEX IA agora.</p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  Tente novamente em instantes. O restante da tela continua funcionando normalmente.
                </p>
                <button
                  type="button"
                  onClick={() => void loadWorkspace()}
                  className="action-button mt-4"
                >
                  Tentar de novo
                </button>
              </div>
            </div>
          ) : (
            <>
              {hasActiveConversation ? (
                <div className="relative mb-2 shrink-0">
                  <div className="flex items-center gap-3 rounded-[0.95rem] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        <span className="mr-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Conversa atual
                        </span>
                        {activeConversationTitle}
                      </p>
                    </div>
                    {threadSummaries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowRecentThreads((current) => !current)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-[0.75rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.025)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300 transition-colors hover:bg-[rgba(255,255,255,0.045)]"
                      >
                        <span>{showRecentThreads ? 'Ocultar' : 'Ver conversas'}</span>
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showRecentThreads && 'rotate-180')} />
                      </button>
                    )}
                  </div>

                  {showRecentThreads && threadSummaries.length > 0 && (
                    <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-[1.05rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(27,27,30,0.985),rgba(14,14,17,0.995))] shadow-[0_30px_54px_-36px_rgba(2,6,23,0.92)]">
                      <div className="max-h-60 overflow-y-auto p-2.5">
                        <RecentThreadsList
                          threadSummaries={threadSummaries}
                          selectedThreadId={selectedThread?.id ?? null}
                          onSelect={handleThreadSelect}
                          disabled={isPending}
                          compact
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-3 shrink-0 rounded-[1.15rem] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Conversas recentes</p>
                      <p className="mt-1 text-xs leading-6 text-muted-foreground">
                        Abra uma conversa existente ou comece uma nova pergunta.
                      </p>
                    </div>
                    {threadSummaries.length > 0 && (
                      <p className="text-xs text-slate-400">{threadSummaries.length} conversa{threadSummaries.length === 1 ? '' : 's'}</p>
                    )}
                  </div>
                  <div className="mt-3">
                    <RecentThreadsList
                      threadSummaries={threadSummaries}
                      selectedThreadId={selectedThread?.id ?? null}
                      onSelect={handleThreadSelect}
                      disabled={isPending}
                      compact
                    />
                  </div>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-hidden rounded-[1.3rem] border border-[rgba(255,255,255,0.05)] bg-[linear-gradient(180deg,rgba(17,17,20,0.98),rgba(10,10,12,0.995))] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div
                  ref={messagesViewportRef}
                  className={cn(
                    'flex h-full min-h-0 flex-col overflow-y-auto px-3 sm:px-4',
                    compactConversationView ? 'py-2.5 sm:py-3' : 'py-3 sm:py-4'
                  )}
                >
                  {hasActiveConversation ? (
                    <div className="space-y-3.5">
                      {isLoadingThread ? (
                        <div className="flex min-h-[220px] items-center justify-center">
                          <div className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              Carregando as mensagens desta conversa...
                            </div>
                          </div>
                        </div>
                      ) : displayedMessages.length > 0 ? (
                        displayedMessages.map((message) => (
                          <MessageBubble key={message.id} message={message} />
                        ))
                      ) : (
                        <div className="flex min-h-[220px] items-center justify-center">
                          <div className="max-w-sm text-center">
                            <p className="text-sm font-semibold text-foreground">Esta conversa ainda nao tem mensagens visiveis.</p>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">
                              Envie uma pergunta para comecar e acompanhar a troca completa aqui dentro.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex min-h-full items-center justify-center">
                      <div className="w-full max-w-md rounded-[1.4rem] border border-dashed border-[rgba(124,92,255,0.14)] bg-[rgba(124,92,255,0.05)] p-5">
                        <p className="text-sm font-semibold text-foreground">Pergunte o que voce precisa decidir agora</p>
                        <p className="mt-2 text-sm leading-7 text-muted-foreground">
                          O BarberEX IA entende a tela atual, respeita o escopo do seu perfil e responde com base nos dados disponíveis do período.
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {helperSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => submitQuestion(suggestion)}
                              className="rounded-[0.85rem] border border-[rgba(124,92,255,0.16)] bg-[rgba(124,92,255,0.07)] px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-[rgba(124,92,255,0.12)]"
                              disabled={isPending || loadState !== 'ready'}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <footer className={cn(
          'shrink-0 border-t border-[rgba(255,255,255,0.06)] px-4 sm:px-5',
          compactConversationView ? 'py-2.5' : 'py-4'
        )}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitQuestion(draft)
            }}
            className={cn('space-y-3', compactConversationView && 'space-y-2.5')}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submitQuestion(draft)
                }
              }}
              rows={compactConversationView ? 2 : 3}
              placeholder={helperPlaceholder}
              className={cn(
                'auth-input w-full resize-none rounded-[1.1rem] px-4 text-sm leading-6',
                compactConversationView ? 'min-h-[76px] py-2.5' : 'min-h-[104px] py-3'
              )}
              disabled={isPending || loadState !== 'ready'}
            />
            <div className="flex items-end justify-between gap-3">
              <p className={cn(
                'max-w-[70%] text-muted-foreground',
                compactConversationView ? 'text-[10px] leading-5' : 'text-xs leading-6'
              )}>
                {footerNote}
              </p>
              <button
                type="submit"
                className="action-button-primary"
                disabled={isPending || loadState !== 'ready' || draft.trim().length === 0}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </button>
            </div>
          </form>
        </footer>
      </section>
    </>
  )
}
