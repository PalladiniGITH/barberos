'use client'

import * as Avatar from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'
import {
  getProfessionalInitials,
  normalizeProfessionalAvatarUrl,
} from '@/lib/professionals/avatar'

const sizeClasses = {
  sm: {
    root: 'h-9 w-9 text-[11px]',
    ring: 'ring-1',
  },
  md: {
    root: 'h-11 w-11 text-sm',
    ring: 'ring-[1.5px]',
  },
  lg: {
    root: 'h-16 w-16 text-lg',
    ring: 'ring-2',
  },
} as const

export function ProfessionalAvatar({
  name,
  imageUrl,
  size = 'md',
  className,
}: {
  name: string
  imageUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const resolvedImageUrl = normalizeProfessionalAvatarUrl(imageUrl)
  const sizeConfig = sizeClasses[size]

  return (
    <Avatar.Root
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.22),transparent_58%),linear-gradient(180deg,rgba(38,40,48,0.98),rgba(16,17,23,0.98))] font-semibold uppercase tracking-[0.14em] text-slate-100 shadow-[0_14px_26px_-20px_rgba(2,6,23,0.88)] ring-white/10',
        sizeConfig.root,
        sizeConfig.ring,
        className
      )}
    >
      {resolvedImageUrl ? (
        <Avatar.Image
          src={resolvedImageUrl}
          alt={`Foto de ${name}`}
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <Avatar.Fallback
        delayMs={resolvedImageUrl ? 300 : 0}
        className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,rgba(124,58,237,0.16),rgba(15,23,42,0.96))] text-current"
      >
        {getProfessionalInitials(name)}
      </Avatar.Fallback>
    </Avatar.Root>
  )
}
