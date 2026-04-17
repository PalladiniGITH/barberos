'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Header, type HeaderSessionUser } from '@/components/layout/header'
import {
  NavigationFeedbackProvider,
  useNavigationFeedback,
} from '@/components/layout/navigation-feedback'
import { Sidebar } from '@/components/layout/sidebar'

const SIDEBAR_STORAGE_KEY = 'barberos:sidebar-state'

function isFocusRoute(pathname: string) {
  return pathname.startsWith('/agendamentos') || pathname.startsWith('/inteligencia')
}

interface DashboardShellProps {
  children: ReactNode
  currentPath: string
  currentSearch: string
  user: HeaderSessionUser
}

export function DashboardShell({
  children,
  currentPath,
  currentSearch,
  user,
}: DashboardShellProps) {
  return (
    <NavigationFeedbackProvider fallbackPath={currentPath} fallbackSearch={currentSearch}>
      <DashboardShellFrame currentPath={currentPath} currentSearch={currentSearch} user={user}>
        {children}
      </DashboardShellFrame>
    </NavigationFeedbackProvider>
  )
}

function DashboardShellFrame({
  children,
  currentPath,
  currentSearch,
  user,
}: DashboardShellProps) {
  const pathname = usePathname() ?? currentPath
  const focusMode = isFocusRoute(pathname)
  const [sidebarPinned, setSidebarPinned] = useState(true)
  const { pending } = useNavigationFeedback()

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)

    if (stored === 'pinned' || stored === 'floating') {
      setSidebarPinned(stored === 'pinned')
      return
    }

    setSidebarPinned(true)
  }, [])

  function handleSidebarPinnedChange(nextValue: boolean) {
    setSidebarPinned(nextValue)
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextValue ? 'pinned' : 'floating')
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar
        fallbackPath={currentPath}
        pinned={sidebarPinned}
        focusMode={focusMode}
        onPinnedChange={handleSidebarPinnedChange}
      />

      <div className="flex min-w-0 flex-1 flex-col">
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
              ? 'bg-[radial-gradient(circle_at_top,rgba(91,33,182,0.08),transparent_26%),linear-gradient(180deg,rgba(248,247,251,0.88),rgba(243,241,248,0.96))] px-4 pb-8 pt-4 sm:px-6'
              : 'bg-[radial-gradient(circle_at_top,rgba(91,33,182,0.07),transparent_30%),linear-gradient(180deg,rgba(247,246,250,0.84),rgba(241,239,246,0.96))] px-4 pb-12 pt-6 sm:px-7 lg:px-8',
            pending && 'opacity-80'
          )}
        >
          <div className="mx-auto w-full max-w-[1880px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
