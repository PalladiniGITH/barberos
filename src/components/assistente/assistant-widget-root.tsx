'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import { AssistantLauncher } from '@/components/assistente/assistant-launcher'
import { useAssistantWidget } from '@/components/assistente/assistant-widget-provider'
import { BarberExLogo } from '@/components/brand/barberex-logo'

const AssistantWidgetPanel = dynamic(
  () => import('@/components/assistente/assistant-widget-panel').then((module) => module.AssistantWidgetPanel),
  {
    ssr: false,
    loading: () => (
      <div className="fixed bottom-6 right-6 z-40 hidden items-center gap-2 rounded-[1.1rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(28,28,33,0.98),rgba(18,18,22,0.99))] px-4 py-3 text-sm text-muted-foreground shadow-[0_24px_44px_-34px_rgba(2,6,23,0.9)] sm:flex">
        <BarberExLogo
          variant="symbol"
          tone="white"
          className="w-[1rem]"
          sizes="16px"
          alt=""
          aria-hidden
          loading="eager"
          fetchPriority="high"
        />
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Abrindo o BarberEX IA...
      </div>
    ),
  }
)

export function AssistantWidgetRoot() {
  const { hasOpened, visible } = useAssistantWidget()

  if (!visible) {
    return null
  }

  return (
    <>
      <AssistantLauncher />
      {hasOpened ? <AssistantWidgetPanel /> : null}
    </>
  )
}
