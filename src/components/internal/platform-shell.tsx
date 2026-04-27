'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, Building2, ShieldCheck } from 'lucide-react'
import { PRODUCT_MONOGRAM, PRODUCT_NAME } from '@/lib/branding'
import { cn } from '@/lib/utils'
import { AccountMenu } from '@/components/layout/account-menu'
import type { HeaderSessionUser } from '@/components/layout/header'

interface PlatformShellProps {
  children: ReactNode
  user: HeaderSessionUser
}

const platformLinks = [
  {
    href: '/internal',
    label: 'Operacao BarberEX',
    helper: 'Visao geral da plataforma',
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.08),transparent_20%),linear-gradient(180deg,rgba(11,13,19,0.99),rgba(8,10,15,1))] text-foreground">
      <header className="sticky top-0 z-40 border-b border-[rgba(255,255,255,0.08)] bg-[rgba(9,12,18,0.84)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[0.95rem] border border-[rgba(124,58,237,0.28)] bg-[radial-gradient(circle_at_30%_20%,rgba(168,85,247,0.34),transparent_42%),linear-gradient(135deg,rgba(124,58,237,0.28),rgba(15,23,42,0.96))] text-[11px] font-semibold tracking-[0.16em] text-violet-50 shadow-[0_18px_34px_-24px_rgba(2,6,23,0.82)]">
                {PRODUCT_MONOGRAM}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-slate-50">{PRODUCT_NAME}</p>
                <h1 className="truncate text-[1.45rem] font-semibold tracking-tight text-foreground">
                  Operacao BarberEX
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Gestao da plataforma, tenants, custos de IA, WhatsApp e saude operacional sem misturar a rotina de uma barbearia especifica.
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
                    ? 'border-[rgba(124,58,237,0.16)] bg-[rgba(124,58,237,0.1)] text-violet-100'
                    : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] text-muted-foreground hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground'
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
