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
import { usePathname, useSearchParams } from 'next/navigation'
import { BarberExLoading } from '@/components/branding/barberex-loading'
import { cn } from '@/lib/utils'

interface NavigationFeedbackContextValue {
  pending: boolean
  targetHref: string | null
  startNavigation: (href?: string) => void
}

const NavigationFeedbackContext = createContext<NavigationFeedbackContextValue | null>(null)

export function NavigationFeedbackProvider({
  children,
  fallbackPath,
  fallbackSearch,
}: {
  children: ReactNode
  fallbackPath: string
  fallbackSearch: string
}) {
  const pathname = usePathname() ?? fallbackPath
  const searchParams = useSearchParams()
  const search = searchParams?.toString()
  const currentSearch = search ? `?${search}` : fallbackSearch
  const currentUrl = `${pathname}${currentSearch}`
  const [pending, setPending] = useState(false)
  const [targetHref, setTargetHref] = useState<string | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPending(false)
      setTargetHref(null)
    }, 140)

    return () => window.clearTimeout(timeout)
  }, [currentUrl])

  const startNavigation = useCallback((href?: string) => {
    if (!href || href === currentUrl) {
      return
    }

    setTargetHref(href)
    setPending(true)
  }, [currentUrl])

  const value = useMemo(() => ({
    pending,
    targetHref,
    startNavigation,
  }), [pending, startNavigation, targetHref])

  return (
    <NavigationFeedbackContext.Provider value={value}>
      {children}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] overflow-hidden transition-opacity duration-150',
          pending ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div className="nav-progress-bar h-full w-[42%]" />
      </div>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed right-4 top-4 z-[69] transition-all duration-200 sm:right-6',
          pending ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        )}
      >
        <BarberExLoading compact />
      </div>
    </NavigationFeedbackContext.Provider>
  )
}

export function useNavigationFeedback() {
  const context = useContext(NavigationFeedbackContext)

  if (!context) {
    throw new Error('useNavigationFeedback must be used inside NavigationFeedbackProvider.')
  }

  return context
}
