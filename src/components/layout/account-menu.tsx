'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { ChevronDown, LogOut, Settings2 } from 'lucide-react'
import { AUTH_ENTRY_PATH } from '@/lib/auth-routes'
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
        className="flex items-center gap-3 rounded-[0.95rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(255,255,255,0.68)] px-3 py-2 shadow-[0_10px_18px_-14px_rgba(15,23,42,0.1)] transition-colors hover:bg-[rgba(91,33,182,0.05)]"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.85rem] bg-[linear-gradient(135deg,#5b21b6,#7c3aed)] text-sm font-semibold text-white shadow-[0_10px_18px_-14px_rgba(91,33,182,0.34)]">
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
          <div className="absolute right-0 top-full z-20 mt-3 w-72 overflow-hidden rounded-[1rem] border border-[rgba(52,44,78,0.1)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,242,249,0.98))] shadow-[0_20px_40px_-28px_rgba(22,16,39,0.16)]">
            <div className="border-b border-[rgba(52,44,78,0.08)] px-4 py-4">
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
                className="flex items-center gap-2 rounded-[0.85rem] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-[rgba(91,33,182,0.05)] hover:text-foreground"
              >
                <Settings2 className="h-4 w-4" />
                Abrir conta da barbearia
              </Link>

              <button
                onClick={() => signOut({ callbackUrl: AUTH_ENTRY_PATH })}
                className="flex w-full items-center gap-2 rounded-[0.85rem] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
