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
    platformRole?: string | null
    barbershopName?: string | null
  }
  primaryHref?: string | null
  primaryLabel?: string | null
}

export function AccountMenu({
  user,
  primaryHref = '/configuracoes',
  primaryLabel,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const isBarber = user.role === 'BARBER'
  const effectiveRole = user.platformRole && user.platformRole !== 'NONE'
    ? user.platformRole
    : user.role
  const resolvedPrimaryLabel = primaryLabel ?? (
    user.platformRole && user.platformRole !== 'NONE'
      ? 'Abrir minha conta'
      : isBarber
        ? 'Abrir minha conta'
        : 'Abrir conta da barbearia'
  )

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-3 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 shadow-[0_12px_22px_-16px_rgba(2,6,23,0.48)] transition-colors hover:bg-[rgba(124,58,237,0.12)]"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.85rem] bg-[linear-gradient(135deg,#5b21b6,#7c3aed)] text-sm font-semibold text-primary-foreground shadow-[0_16px_24px_-16px_rgba(91,33,182,0.46)]">
          {getInitials(user.name ?? '')}
        </div>
        <div className="hidden text-left sm:block">
          <p className="text-sm font-semibold leading-none text-foreground">{user.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ROLE_LABELS[effectiveRole ?? ''] ?? effectiveRole}
          </p>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-3 w-72 overflow-hidden rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(15,17,21,0.98))] shadow-[0_24px_44px_-30px_rgba(2,6,23,0.82)]">
            <div className="border-b border-[rgba(255,255,255,0.06)] px-4 py-4">
              <p className="text-sm font-semibold text-foreground">{user.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {user.barbershopName}
              </p>
            </div>

            <div className="p-2">
              {primaryHref && (
                <Link
                  href={primaryHref}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-[0.85rem] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground"
                >
                  <Settings2 className="h-4 w-4" />
                  {resolvedPrimaryLabel}
                </Link>
              )}

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
