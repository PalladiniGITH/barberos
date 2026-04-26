'use client'

import { useMemo, useState, useTransition } from 'react'
import { BrainCircuit, Loader2, MessageSquarePlus, Send } from 'lucide-react'
import { toast } from 'sonner'
import { askAssistant, loadAssistantThread } from '@/actions/assistant-chat'
import type {
  AiAssistantWorkspaceView,
  AiChatMessageView,
  AiChatThreadDetailView,
  AiChatThreadSummaryView,
} from '@/lib/ai/assistant-chat-types'
import { cn } from '@/lib/utils'

interface Props {
  workspace: AiAssistantWorkspaceView
}

function getScopeLabel(roleScope: AiAssistantWorkspaceView['roleScope']) {
  if (roleScope === 'PROFESSIONAL') {
    return 'Escopo: seu desempenho'
  }

  if (roleScope === 'FINANCIAL') {
    return 'Escopo: financeiro'
  }

  return 'Escopo: gestao da barbearia'
}

function MessageBubble({ message }: { message: AiChatMessageView }) {
  const isUser = message.role === 'USER'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <article
        className={cn(
          'max-w-[88%] rounded-[1.25rem] border px-4 py-3 shadow-[0_18px_34px_-28px_rgba(2,6,23,0.72)]',
          isUser
            ? 'border-[rgba(124,58,237,0.24)] bg-[linear-gradient(180deg,rgba(124,58,237,0.18),rgba(91,33,182,0.12))] text-violet-50'
            : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-foreground'
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {isUser ? 'Voce' : 'BarberEX IA'}
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

export function AssistantChatPanel({ workspace }: Props) {
  const [threadSummaries, setThreadSummaries] = useState<AiChatThreadSummaryView[]>(workspace.threadSummaries)
  const [selectedThread, setSelectedThread] = useState<AiChatThreadDetailView | null>(workspace.selectedThread)
  const [draft, setDraft] = useState('')
  const [inlineErrorMessage, setInlineErrorMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const latestAssistantMessage = useMemo(
    () => [...(selectedThread?.messages ?? [])].reverse().find((message) => message.role === 'ASSISTANT') ?? null,
    [selectedThread]
  )

  function replaceThreadSummary(nextSummary: AiChatThreadSummaryView) {
    setThreadSummaries((current) => {
      const filtered = current.filter((summary) => summary.id !== nextSummary.id)
      return [nextSummary, ...filtered]
    })
  }

  function submitQuestion(rawQuestion: string) {
    const question = rawQuestion.trim()

    if (!question) {
      return
    }

    startTransition(async () => {
      try {
        const result = await askAssistant({
          threadId: selectedThread?.id ?? null,
          question,
        })

        if (!result.ok) {
          setInlineErrorMessage(result.message)
          return
        }

        setSelectedThread(result.thread)
        replaceThreadSummary(result.threadSummary)
        setDraft('')
        setInlineErrorMessage(null)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Nao foi possivel falar com o BarberEX IA agora.')
      }
    })
  }

  function handleThreadSelect(threadId: string) {
    if (selectedThread?.id === threadId) {
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

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="dashboard-panel flex min-h-[680px] flex-col overflow-hidden p-0">
        <div className="border-b border-[rgba(255,255,255,0.08)] px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Historico recente</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Cada conversa fica ligada ao seu perfil e ao escopo liberado para este acesso.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedThread(null)}
              className="action-button"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Nova
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {threadSummaries.length === 0 ? (
            <div className="rounded-[1.2rem] border border-dashed border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 text-sm leading-6 text-muted-foreground">
              Sua primeira pergunta ja cria uma conversa nova. Depois disso, voce pode voltar ao historico por aqui.
            </div>
          ) : (
            <div className="space-y-2">
              {threadSummaries.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => handleThreadSelect(thread.id)}
                  className={cn(
                    'w-full rounded-[1.05rem] border p-3 text-left transition-colors',
                    selectedThread?.id === thread.id
                      ? 'border-[rgba(124,58,237,0.22)] bg-[linear-gradient(180deg,rgba(45,36,79,0.78),rgba(26,27,42,0.98))] shadow-[0_20px_40px_-30px_rgba(91,33,182,0.48)]'
                      : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.05)]'
                  )}
                >
                  <p className="truncate text-sm font-semibold text-foreground">{thread.title}</p>
                  {thread.lastMessagePreview && (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{thread.lastMessagePreview}</p>
                  )}
                  <p className="mt-2 text-[11px] text-slate-500">{thread.updatedAtLabel}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="dashboard-panel flex min-h-[680px] flex-col overflow-hidden p-0">
        <div className="border-b border-[rgba(255,255,255,0.08)] px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">BarberEX IA</h2>
              </div>

              <p className="mt-3 text-base font-medium text-foreground">
                {selectedThread?.title ?? 'Nova conversa com o BarberEX IA'}
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {workspace.description}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {getScopeLabel(workspace.roleScope)}
              </p>
            </div>

            <div className="space-y-1 text-xs text-muted-foreground lg:text-right">
              <p>{workspace.dataWindowLabel}</p>
              {latestAssistantMessage?.metadata.dataFreshnessLabel && (
                <p>{latestAssistantMessage.metadata.dataFreshnessLabel}</p>
              )}
            </div>
          </div>
        </div>

        <div className="border-b border-[rgba(255,255,255,0.06)] px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {workspace.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => submitQuestion(suggestion)}
                className="rounded-full border border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.08)] px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-[rgba(124,58,237,0.14)]"
                disabled={isPending}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {selectedThread?.messages.length ? (
            <div className="space-y-4">
              {selectedThread.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {inlineErrorMessage && (
                <div className="flex justify-start">
                  <div className="max-w-[88%] rounded-[1.1rem] border border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.08)] px-4 py-3 text-sm text-slate-100">
                    <p className="font-medium">Nao foi possivel responder agora.</p>
                    <p className="mt-1 text-xs leading-6 text-rose-100/90">{inlineErrorMessage}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center">
              <div className="max-w-xl rounded-[1.5rem] border border-dashed border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.06)] p-6 text-center">
                <p className="text-sm font-semibold text-foreground">Pergunte o que voce precisa decidir agora</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  O BarberEX IA usa um contexto compacto, respeita o escopo do seu perfil e responde com base nos dados disponiveis da operacao.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[rgba(255,255,255,0.08)] px-5 py-5">
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
              rows={4}
              placeholder={workspace.placeholder}
              className="auth-input min-h-[120px] w-full resize-y rounded-[1.1rem] px-4 py-3 text-sm leading-6"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Respostas baseadas no contexto atual do BarberEX e limitadas ao seu perfil.
              </p>
              <button
                type="submit"
                className="action-button-primary"
                disabled={isPending || draft.trim().length === 0}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  )
}
