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
    <div className="premium-shell p-2">
      <div className={cn('grid gap-2', gridClass)}>
        {items.map((item) => {
          const active = currentPath === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-[1.2rem] border px-4 py-3 transition-all',
                active
                  ? 'surface-inverse border-[rgba(52,211,153,0.18)] bg-[linear-gradient(135deg,rgba(30,41,59,0.94),rgba(15,23,42,0.92))] text-white shadow-[0_20px_44px_-26px_rgba(2,6,23,0.74)]'
                  : 'border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.05)]'
              )}
            >
              <p className={cn('text-sm font-semibold', active ? 'text-white' : 'text-foreground')}>
                {item.label}
              </p>
              {item.helper && (
                <p className={cn('mt-1 text-xs leading-5', active ? 'text-slate-300' : 'text-muted-foreground')}>
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
