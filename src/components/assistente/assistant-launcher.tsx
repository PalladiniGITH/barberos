'use client'

import { MessageSquareText, Sparkles } from 'lucide-react'
import { PRODUCT_MONOGRAM } from '@/lib/branding'
import { cn } from '@/lib/utils'
import { useAssistantWidget } from '@/components/assistente/assistant-widget-provider'

export function AssistantLauncher() {
  const { isOpen, openAssistant, visible } = useAssistantWidget()

  if (!visible || isOpen) {
    return null
  }

  return (
    <button
      type="button"
      onClick={openAssistant}
      className={cn(
        'fixed z-40 flex items-center gap-3 rounded-[1.25rem] border border-[rgba(124,58,237,0.16)] bg-[linear-gradient(180deg,rgba(18,21,30,0.96),rgba(12,14,19,0.98))] px-3.5 py-3 text-left text-slate-50 shadow-[0_28px_50px_-34px_rgba(2,6,23,0.9)] transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:border-[rgba(139,92,246,0.24)] hover:bg-[linear-gradient(180deg,rgba(24,28,40,0.98),rgba(12,14,19,0.98))] hover:shadow-[0_34px_58px_-36px_rgba(91,33,182,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(139,92,246,0.44)]',
        'bottom-4 right-4 sm:bottom-6 sm:right-6'
      )}
      style={{
        bottom: 'max(1rem, env(safe-area-inset-bottom))',
        right: 'max(1rem, env(safe-area-inset-right))',
      }}
      aria-label="Abrir BarberEX IA"
    >
      <span className="relative flex h-12 w-12 items-center justify-center rounded-[1rem] border border-[rgba(124,58,237,0.22)] bg-[radial-gradient(circle_at_35%_25%,rgba(168,85,247,0.28),transparent_45%),linear-gradient(135deg,rgba(124,58,237,0.2),rgba(15,23,42,0.96))] text-[11px] font-semibold tracking-[0.16em] text-violet-50">
        <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(139,92,246,0.18)] text-violet-100">
          <Sparkles className="h-3 w-3" />
        </span>
        {PRODUCT_MONOGRAM}
      </span>

      <span className="hidden min-w-0 flex-col sm:flex">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-200/80">
          BarberEX IA
        </span>
        <span className="mt-1 text-sm font-medium text-slate-100">
          Abra o assistente
        </span>
      </span>

      <MessageSquareText className="h-4 w-4 text-violet-200 sm:hidden" />
    </button>
  )
}
