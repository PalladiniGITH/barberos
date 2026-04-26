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
import { resolveAssistantScreenContext } from '@/lib/assistant-screen-context'
import type {
  AiAssistantWorkspaceView,
  AiChatMessageView,
  AiChatThreadDetailView,
  AiChatThreadSummaryView,
} from '@/lib/ai/assistant-chat-types'
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
}) {
  const createdAt = new Date()

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

function MessageBubble({ message }: { message: AiChatMessageView }) {
  const isUser = message.role === 'USER'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <article
        className={cn(
          'max-w-[88%] rounded-[1.2rem] border px-4 py-3 shadow-[0_18px_34px_-28px_rgba(2,6,23,0.72)]',
          isUser
            ? 'border-[rgba(124,58,237,0.24)] bg-[linear-gradient(180deg,rgba(124,58,237,0.18),rgba(91,33,182,0.12))] text-violet-50'
            : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-foreground'
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {isUser ? 'Voce' : 'BarberEX IA'}
          </p>
          <span className="text-[11px] text-muted-foreground">{message.createdAtLabel}</span>
        </div>
        <p className="mt-2 whitespace-pre-line break-words text-sm leading-7">{message.content}</p>
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
                ? 'border-[rgba(124,58,237,0.22)] bg-[linear-gradient(180deg,rgba(45,36,79,0.78),rgba(26,27,42,0.98))] shadow-[0_20px_40px_-30px_rgba(91,33,182,0.48)]'
                : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.035)] hover:border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.055)]'
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
  const conversationMessages = useMemo(
    () => [...(selectedThread?.messages ?? []), ...optimisticMessages],
    [optimisticMessages, selectedThread]
  )
  const displayedMessages = conversationMessages

  const helperDescription = screenContext.subtitle
  const helperSuggestions = screenContext.suggestions.length > 0 ? screenContext.suggestions : (workspace?.suggestions ?? [])
  const helperPlaceholder = screenContext.placeholder || workspace?.placeholder || 'Pergunte sobre a operacao da barbearia.'
  const hasActiveConversation = Boolean(
    selectedThread
    || optimisticThreadTitle
    || conversationMessages.length > 0
    || inlineErrorMessage
  )
  const activeConversationTitle = selectedThread?.title ?? optimisticThreadTitle ?? 'Nova conversa'

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !isOpen) {
      return
    }

    console.debug('[assistant-widget] visual state', {
      activeThreadId: selectedThread?.id ?? null,
      selectedThreadMessages: selectedThread?.messages.length ?? 0,
      optimisticMessages: optimisticMessages.length,
      displayedMessages: displayedMessages.length,
      isRecentListOpen: showRecentThreads,
      hasActiveConversation,
      inlineErrorMessage: Boolean(inlineErrorMessage),
    })
  }, [
    displayedMessages.length,
    hasActiveConversation,
    inlineErrorMessage,
    isOpen,
    optimisticMessages.length,
    selectedThread?.id,
    selectedThread?.messages.length,
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
      setShowRecentThreads(!(result.selectedThread && result.selectedThread.messages.length > 0))
      setOptimisticMessages([])
      setOptimisticThreadTitle(null)
      setInlineErrorMessage(null)
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel abrir o BarberEX IA agora.')
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
  }, [conversationMessages, inlineErrorMessage, isOpen, isPending])

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

    startTransition(() => {
      void (async () => {
        try {
          const thread = await loadAssistantThread(threadId)
          setSelectedThread(thread)
          setShowRecentThreads(false)
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Nao foi possivel abrir essa conversa.')
        }
      })()
    })
  }

  function handleNewConversation() {
    setSelectedThread(null)
    setDraft('')
    setShowRecentThreads(true)
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
          setInlineErrorMessage('Nao consegui responder agora. Tente novamente em instantes.')
          toast.error('Nao foi possivel falar com o BarberEX IA agora.')
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
          'fixed z-40 flex flex-col overflow-hidden rounded-[1.6rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.99),rgba(15,17,21,0.98))] shadow-[0_56px_120px_-58px_rgba(2,6,23,0.9)] transition-[opacity,transform] duration-200 ease-out',
          'left-3 right-3 top-[5.25rem] bottom-3 sm:left-auto sm:top-auto sm:h-[min(720px,calc(100vh-3rem))] sm:w-[min(468px,calc(100vw-3rem))]',
          isOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0 sm:translate-y-3'
        )}
        style={{
          right: 'max(1rem, env(safe-area-inset-right))',
          bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <header className="shrink-0 border-b border-[rgba(255,255,255,0.08)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <h2 className="text-lg font-semibold tracking-tight text-foreground">BarberEX IA</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground">
                Pergunte sobre agenda, clientes, metas e numeros.
              </p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {getScopeLabel(workspace?.roleScope)} / {screenContext.label}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleNewConversation}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground"
                aria-label="Nova conversa"
                title="Nova conversa"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={closeAssistant}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground"
                aria-label="Minimizar assistente"
                title="Minimizar"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 text-xs leading-6 text-muted-foreground">
            <p>{workspace?.dataWindowLabel ?? 'Carregando base do periodo...'}</p>
            {latestAssistantMessage?.metadata.dataFreshnessLabel && (
              <p>{latestAssistantMessage.metadata.dataFreshnessLabel}</p>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-visible px-4 py-4 sm:px-5">
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
                <p className="text-sm font-semibold text-foreground">Nao foi possivel abrir o BarberEX IA agora.</p>
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
                <div className="relative mb-3 shrink-0 rounded-[1.05rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Conversa atual
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">{activeConversationTitle}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{helperDescription}</p>
                    </div>
                    {threadSummaries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowRecentThreads((current) => !current)}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      >
                        <span>{showRecentThreads ? 'Ocultar conversas' : 'Ver conversas'}</span>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', showRecentThreads && 'rotate-180')} />
                      </button>
                    )}
                  </div>

                  {showRecentThreads && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-[1.05rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.99),rgba(15,17,21,0.98))] p-3 shadow-[0_30px_60px_-34px_rgba(2,6,23,0.88)]">
                      <RecentThreadsList
                        threadSummaries={threadSummaries}
                        selectedThreadId={selectedThread?.id ?? null}
                        onSelect={handleThreadSelect}
                        disabled={isPending}
                        compact
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-3 shrink-0 rounded-[1.15rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-4">
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

              <div className="h-0 min-h-0 flex-1 overflow-hidden rounded-[1.3rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(15,18,27,0.9),rgba(12,14,20,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div
                  ref={messagesViewportRef}
                  className="flex h-full min-h-0 flex-col overflow-y-auto px-3 py-3 sm:px-4 sm:py-4"
                >
                  {hasActiveConversation ? (
                    <div className="space-y-4">
                      {displayedMessages.length > 0 ? (
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

                      {inlineErrorMessage && (
                        <div className="flex justify-start">
                          <div className="max-w-[88%] rounded-[1.1rem] border border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.08)] px-4 py-3 text-sm text-slate-100">
                            <p className="font-medium">Nao foi possivel responder agora.</p>
                            <p className="mt-1 text-xs leading-6 text-rose-100/90">{inlineErrorMessage}</p>
                          </div>
                        </div>
                      )}

                      {isPending && (
                        <div className="flex justify-start">
                          <div className="max-w-[88%] rounded-[1.1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              BarberEX IA esta analisando...
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex min-h-full items-center justify-center">
                      <div className="w-full max-w-md rounded-[1.5rem] border border-dashed border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.06)] p-5">
                        <p className="text-sm font-semibold text-foreground">Pergunte o que voce precisa decidir agora</p>
                        <p className="mt-2 text-sm leading-7 text-muted-foreground">
                          O BarberEX IA entende a tela atual, respeita o escopo do seu perfil e responde com base nos dados disponiveis do periodo.
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {helperSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => submitQuestion(suggestion)}
                              className="rounded-full border border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.08)] px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-[rgba(124,58,237,0.14)]"
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

        <footer className="shrink-0 border-t border-[rgba(255,255,255,0.08)] px-4 py-4 sm:px-5">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitQuestion(draft)
            }}
            className="space-y-3"
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
              rows={3}
              placeholder={helperPlaceholder}
              className="auth-input min-h-[104px] w-full resize-none rounded-[1.1rem] px-4 py-3 text-sm leading-6"
              disabled={isPending || loadState !== 'ready'}
            />
            <div className="flex items-end justify-between gap-3">
              <p className="max-w-[70%] text-xs leading-6 text-muted-foreground">
                Respostas baseadas nos dados disponiveis do periodo. O backend continua sendo a autoridade do seu escopo.
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
