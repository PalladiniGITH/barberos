'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import {
  BrainCircuit,
  Loader2,
  MessageSquarePlus,
  Minimize2,
  Send,
  Sparkles,
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
    return 'Meu desempenho'
  }

  if (roleScope === 'FINANCIAL') {
    return 'Escopo financeiro'
  }

  return 'Escopo gerencial'
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
            : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-foreground'
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {isUser ? 'Voce' : 'Assistente EX'}
          </p>
          <span className="text-[11px] text-muted-foreground">{message.createdAtLabel}</span>
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-7">{message.content}</p>
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

export function AssistantWidgetPanel() {
  const pathname = usePathname() ?? '/dashboard'
  const { closeAssistant, hasOpened, isOpen, visible } = useAssistantWidget()
  const [workspace, setWorkspace] = useState<AiAssistantWorkspaceView | null>(null)
  const [threadSummaries, setThreadSummaries] = useState<AiChatThreadSummaryView[]>([])
  const [selectedThread, setSelectedThread] = useState<AiChatThreadDetailView | null>(null)
  const [draft, setDraft] = useState('')
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
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

  const helperDescription = screenContext.subtitle
  const helperSuggestions = screenContext.suggestions.length > 0 ? screenContext.suggestions : (workspace?.suggestions ?? [])
  const helperPlaceholder = screenContext.placeholder || workspace?.placeholder || 'Pergunte sobre a operacao da barbearia.'

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
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel abrir o Assistente EX agora.')
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
  }, [isOpen, selectedThread])

  function replaceThreadSummary(nextSummary: AiChatThreadSummaryView) {
    setThreadSummaries((current) => {
      const filtered = current.filter((summary) => summary.id !== nextSummary.id)
      return [nextSummary, ...filtered]
    })
  }

  function handleThreadSelect(threadId: string) {
    if (selectedThread?.id === threadId || isPending) {
      return
    }

    startTransition(async () => {
      try {
        const thread = await loadAssistantThread(threadId)
        setSelectedThread(thread)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Nao foi possivel abrir essa conversa.')
      }
    })
  }

  function handleNewConversation() {
    setSelectedThread(null)
    setDraft('')
  }

  function submitQuestion(rawQuestion: string) {
    const question = rawQuestion.trim()

    if (!question || isPending || loadState !== 'ready') {
      return
    }

    startTransition(async () => {
      try {
        const result = await askAssistant({
          threadId: selectedThread?.id ?? null,
          question,
          pathname,
        })

        setSelectedThread(result.thread)
        replaceThreadSummary(result.threadSummary)
        setDraft('')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Nao foi possivel falar com o assistente agora.')
      }
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
          'left-3 right-3 top-[5.25rem] bottom-3 sm:left-auto sm:right-6 sm:top-auto sm:bottom-6 sm:h-[min(720px,calc(100vh-7rem))] sm:w-[min(460px,calc(100vw-2.25rem))]',
          isOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0 sm:translate-y-3'
        )}
        style={{
          right: 'max(1rem, env(safe-area-inset-right))',
          bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          left: 'max(0.75rem, env(safe-area-inset-left))',
        }}
      >
        <header className="border-b border-[rgba(255,255,255,0.08)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="surface-chip">
                  <BrainCircuit className="h-3.5 w-3.5" />
                  Assistente EX
                </span>
                <span className="surface-chip">
                  <Sparkles className="h-3.5 w-3.5" />
                  {getScopeLabel(workspace?.roleScope)}
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold tracking-tight text-foreground">
                {screenContext.label}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {helperDescription}
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

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{workspace?.dataWindowLabel ?? 'Carregando base do periodo...'}</span>
            {latestAssistantMessage?.metadata.dataFreshnessLabel && (
              <span className="text-slate-500">{latestAssistantMessage.metadata.dataFreshnessLabel}</span>
            )}
          </div>
        </header>

        <div className="border-b border-[rgba(255,255,255,0.06)] px-4 py-3 sm:px-5">
          {threadSummaries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sua primeira pergunta abre uma nova conversa. Depois disso, o historico recente aparece aqui.
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hidden">
              {threadSummaries.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => handleThreadSelect(thread.id)}
                  className={cn(
                    'min-w-[168px] flex-shrink-0 rounded-[1rem] border px-3 py-2.5 text-left transition-colors',
                    selectedThread?.id === thread.id
                      ? 'border-[rgba(124,58,237,0.22)] bg-[rgba(124,58,237,0.1)]'
                      : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.05)]'
                  )}
                  disabled={isPending}
                >
                  <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Recente
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">{thread.title}</p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{thread.updatedAtLabel}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={messagesViewportRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loadState === 'loading' && !workspace ? (
            <div className="flex h-full min-h-[280px] items-center justify-center">
              <div className="rounded-[1.4rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-5 py-4 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                <p className="mt-3 text-sm font-medium text-foreground">Carregando o copiloto da tela atual</p>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  Estamos montando o contexto seguro do seu perfil.
                </p>
              </div>
            </div>
          ) : loadState === 'error' && !workspace ? (
            <div className="flex h-full min-h-[280px] items-center justify-center">
              <div className="max-w-sm rounded-[1.4rem] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.08)] px-5 py-4 text-center">
                <p className="text-sm font-semibold text-foreground">Nao foi possivel abrir o Assistente EX agora.</p>
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
          ) : selectedThread?.messages.length ? (
            <div className="space-y-4">
              {selectedThread.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isPending && (
                <div className="flex justify-start">
                  <div className="rounded-[1.1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      Pensando com base nos dados disponiveis...
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] items-center justify-center">
              <div className="w-full max-w-md rounded-[1.5rem] border border-dashed border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.06)] p-5">
                <p className="text-sm font-semibold text-foreground">Pergunte o que voce precisa decidir agora</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  O Assistente EX entende a tela atual, respeita o escopo do seu perfil e responde com base nos dados disponiveis do periodo.
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

        <footer className="border-t border-[rgba(255,255,255,0.08)] px-4 py-4 sm:px-5">
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
