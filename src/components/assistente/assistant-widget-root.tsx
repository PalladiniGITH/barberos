'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import { AssistantLauncher } from '@/components/assistente/assistant-launcher'
import { useAssistantWidget } from '@/components/assistente/assistant-widget-provider'

const AssistantWidgetPanel = dynamic(
  () => import('@/components/assistente/assistant-widget-panel').then((module) => module.AssistantWidgetPanel),
  {
    ssr: false,
    loading: () => (
      <div className="fixed bottom-6 right-6 z-40 hidden items-center gap-2 rounded-[1.1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(15,17,21,0.96)] px-4 py-3 text-sm text-muted-foreground shadow-[0_24px_44px_-30px_rgba(2,6,23,0.82)] sm:flex">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Abrindo o Assistente EX...
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
