import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-[2.2rem] font-semibold tracking-tight text-foreground sm:text-[2.65rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex flex-wrap items-center gap-2">
          {action}
        </div>
      )}
    </div>
  )
}
