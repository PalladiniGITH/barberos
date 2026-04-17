'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { ChevronDown, LogOut, Settings2 } from 'lucide-react'
import { ROLE_LABELS, getInitials } from '@/lib/utils'

interface AccountMenuProps {
  user: {
    name?: string | null
    email?: string | null
    role?: string | null
    barbershopName?: string | null
  }
}

export function AccountMenu({ user }: AccountMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-3 rounded-[1.15rem] border border-[rgba(58,47,86,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,245,251,0.95))] px-3 py-2 shadow-[0_18px_38px_-26px_rgba(20,15,35,0.14)] transition-all hover:-translate-y-0.5 hover:border-[rgba(91,33,182,0.12)] hover:shadow-[0_22px_42px_-28px_rgba(91,33,182,0.18)]"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-[linear-gradient(135deg,#4c1d95,#6d28d9)] text-sm font-semibold text-white shadow-[0_16px_30px_-18px_rgba(91,33,182,0.46)]">
          {getInitials(user.name ?? '')}
        </div>
        <div className="hidden text-left sm:block">
          <p className="text-sm font-semibold leading-none text-foreground">{user.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ROLE_LABELS[user.role ?? ''] ?? user.role}
          </p>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-3 w-80 overflow-hidden rounded-[1.45rem] border border-[rgba(58,47,86,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(247,245,251,0.97))] shadow-[0_30px_72px_-38px_rgba(22,16,39,0.22)]">
            <div className="border-b border-[rgba(58,47,86,0.08)] bg-[rgba(91,33,182,0.04)] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Conta da operacao
              </p>
              <p className="mt-3 text-sm font-semibold text-foreground">{user.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {user.barbershopName}
              </p>
            </div>

            <div className="p-2.5">
              <Link
                href="/configuracoes"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-[1rem] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-[rgba(91,33,182,0.05)] hover:text-foreground"
              >
                <Settings2 className="h-4 w-4" />
                Abrir conta da barbearia
              </Link>

              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex w-full items-center gap-2 rounded-[1rem] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
