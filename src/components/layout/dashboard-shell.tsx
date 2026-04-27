'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { AssistantWidgetProvider } from '@/components/assistente/assistant-widget-provider'
import { AssistantWidgetRoot } from '@/components/assistente/assistant-widget-root'
import { Header, type HeaderSessionUser } from '@/components/layout/header'
import {
  NavigationFeedbackProvider,
  useNavigationFeedback,
} from '@/components/layout/navigation-feedback'
import { Sidebar } from '@/components/layout/sidebar'

const SIDEBAR_STORAGE_KEY = 'barberex:sidebar-state'

function isFocusRoute(pathname: string) {
  return pathname.startsWith('/agendamentos') || pathname.startsWith('/inteligencia')
}

interface DashboardShellProps {
  children: ReactNode
  currentPath: string
  currentSearch: string
  user: HeaderSessionUser
  homeHref?: string
}

export function DashboardShell({
  children,
  currentPath,
  currentSearch,
  user,
  homeHref = '/dashboard',
}: DashboardShellProps) {
  return (
    <NavigationFeedbackProvider fallbackPath={currentPath} fallbackSearch={currentSearch}>
      <AssistantWidgetProvider>
        <DashboardShellFrame currentPath={currentPath} currentSearch={currentSearch} user={user} homeHref={homeHref}>
          {children}
        </DashboardShellFrame>
      </AssistantWidgetProvider>
    </NavigationFeedbackProvider>
  )
}

function DashboardShellFrame({
  children,
  currentPath,
  currentSearch,
  user,
  homeHref = '/dashboard',
}: DashboardShellProps) {
  const pathname = usePathname() ?? currentPath
  const focusMode = isFocusRoute(pathname)
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const { pending } = useNavigationFeedback()

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)

    if (stored === 'pinned' || stored === 'floating') {
      setSidebarPinned(stored === 'pinned')
      return
    }

    setSidebarPinned(false)
  }, [pathname])

  function handleSidebarPinnedChange(nextValue: boolean) {
    setSidebarPinned(nextValue)
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextValue ? 'pinned' : 'floating')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        fallbackPath={currentPath}
        pinned={sidebarPinned}
        focusMode={focusMode}
        role={user.role}
        platformRole={user.platformRole}
        homeHref={homeHref}
        onPinnedChange={handleSidebarPinnedChange}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          currentPath={currentPath}
          currentSearch={currentSearch}
          sessionUser={user}
          focusMode={focusMode}
          sidebarPinned={sidebarPinned}
          onToggleSidebar={() => handleSidebarPinnedChange(!sidebarPinned)}
        />

        <main
          aria-busy={pending}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-y-contain transition-[opacity,transform] duration-200',
            focusMode
              ? 'bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.08),transparent_18%),linear-gradient(180deg,rgba(27,27,30,0.98),rgba(14,14,17,1))] px-4 pb-6 pt-4 sm:px-6'
              : 'bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.06),transparent_20%),linear-gradient(180deg,rgba(22,22,26,0.98),rgba(14,14,17,1))] px-5 pb-8 pt-5 sm:px-7',
            pending && 'opacity-80'
          )}
        >
          <div className="mx-auto w-full max-w-[1760px]">
            {children}
          </div>
        </main>
      </div>

      <AssistantWidgetRoot />
    </div>
  )
}
