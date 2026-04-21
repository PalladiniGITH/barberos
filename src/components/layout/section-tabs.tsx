import Link from 'next/link'
import { cn } from '@/lib/utils'

interface SectionTab {
  href: string
  label: string
  helper?: string
}

interface SectionTabsProps {
  items: SectionTab[]
  currentPath: string
}

export function SectionTabs({ items, currentPath }: SectionTabsProps) {
  const gridClass = items.length <= 2
    ? 'sm:grid-cols-2'
    : items.length === 3
      ? 'lg:grid-cols-3'
      : 'md:grid-cols-2 xl:grid-cols-4'

  return (
    <div className="premium-shell p-1.5">
      <div className={cn('grid gap-2', gridClass)}>
        {items.map((item) => {
          const active = currentPath === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-[1.1rem] border px-3.5 py-2.5 transition-all',
                active
                  ? 'surface-inverse border-[rgba(124,58,237,0.22)] bg-[linear-gradient(135deg,rgba(109,40,217,0.28),rgba(21,24,33,0.96))] text-white shadow-[0_20px_44px_-26px_rgba(2,6,23,0.78)]'
                  : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(124,58,237,0.18)] hover:bg-[rgba(124,58,237,0.08)]'
              )}
            >
              <p className={cn('text-[13px] font-semibold', active ? 'text-white' : 'text-foreground')}>
                {item.label}
              </p>
              {item.helper && (
                <p className={cn('mt-1 text-[11px] leading-5', active ? 'text-slate-300' : 'text-muted-foreground')}>
                  {item.helper}
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
