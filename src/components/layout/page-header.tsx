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
        <p className="page-kicker">Painel operacional</p>
        <h1 className="page-title mt-3">
          {title}
        </h1>
        {description && (
          <p className="page-copy mt-3 max-w-xl">{description}</p>
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
