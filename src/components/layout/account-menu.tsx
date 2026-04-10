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
        className="flex items-center gap-3 rounded-[1rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-2 shadow-[0_18px_34px_-24px_rgba(2,6,23,0.72)] backdrop-blur-xl transition-colors hover:bg-[rgba(255,255,255,0.05)]"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.9rem] border border-[rgba(52,211,153,0.1)] bg-[linear-gradient(135deg,rgba(30,41,59,0.92),rgba(15,23,42,0.88))] text-sm font-semibold text-slate-100 shadow-[0_14px_28px_-20px_rgba(2,6,23,0.72)]">
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
          <div className="absolute right-0 top-full z-20 mt-3 w-64 overflow-hidden rounded-[1.1rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(30,41,59,0.96),rgba(15,23,42,0.92))] shadow-[0_28px_58px_-30px_rgba(2,6,23,0.86)]">
            <div className="border-b border-[rgba(255,255,255,0.06)] px-4 py-4">
              <p className="text-sm font-semibold text-foreground">{user.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {user.barbershopName}
              </p>
            </div>

            <div className="p-2">
              <Link
                href="/configuracoes"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-foreground"
              >
                <Settings2 className="h-4 w-4" />
                Abrir conta da barbearia
              </Link>

              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
