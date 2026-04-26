'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { shouldShowAssistantOnPath } from '@/lib/assistant-screen-context'

interface AssistantWidgetContextValue {
  isOpen: boolean
  hasOpened: boolean
  visible: boolean
  pathname: string
  openAssistant: () => void
  closeAssistant: () => void
  toggleAssistant: () => void
}

const AssistantWidgetContext = createContext<AssistantWidgetContextValue | null>(null)

export function AssistantWidgetProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/dashboard'
  const [isOpen, setIsOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const visible = shouldShowAssistantOnPath(pathname)

  const openAssistant = useCallback(() => {
    setHasOpened(true)
    setIsOpen(true)
  }, [])

  const closeAssistant = useCallback(() => {
    setIsOpen(false)
  }, [])

  const toggleAssistant = useCallback(() => {
    setHasOpened(true)
    setIsOpen((current) => !current)
  }, [])

  useEffect(() => {
    if (!visible) {
      setIsOpen(false)
    }
  }, [visible])

  const value = useMemo<AssistantWidgetContextValue>(
    () => ({
      isOpen,
      hasOpened,
      visible,
      pathname,
      openAssistant,
      closeAssistant,
      toggleAssistant,
    }),
    [closeAssistant, hasOpened, isOpen, openAssistant, pathname, toggleAssistant, visible]
  )

  return (
    <AssistantWidgetContext.Provider value={value}>
      {children}
    </AssistantWidgetContext.Provider>
  )
}

export function useAssistantWidget() {
  const context = useContext(AssistantWidgetContext)

  if (!context) {
    throw new Error('useAssistantWidget must be used inside AssistantWidgetProvider.')
  }

  return context
}
