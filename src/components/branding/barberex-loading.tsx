import { Scissors } from 'lucide-react'
import { PRODUCT_LOADING_LABEL, PRODUCT_MONOGRAM, PRODUCT_NAME } from '@/lib/branding'
import { cn } from '@/lib/utils'

interface BarberExLoadingProps {
  compact?: boolean
  className?: string
  label?: string
}

export function BarberExLoading({
  compact = false,
  className,
  label = PRODUCT_LOADING_LABEL,
}: BarberExLoadingProps) {
  if (compact) {
    return (
      <div
        className={cn(
          'pointer-events-none inline-flex items-center gap-3 rounded-[1rem] border border-[rgba(124,58,237,0.16)] bg-[linear-gradient(180deg,rgba(28,32,48,0.96),rgba(15,17,21,0.98))] px-3.5 py-2.5 shadow-[0_24px_48px_-34px_rgba(2,6,23,0.9)] backdrop-blur-xl',
          className
        )}
      >
        <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-[0.95rem] border border-[rgba(139,92,246,0.22)] bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.28),rgba(91,33,182,0.12)_58%,transparent_100%)]">
          <div className="barberex-loader-glow absolute inset-1 rounded-[0.75rem] bg-[radial-gradient(circle,rgba(167,139,250,0.18),transparent_72%)]" />
          <Scissors className="barberex-loader-scissor relative z-10 h-4 w-4 text-primary-foreground" />
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/80">
            {PRODUCT_NAME}
          </p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-screen items-center justify-center bg-background px-6 py-10', className)}>
      <div className="relative w-full max-w-md overflow-hidden rounded-[1.6rem] border border-[rgba(124,58,237,0.16)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(15,17,21,0.98))] p-8 shadow-[0_42px_80px_-48px_rgba(2,6,23,0.96)]">
        <div className="absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(167,139,250,0.46),transparent)]" />

        <div className="mx-auto flex w-full max-w-[15rem] flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(139,92,246,0.18)] bg-[rgba(124,58,237,0.1)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/80">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(124,58,237,0.18)] text-primary-foreground">
              {PRODUCT_MONOGRAM}
            </span>
            {PRODUCT_NAME}
          </div>

          <div className="relative mt-8 flex h-20 w-20 items-center justify-center overflow-hidden rounded-[1.5rem] border border-[rgba(139,92,246,0.22)] bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.28),rgba(91,33,182,0.14)_58%,transparent_100%)] shadow-[0_24px_44px_-28px_rgba(91,33,182,0.5)]">
            <div className="barberex-loader-glow absolute inset-2 rounded-[1.1rem] bg-[radial-gradient(circle,rgba(167,139,250,0.18),transparent_72%)]" />
            <Scissors className="barberex-loader-scissor relative z-10 h-8 w-8 text-primary-foreground" />
          </div>

          <div className="relative mt-7 h-10 w-full overflow-hidden">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.22),rgba(255,255,255,0.04))]" />
            <div className="barberex-loader-trace absolute top-1/2 h-[3px] w-16 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,rgba(167,139,250,0),rgba(167,139,250,0.9),rgba(124,58,237,0))]" />
          </div>

          <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.06em] text-foreground">
            {PRODUCT_NAME}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {label}
          </p>
        </div>
      </div>
    </div>
  )
}
