'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, Building2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BarberExLogo } from '@/components/brand/barberex-logo'
import { AccountMenu } from '@/components/layout/account-menu'
import type { HeaderSessionUser } from '@/components/layout/header'

interface PlatformShellProps {
  children: ReactNode
  user: HeaderSessionUser
}

const platformLinks = [
  {
    href: '/internal',
    label: 'Operação BarberEX',
    helper: 'Visão geral da plataforma',
  },
  {
    href: '/internal',
    label: 'Barbearias',
    helper: 'Tenants, planos e custos',
  },
] as const

export function PlatformShell({ children, user }: PlatformShellProps) {
  const pathname = usePathname() ?? '/internal'

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.08),transparent_16%),linear-gradient(180deg,rgba(17,17,21,0.99),rgba(11,11,14,1))] text-foreground">
      <header className="sticky top-0 z-40 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.84)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="min-w-0 space-y-3">
              <BarberExLogo
                variant="full"
                tone="white"
                className="w-[156px] sm:w-[172px]"
                sizes="(max-width: 640px) 156px, 172px"
                priority
                fetchPriority="high"
              />
              <h1 className="truncate text-[1.45rem] font-semibold tracking-tight text-foreground">
                Operação BarberEX
              </h1>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Gestão da plataforma, tenants, custos de IA, WhatsApp e saúde operacional sem misturar a rotina de uma barbearia específica.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="action-button"
            >
              Abrir barbearia vinculada
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <AccountMenu
              user={{
                ...user,
                barbershopName: 'Plataforma BarberEX',
              }}
              primaryHref="/dashboard"
              primaryLabel="Abrir barbearia vinculada"
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-[1760px] flex-wrap items-center gap-2 px-4 pb-4 sm:px-6 lg:px-8">
          {platformLinks.map((item, index) => {
            const active = index === 0
              ? pathname === '/internal'
              : pathname.startsWith('/internal/barbershops/')

            return (
              <Link
                key={`${item.label}:${index}`}
                href={item.href}
                className={cn(
                  'inline-flex items-center gap-2 rounded-[0.95rem] border px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-[rgba(124,92,255,0.16)] bg-[rgba(124,92,255,0.08)] text-violet-100'
                    : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-muted-foreground hover:bg-[rgba(255,255,255,0.045)] hover:text-foreground'
                )}
              >
                {index === 0 ? <ShieldCheck className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                <span>{item.label}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{item.helper}</span>
              </Link>
            )
          })}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
